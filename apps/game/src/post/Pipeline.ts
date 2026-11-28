import * as THREE from 'three/webgpu';
import type { UniformNode } from 'three/webgpu';
import * as TSL from 'three/tsl';
import * as GTAO from 'three/addons/tsl/display/GTAONode.js';
import * as TRAA from 'three/addons/tsl/display/TRAANode.js';
import * as BLOOM from 'three/addons/tsl/display/BloomNode.js';
import * as DENOISE from 'three/addons/tsl/display/DenoiseNode.js';
import * as DOF from 'three/addons/tsl/display/DepthOfFieldNode.js';
import * as SSR from 'three/addons/tsl/display/SSRNode.js';
import * as LUT from 'three/addons/tsl/display/Lut3DNode.js';
import { createLutTexture, LUT_SIZE } from './luts.ts';
import { circleOfConfusionMm, dofAmount, FrameProbe, motionBlurAmount, pickQuality, type Quality } from './quality.ts';

// TSL node types are too strict to compose graph fragments dynamically (and lag behind the runtime, e.g. getTextureNode);
// the node functions are used untyped and the graph is exercised by the browser checks instead.
/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;
type Sampler = { sample(uv: N): N };
const {
  builtinAOContext, clamp, getViewPosition, normalize, pow, convertToTexture, dot, float, Fn, frameId, interleavedGradientNoise, Loop, int, length, mix, mrt, normalView, packNormalToRGB,
  output, pass, passTexture, perspectiveDepthToViewZ, renderOutput, roughness, sample, screenCoordinate, screenSize, screenUV, smoothstep, texture3D, uniform, unpackRGBToNormal,
  vec2, vec3, vec4, velocity,
} = TSL as unknown as Record<string, any>;
const { ao } = GTAO as unknown as Record<string, any>;
const { traa } = TRAA as unknown as Record<string, any>;
const { bloom } = BLOOM as unknown as Record<string, any>;
const { denoise } = DENOISE as unknown as Record<string, any>;
const { dof } = DOF as unknown as Record<string, any>;
const { ssr } = SSR as unknown as Record<string, any>;
const { lut3D } = LUT as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

// Constants from docs/contracts.md section 7 and the L2 card.
const AO_RADIUS = 1.2;
const BLOOM_THRESHOLD = 1.0;
const BLOOM_STRENGTH = 0.18;
const BLOOM_RADIUS = 0.6;
const GRAIN = 0.03;
const VIGNETTE = 0.25;
const CHROMATIC_ABERRATION_PX = 0.6;
const SSR_RESOLUTION = 0.5;
const F0_DIELECTRIC = 0.04;
const REFLECTION_GAIN = 1.2;
const SENSOR_WIDTH_MM = 36;
const MOTION_BLUR_TAPS = 6;
const MOTION_BLUR_REACH = 0.045; // fraction of the distance to the screen centre, at full strength

/** Per-frame inputs from the game loop. */
export interface PostState {
  /** Distance from the camera to the player, metres: the DoF focus plane. */
  focusDistance: number;
  /** Seconds without player or camera movement. */
  idleSeconds: number;
  driving: boolean;
  speedKmh: number;
  /** Depth of field only runs on the follow camera. */
  followCamera: boolean;
  /** 0 by day, 1 at night. */
  night: number;
}

export interface PipelineOptions {
  /** A fixed tier, or undefined to measure the first PROBE_SECONDS of frame time and choose. */
  quality?: Quality;
  /** false forces the MSAA 4x path (no temporal resolve). */
  taa?: boolean;
}

type Variant = 'base' | 'dof' | 'blur';

interface Graph {
  outputs: Partial<Record<Variant, N>>;
  dispose(): void;
  dofNode?: { bokehScaleNode: UniformNode<'float'>; focusDistanceNode: UniformNode<'float'>; focalLengthNode: UniformNode<'float'> };
  bloomThreshold?: UniformNode<'float'>;
}

/**
 * One post-processing pipeline for the whole game. Order of the stages, scene to screen:
 * (pre-pass: normals, roughness, velocity) -> GTAO + denoise -> lit scene -> temporal AA -> screen-space reflections ->
 * [depth of field] -> bloom -> [camera-rotation blur] with chromatic aberration -> tone mapping -> 3D LUT grade ->
 * vignette -> film grain.
 *
 * low = temporal AA + grade. med = + GTAO, bloom, vignette, grain, chromatic aberration.
 * high = + denoised GTAO, reflections, depth of field and driving blur.
 */
