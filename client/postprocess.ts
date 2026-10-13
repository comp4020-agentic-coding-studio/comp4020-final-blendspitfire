import * as THREE from "three";
import type { Grade } from "./assets/grade.ts";

// Every frame goes through here: the scene renders into an off-screen
// target (low-res when pixelated, full-res otherwise), then one full-screen
// pass composites it onto the canvas --- exposure, tone mapping, the colour
// grade from client/assets/grade.ts, sRGB output, the line-of-sight mask
// (what the player can't see is black), a vignette and an ordered dither.
//
// Rendering into a target skips three.js's own tone mapping and sRGB
// conversion (it only applies them when drawing to the canvas), so both
// are done here --- otherwise the image comes out darker and colder than
// lit. The target is half-float where the GPU allows, so bright lamps can
// exceed 1 before tone mapping rolls them off.
//
// Pixelation is a cheap retro look *and* a performance win: a laptop GPU is
// fragment-bound, and lighting 1/6 of the pixels dominates the cost of one
// extra full-screen blit.

const vertex = /* glsl */ `
  attribute vec3 position;
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragment = /* glsl */ `
  precision highp float;
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform sampler2D tMask;
  uniform mat4 invViewProj;
  uniform vec2 maskCenter;
  uniform float maskExtent;
  uniform float maskOn;
  uniform float topCutoff;
  uniform float exposure;
  uniform float contrast;
  uniform float saturation;
  uniform vec3 shadowTint;
  uniform vec3 highlightTint;
  uniform float tintStrength;
  uniform float blackLift;
  uniform float vignette;
  uniform float ditherAmount;
  uniform vec2 aspect;
  varying vec2 vUv;

  // three.js's Neutral tone mapper (Khronos PBR Neutral), ported
  vec3 neutral(vec3 color) {
    const float startCompression = 0.8 - 0.04;
    const float desaturation = 0.15;
    float x = min(color.r, min(color.g, color.b));
    float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
    color -= offset;
    float peak = max(color.r, max(color.g, color.b));
    if (peak < startCompression) return color;
    float d = 1.0 - startCompression;
    float newPeak = 1.0 - d * d / (peak + d - startCompression);
    color *= newPeak / peak;
    float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
    return mix(color, vec3(newPeak), g);
  }

  vec3 toSrgb(vec3 c) {
    vec3 lo = c * 12.92;
    vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
    return mix(lo, hi, step(vec3(0.0031308), c));
  }

  float bayer(vec2 p) {
    int index = int(mod(p.x, 4.0)) + int(mod(p.y, 4.0)) * 4;
    if (index == 0) return 0.0 / 16.0 - 0.5;
    if (index == 1) return 8.0 / 16.0 - 0.5;
    if (index == 2) return 2.0 / 16.0 - 0.5;
    if (index == 3) return 10.0 / 16.0 - 0.5;
    if (index == 4) return 12.0 / 16.0 - 0.5;
    if (index == 5) return 4.0 / 16.0 - 0.5;
    if (index == 6) return 14.0 / 16.0 - 0.5;
    if (index == 7) return 6.0 / 16.0 - 0.5;
    if (index == 8) return 3.0 / 16.0 - 0.5;
    if (index == 9) return 11.0 / 16.0 - 0.5;
    if (index == 10) return 1.0 / 16.0 - 0.5;
    if (index == 11) return 9.0 / 16.0 - 0.5;
    if (index == 12) return 15.0 / 16.0 - 0.5;
    if (index == 13) return 7.0 / 16.0 - 0.5;
    if (index == 14) return 13.0 / 16.0 - 0.5;
    return 5.0 / 16.0 - 0.5;
  }

  void main() {
    vec3 c = texture2D(tColor, vUv).rgb * exposure;
    c = neutral(c);
    // grade, in linear light
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(luma), c, saturation);
    vec3 tint = mix(shadowTint * 4.0, highlightTint, smoothstep(0.0, 0.5, luma));
    c = mix(c, c * tint, tintStrength);
    c = toSrgb(clamp(c, 0.0, 1.0));
    c = (c - 0.5) * contrast + 0.5;
    c = blackLift + c * (1.0 - blackLift);

    // line of sight: rebuild the world position of this pixel from depth
    // and look it up in the mask; unseen goes to true black
    if (maskOn > 0.5) {
      float depth = texture2D(tDepth, vUv).r;
      vec4 ndc = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
      vec4 world = invViewProj * ndc;
      world /= world.w;
      vec2 muv = (world.xz - maskCenter) / (2.0 * maskExtent) + 0.5;
      // the mask is drawn looking down with -Z up, so z runs top to bottom
      muv.y = 1.0 - muv.y;
      float seen = texture2D(tMask, muv).r;
      // wall tops (and anything at wall height) are out of sight: a wall's
      // face shows, its top is black, so walls read as cut-outs into dark
      seen *= 1.0 - smoothstep(topCutoff - 0.05, topCutoff, world.y);
      if (muv.x < 0.0 || muv.x > 1.0 || muv.y < 0.0 || muv.y > 1.0) seen = 0.0;
      c *= seen;
    }

    vec2 v = (vUv - 0.5) * aspect;
    c *= 1.0 - vignette * smoothstep(0.35, 0.95, length(v));
    c += bayer(gl_FragCoord.xy) * ditherAmount;
    gl_FragColor = vec4(c, 1.0);
  }
