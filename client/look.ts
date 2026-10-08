import * as THREE from "three";
import { FAR, HEMI_GROUND, HEMI_SKY, SUN } from "../shared/palette.ts";

/**
 * The lighting every view of the world shares: a warm/plum hemisphere so
 * shaded faces lean cool, and one warm, low-ish sun so shadows fall clearly
 * sideways --- from straight overhead, shadows are most of what tells you
 * how tall something is. `extent` is the half-size of the area that needs
 * crisp shadows.
 */
export function setupLighting(scene: THREE.Scene, extent: number): THREE.DirectionalLight {
  scene.background = new THREE.Color(FAR);
  scene.add(new THREE.HemisphereLight(HEMI_SKY, HEMI_GROUND, 0.9));
  const sun = new THREE.DirectionalLight(SUN, 1.9);
  sun.position.set(12, 22, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -extent;
  sun.shadow.camera.right = extent;
  sun.shadow.camera.top = extent;
  sun.shadow.camera.bottom = -extent;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(sun.target);
  return sun;
}

export function configureRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}
