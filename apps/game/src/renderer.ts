import * as THREE from 'three/webgpu';
import type { UniformNode } from 'three/webgpu';
import { Pipeline } from './post/Pipeline.ts';
import type { Quality } from './post/quality.ts';

/**
 * WebGPU renderer (WebGL2 fallback when navigator.gpu is absent) and the post-processing pipeline
 * (post/Pipeline.ts: pre-pass, GTAO, temporal AA, reflections, depth of field, bloom, grade, grain).
 */
export async function createRenderer(scene: THREE.Scene, camera: THREE.PerspectiveCamera, night: UniformNode<'float'>, opts: { quality?: Quality; taa: boolean }) {
  // The hardware MSAA is only used on the `taa=0` fallback; otherwise the temporal resolve does the anti-aliasing.
  const renderer = new THREE.WebGPURenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.65; // Sky.setTime applies the per-time-of-day value from world/lighting.ts
  renderer.shadowMap.enabled = true;
  await renderer.init();

  const post = new Pipeline(renderer, scene, camera, night, opts);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  return { renderer, post };
}