`;

export interface PostProcess {
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  setSize(width: number, height: number): void;
  /**
   * the line-of-sight mask to apply, or null to show everything. `topCutoff`
   * is the height above which everything is out of sight (just under the
   * wall tops).
   */
  setMask(mask: { texture: THREE.Texture; center: THREE.Vector2; extent: number; topCutoff: number } | null): void;
}

/**
 * `scale` is the internal render size as a fraction of the window (1 = no
 * pixelation). `grade` is read every frame, so changing its fields takes
 * effect immediately.
 */
export function createPostProcess(renderer: THREE.WebGLRenderer, scale: number, grade: Grade): PostProcess {
  const filter = scale < 1 ? THREE.NearestFilter : THREE.LinearFilter;
  const type = renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const depthTexture = new THREE.DepthTexture(1, 1);
  depthTexture.type = THREE.UnsignedIntType;
  const target = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: filter,
    magFilter: filter,
    type,
    depthBuffer: true,
    depthTexture,
  });
  // the scene's linear output stays linear in the target; this pass converts
  renderer.toneMapping = THREE.NoToneMapping;

  const quad = new THREE.BufferGeometry();
  // xyz rather than xy: three.js computes a bounding sphere from three components and gets NaN otherwise
  quad.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  blank.needsUpdate = true;
  const uniforms = {
    tColor: { value: target.texture },
    tDepth: { value: depthTexture },
    tMask: { value: blank as THREE.Texture },
    invViewProj: { value: new THREE.Matrix4() },
    maskCenter: { value: new THREE.Vector2() },
    maskExtent: { value: 1 },
    maskOn: { value: 0 },
    topCutoff: { value: 2.45 },
    exposure: { value: 1 },
    contrast: { value: 1 },
    saturation: { value: 1 },
    shadowTint: { value: new THREE.Vector3() },
    highlightTint: { value: new THREE.Vector3() },
    tintStrength: { value: 0 },
    blackLift: { value: 0 },
    vignette: { value: 0 },
    ditherAmount: { value: 0 },
    aspect: { value: new THREE.Vector2(1, 1) },
  };
  const material = new THREE.RawShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(quad, material);
  mesh.frustumCulled = false;
  const blitScene = new THREE.Scene();
  blitScene.add(mesh);
  const blitCamera = new THREE.Camera();

  return {
    setSize(width, height) {
      target.setSize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
      const a = width / height;
      uniforms.aspect.value.set(a > 1 ? a : 1, a > 1 ? 1 : 1 / a);
    },
    setMask(mask) {
      if (!mask) {
        uniforms.maskOn.value = 0;
        return;
      }
      uniforms.maskOn.value = 1;
      uniforms.tMask.value = mask.texture;
      // hold the mask's own vector, not a copy: it moves with the viewer every frame
      uniforms.maskCenter.value = mask.center;
      uniforms.maskExtent.value = mask.extent;
      uniforms.topCutoff.value = mask.topCutoff;
    },
    render(scene, camera) {
      uniforms.exposure.value = grade.exposure;
      uniforms.contrast.value = grade.contrast;
      uniforms.saturation.value = grade.saturation;
      uniforms.shadowTint.value.set(...grade.shadowTint);
      uniforms.highlightTint.value.set(...grade.highlightTint);
      uniforms.tintStrength.value = grade.tintStrength;
      uniforms.blackLift.value = grade.blackLift;
      uniforms.vignette.value = grade.vignette;
      uniforms.ditherAmount.value = grade.dither;
      camera.updateMatrixWorld();
      uniforms.invViewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();

      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(blitScene, blitCamera);
    },
  };
}
