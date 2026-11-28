import * as THREE from 'three/webgpu';
import { builtinAOContext, mrt, normalView, packNormalToRGB, pass, sample, screenUV, unpackRGBToNormal, velocity } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

/**
 * WebGPU renderer (WebGL2 fallback when navigator.gpu is absent) with a pipeline of
 * normal/depth/velocity pre-pass -> GTAO fed into the ambient term -> temporal AA -> bloom.
 */
export async function createRenderer(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
  // MSAA is off: the temporal resolve below does the anti-aliasing.
  const renderer = new THREE.WebGPURenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.65; // Sky.setTime applies the per-time-of-day value from world/lighting.ts
  renderer.shadowMap.enabled = true;
  await renderer.init();

  // Pre-pass: packed view normals + velocity (depth comes with every pass).
  const prePass = pass(scene, camera);
  prePass.transparent = false;
  prePass.setMRT(mrt({ output: packNormalToRGB(normalView), velocity }));
  prePass.getTexture('output').type = THREE.UnsignedByteType;
  const prePassNormal = sample((uv) => unpackRGBToNormal(prePass.getTextureNode().sample(uv)));
  const prePassDepth = prePass.getTextureNode('depth');
  const prePassVelocity = prePass.getTextureNode('velocity');

  const aoPass = ao(prePassDepth, prePassNormal, camera);
  aoPass.radius.value = 1.2;
  aoPass.resolutionScale = 0.5;
  aoPass.useTemporalFiltering = true;

  // Beauty pass: occlusion attenuates indirect light only, not direct sun.
  const scenePass = pass(scene, camera);
  scenePass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);

  const taa = traa(scenePass, prePassDepth, prePassVelocity, camera);
  taa.useSubpixelCorrection = false;

  const post = new THREE.RenderPipeline(renderer);
  post.outputNode = taa.add(bloom(taa, 0.25, 0.4, 1.0));

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  return { renderer, post };
}