export class Pipeline {
  readonly post: THREE.RenderPipeline;
  quality: Quality;
  /** True when the temporal resolve is in use; false on the MSAA fallback. */
  taa: boolean;
  /** Quality chosen from the frame-time probe (undefined while probing or when fixed by the caller). */
  probed?: { medianMs: number; quality: Quality };

  private graph!: Graph;
  private variant: Variant = 'base';
  private readonly probe?: FrameProbe;
  private readonly night: UniformNode<'float'>;
  private readonly blurStrength = uniform(0);
  private readonly dayLut = createLutTexture('day');
  private readonly nightLut = createLutTexture('night');
  private lastSize = new THREE.Vector2();

  constructor(private renderer: THREE.WebGPURenderer, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera, night: UniformNode<'float'>, opts: PipelineOptions = {}) {
    this.night = night;
    this.taa = opts.taa ?? true;
    this.quality = opts.quality ?? 'high';
    if (opts.quality === undefined) this.probe = new FrameProbe();
    this.post = new THREE.RenderPipeline(renderer);
    // Tone mapping and sRGB encoding happen inside the final stage, ahead of the LUT.
    this.post.outputColorTransform = false;
    this.rebuild();
  }

  /** Switch tier; rebuilds the node graph (one shader compile). */
  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.rebuild();
  }

  private rebuild(): void {
    this.graph?.dispose();
    this.graph = this.build(this.quality);
    this.variant = 'base';
    this.post.outputNode = this.graph.outputs.base!;
    this.post.needsUpdate = true;
  }

  /** Render every variant once so toggling depth of field or the blur later does not compile a shader mid-play. */
  warm(): void {
    for (const v of ['base', 'dof', 'blur'] as Variant[]) {
      const out = this.graph.outputs[v];
      if (!out) continue;
      this.post.outputNode = out; this.post.needsUpdate = true;
      this.post.render();
    }
    this.post.outputNode = this.graph.outputs.base!; this.post.needsUpdate = true;
    this.variant = 'base';
  }

  /** Call once per frame before render(). frameMs is the wall time of the previous frame. */
  update(state: PostState, frameMs: number): void {
    if (this.probe && frameMs > 0) {
      const median = this.probe.add(frameMs);
      if (median !== undefined) {
        const q = pickQuality(median);
        this.probed = { medianMs: median, quality: q };
        this.setQuality(q);
      }
    }
    const g = this.graph;
    const exposure = this.renderer.toneMappingExposure;
    if (g.bloomThreshold) g.bloomThreshold.value = BLOOM_THRESHOLD / Math.max(exposure, 1e-3);
    this.night.value = state.night;

    const blur = this.quality === 'high' ? motionBlurAmount(state.speedKmh, state.driving) : 0;
    this.blurStrength.value = blur;
    const dofOn = this.quality === 'high' ? dofAmount(state.idleSeconds, state.driving, state.followCamera) : 0;
    if (g.dofNode && dofOn > 0) {
      // 50 mm at f/2.8 focused on the player: circle of confusion of a point at infinity, in pixels of the frame.
      const focus = Math.max(state.focusDistance, 0.5);
      const cocPx = (circleOfConfusionMm(focus, 1e4) / SENSOR_WIDTH_MM) * this.renderer.domElement.width;
      g.dofNode.focusDistanceNode.value = focus;
      g.dofNode.focalLengthNode.value = focus * 1.6;
      g.dofNode.bokehScaleNode.value = Math.max(0.5, cocPx * 0.3) * dofOn;
    }
    const next: Variant = blur > 0 && g.outputs.blur ? 'blur' : dofOn > 0 && g.outputs.dof ? 'dof' : 'base';
    if (next !== this.variant) {
      this.variant = next;
      this.post.outputNode = g.outputs[next]!;
      this.post.needsUpdate = true;
    }
  }

  render(): void { this.post.render(); }

  setSize(): void { this.renderer.getSize(this.lastSize); }

  private build(q: Quality): Graph {
    const { scene, camera, renderer } = this;
    const useTaa = this.taa;
    const disposables: { dispose(): void }[] = [];
    const track = <T extends { dispose?: () => void }>(n: T): T => { if (n.dispose) disposables.push(n as { dispose(): void }); return n; };

    // ---- passes --------------------------------------------------------------------------------------------
    let sceneColor: N;
    let depthNode: N;
    let velocityNode: N | undefined;
    let normalNode: N | undefined;
    let roughnessNode: N | undefined;
    let roughnessTex: N | undefined;
    let normalAt: ((uv: N) => N) | undefined;
    let aoNode: N | undefined;

    if (q === 'low') {
      // One scene render: colour plus depth and velocity for the temporal resolve.
      const scenePass = track(pass(scene, camera, useTaa ? {} : { samples: 4 }));
      if (useTaa) scenePass.setMRT(mrt({ output, velocity }));
      sceneColor = scenePass.getTextureNode('output');
      depthNode = scenePass.getTextureNode('depth');
      velocityNode = useTaa ? scenePass.getTextureNode('velocity') : undefined;
    } else {
      // Pre-pass: packed view normals, velocity and (high) roughness; depth comes with every pass.
      const prePass = track(pass(scene, camera));
      prePass.transparent = false;
      prePass.setMRT(mrt(q === 'high'
        ? { output: packNormalToRGB(normalView), velocity, roughness }
        : { output: packNormalToRGB(normalView), velocity }));
      prePass.getTexture('output').type = THREE.UnsignedByteType;
      if (q === 'high') prePass.getTexture('roughness').type = THREE.UnsignedByteType;
      normalAt = (uv: N) => unpackRGBToNormal(prePass.getTextureNode().sample(uv));
      normalNode = sample(normalAt);
      depthNode = prePass.getTextureNode('depth');
      velocityNode = prePass.getTextureNode('velocity');
      if (q === 'high') { roughnessTex = prePass.getTextureNode('roughness'); roughnessNode = roughnessTex.r; }

      const aoPass = track(ao(depthNode, normalNode, camera));
      aoPass.radius.value = AO_RADIUS;
      aoPass.resolutionScale = 0.5;
      aoPass.useTemporalFiltering = true;
      // High adds a depth/normal-aware denoise on top of the temporal filter.
      aoNode = q === 'high'
        ? convertToTexture(denoise(aoPass.getTextureNode(), depthNode, normalNode, camera)).sample(screenUV).r
        : aoPass.getTextureNode().sample(screenUV).r;

      // Beauty pass: occlusion attenuates indirect light only, not direct sun.
      const scenePass = track(pass(scene, camera, useTaa ? {} : { samples: 4 }));
      scenePass.contextNode = builtinAOContext(aoNode);
      sceneColor = scenePass.getTextureNode('output');
    }

    // ---- temporal AA -------------------------------------------------------------------------------------------
    let resolved: N = sceneColor;
    if (useTaa) {
      const taa = track(traa(sceneColor, depthNode, velocityNode!, camera));
      taa.useSubpixelCorrection = false;
      resolved = taa.getTextureNode();
    }
    const resolvedTex = resolved as unknown as Sampler;

    // ---- reflections (high): only surfaces with roughness < 0.25..0.35 respond, the node masks by roughness ----------
    let reflections: Sampler | undefined;
    if (q === 'high' && roughnessNode && normalNode) {
      // The first-generation SSR weights its hits by `metalnessNode`; feed it the Fresnel reflectance of a dielectric,
      // masked to glossy surfaces (roughness below 0.35), so only wet asphalt, glass and water reflect.
      const projInv = uniform(camera.projectionMatrixInverse);
      const weight = Fn(() => {
        const rough = roughnessTex.sample(screenUV).r;
        const viewPos = getViewPosition(screenUV, depthNode.sample(screenUV).r, projInv);
        const ndv = clamp(dot(normalize(normalAt!(screenUV)), normalize(viewPos.negate())), 0, 1);
        const fresnel = float(F0_DIELECTRIC).add(float(1 - F0_DIELECTRIC).mul(pow(float(1).sub(ndv), 5)));
        return fresnel.mul(float(1).sub(smoothstep(0.2, 0.35, rough))).mul(REFLECTION_GAIN);
      })();
      const ssrPass = track(ssr(resolved, depthNode, normalNode, { roughnessNode, metalnessNode: weight, reflectNonMetals: true, camera }));
      ssrPass.resolutionScale = SSR_RESOLUTION;
      ssrPass.maxDistance.value = 120;
      ssrPass.thickness.value = 0.6;
      ssrPass.quality.value = 0.5;
      ssrPass.intensity.value = 1;
      reflections = ssrPass.getTextureNode() as unknown as Sampler;
    }
    const litHdr: N = reflections ? vec4(resolved).add(reflections.sample(screenUV)) : resolved;

    // ---- depth of field (high) -----------------------------------------------------------------------------------
    let dofNode: Graph['dofNode'];
    let dofTex: Sampler | undefined;
    if (q === 'high') {
      const focusDistance = uniform(5); const focalLength = uniform(4); const bokeh = uniform(0.5);
      const d = track(dof(litHdr, depthToViewZ(depthNode, camera), focusDistance, focalLength, bokeh));
      dofNode = { bokehScaleNode: bokeh as UniformNode<'float'>, focusDistanceNode: focusDistance as UniformNode<'float'>, focalLengthNode: focalLength as UniformNode<'float'> };
      dofTex = passTexture(d, d.getTextureNode().value) as Sampler; // passTexture keeps the DoF passes in the graph
    }

    // ---- bloom ------------------------------------------------------------------------------------------------------
    // The threshold is in scene radiance; update() keeps it at 1.0 / exposure so it means "display white".
    let bloomTex: Sampler | undefined;
    let bloomThreshold: UniformNode<'float'> | undefined;
    if (q !== 'low') {
      const b = track(bloom(litHdr, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD));
      bloomThreshold = b.threshold as UniformNode<'float'>;
      bloomTex = b.getTextureNode() as unknown as Sampler;
    }

    // ---- final stage: chromatic aberration / blur taps -> tone map -> LUT -> vignette -> grain ---------------------------------
    const dayLut = texture3D(this.dayLut); const nightLut = texture3D(this.nightLut);
    const night = this.night; const blurStrength = this.blurStrength;
    const full = q !== 'low';

    const hdrAt = (uv: N, useDof: boolean) => {
      const base = (useDof && dofTex ? dofTex.sample(uv) : reflections ? vec4(resolvedTex.sample(uv)).add(reflections.sample(uv)) : resolvedTex.sample(uv)) as N;
      const rgb = vec4(base).rgb;
      return bloomTex ? rgb.add(vec4(bloomTex.sample(uv)).rgb) : rgb;
    };

    const finish = (useDof: boolean, motion: boolean) => Fn(() => {
      const uv = screenUV;
      const centred = uv.sub(0.5);
      const aspect = screenSize.x.div(screenSize.y);
      const q2 = centred.mul(vec2(aspect, 1)).div(length(vec2(aspect, 1)).mul(0.5)); // 0 at the centre, 1 at the corners
      const edge = length(q2);

      let hdr: N;
      if (motion) {
        // Radial blur towards the screen centre, stronger at the edges; no chromatic aberration in this variant.
        const acc = vec3(0).toVar();
        Loop({ start: int(0), end: int(MOTION_BLUR_TAPS), type: 'int', condition: '<' }, ({ i }: { i: N }) => {
          const k = float(i).div(MOTION_BLUR_TAPS - 1).sub(0.5).mul(2); // -1..1
          const reach = blurStrength.mul(MOTION_BLUR_REACH).mul(k).mul(smoothstep(0.1, 0.9, edge));
          acc.addAssign(hdrAt(uv.add(centred.negate().mul(reach)), useDof));
        });
        hdr = acc.div(MOTION_BLUR_TAPS);
      } else if (full) {
        // 0.6 px at the frame edge, growing with the square of the distance from the centre, none in the middle.
        const dir = centred.div(length(centred).max(1e-5));
        const offset = dir.mul(edge.mul(edge)).mul(CHROMATIC_ABERRATION_PX).div(screenSize);
        hdr = vec3(hdrAt(uv.add(offset), useDof).r, hdrAt(uv, useDof).g, hdrAt(uv.sub(offset), useDof).b);
      } else {
        hdr = hdrAt(uv, useDof);
      }

      const display = renderOutput(vec4(hdr, 1));
      const dayC = lut3D(display, dayLut, LUT_SIZE, 1);
      const nightC = lut3D(display, nightLut, LUT_SIZE, 1);
      let color = mix(dayC.rgb, nightC.rgb, night);

      if (full) {
        color = color.mul(float(1).sub(smoothstep(0.35, 1.05, edge).mul(VIGNETTE)));
        const seed = float(frameId.mod(97)).mul(vec2(17.13, 31.71));
        const n = interleavedGradientNoise(screenCoordinate.add(seed)).sub(0.5).mul(2 * GRAIN);
        const lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = color.add(n.mul(float(1).sub(lum.mul(0.6))));
      }
      return vec4(clamp(color, 0, 1), 1);
    })();

    const outputs: Graph['outputs'] = { base: finish(false, false) };
    if (q === 'high') { outputs.dof = finish(true, false); outputs.blur = finish(false, true); }
    return { outputs, dofNode, bloomThreshold, dispose: () => { for (const d of disposables) d.dispose(); void renderer; } };
  }
}

/** View-space depth (negative in front of the camera) from the hardware depth texture. */
function depthToViewZ(depth: N, camera: THREE.PerspectiveCamera): N {
  return perspectiveDepthToViewZ(depth, uniform(camera.near), uniform(camera.far));
}
