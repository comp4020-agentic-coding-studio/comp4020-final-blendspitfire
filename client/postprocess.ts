import * as THREE from "three";
import type { Grade } from "./assets/grade.ts";

// Every frame goes through here: the scene renders into an off-screen
// target (low-res when pixelated, full-res otherwise), then one full-screen
// pass composites it onto the canvas --- exposure, tone mapping, the colour
// grade from client/assets/grade.ts, sRGB output, the line-of-sight mask
// (what the player can't see is black), a vignette and an ordered dither.
// On top of that, two effects the game turns on: being dazed by a wound
// (blur, a pulsing dark-red closing-in) and spectating (an old CRT: barrel
// distortion, scanlines, colour fringing, noise and the odd rolling jolt).
// And one for the surface: "paint", an impressionist look (Kuwahara brush
// strokes, warm high-key grade, canvas grain) that fades in when the viewer
// is up in the garden, in place of the facility's grade. What's out of sight
// is black on both levels.
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
  uniform vec2 texel;
  uniform float daze;
  uniform float crt;
  uniform float paint;
  uniform float time;
  uniform float levels;
  uniform float scanlines;
  uniform float grain;
  uniform vec2 lowRes;
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

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  // the scene at uv, blurred by up to radius texels (a ring of taps around the centre)
  vec3 sampleScene(vec2 uv, float radius) {
    vec3 c = texture2D(tColor, uv).rgb;
    if (radius <= 0.0) return c;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398;
      c += texture2D(tColor, uv + vec2(cos(a), sin(a)) * texel * radius).rgb;
    }
    return c / 9.0;
  }

  // Kuwahara: of the four quadrants around this pixel, take the mean of the
  // calmest. Flat regions stay flat, edges stay sharp, and texture breaks
  // into blobs of single colour: a brush stroke rather than a pixel.
  vec3 kuwahara(vec2 uv) {
    vec3 m[4];
    vec3 s[4];
    for (int k = 0; k < 4; k++) { m[k] = vec3(0.0); s[k] = vec3(0.0); }
    for (int j = 0; j <= 2; j++) {
      for (int i = 0; i <= 2; i++) {
        vec3 a = texture2D(tColor, uv + vec2(-float(i), -float(j)) * texel).rgb;
        vec3 b = texture2D(tColor, uv + vec2(float(i), -float(j)) * texel).rgb;
        vec3 c = texture2D(tColor, uv + vec2(-float(i), float(j)) * texel).rgb;
        vec3 d = texture2D(tColor, uv + vec2(float(i), float(j)) * texel).rgb;
        m[0] += a; s[0] += a * a;
        m[1] += b; s[1] += b * b;
        m[2] += c; s[2] += c * c;
        m[3] += d; s[3] += d * d;
      }
    }
    vec3 best = m[0] / 9.0;
    float bestVar = 1e9;
    for (int k = 0; k < 4; k++) {
      vec3 mean = m[k] / 9.0;
      vec3 v = abs(s[k] / 9.0 - mean * mean);
      float total = v.r + v.g + v.b;
      if (total < bestVar) { bestVar = total; best = mean; }
    }
    return best;
  }

  void main() {
    vec2 uv = vUv;
    // CRT: bulge the picture as if on curved glass, and now and then a band rolls sideways
    if (crt > 0.0) {
      vec2 cc = uv - 0.5;
      uv = 0.5 + cc * (1.0 + crt * 0.12 * dot(cc, cc) * 4.0) * (1.0 - crt * 0.04);
      float band = step(0.985, hash(vec2(floor(time * 6.0), 1.0)));
      uv.x += crt * band * 0.012 * sin(uv.y * 40.0 + time * 30.0);
    }
    vec3 c;
    if (crt > 0.0) {
      // colour fringing: red and blue a hair either side
      float shift = crt * 1.6;
      c = vec3(
        sampleScene(uv + vec2(texel.x * shift, 0.0), 0.0).r,
        sampleScene(uv, 0.0).g,
        sampleScene(uv - vec2(texel.x * shift, 0.0), 0.0).b
      );
    } else {
      // dazed: the picture swims in and out of focus
      c = sampleScene(uv, daze * (2.0 + 1.5 * sin(time * 2.2)));
    }
    vec3 under = c;
    under *= exposure;
    under = neutral(under);
    // grade, in linear light
    float luma = dot(under, vec3(0.2126, 0.7152, 0.0722));
    under = mix(vec3(luma), under, saturation);
    vec3 tint = mix(shadowTint * 4.0, highlightTint, smoothstep(0.0, 0.5, luma));
    under = mix(under, under * tint, tintStrength);
    under = toSrgb(clamp(under, 0.0, 1.0));
    under = (under - 0.5) * contrast + 0.5;
    under = blackLift + under * (1.0 - blackLift);
    c = under;
    if (paint > 0.0) {
      // the surface: strokes, then a warm, bright, soft grade
      vec3 p = kuwahara(uv) * 1.1;
      p = neutral(p);
      float pl = dot(p, vec3(0.2126, 0.7152, 0.0722));
      p = mix(vec3(pl), p, 1.05);
      // shade leans blue-violet, light leans to a warm cream
      p = mix(p * vec3(0.82, 0.88, 1.12), p * vec3(1.08, 1.02, 0.9), smoothstep(0.05, 0.45, pl));
      p = toSrgb(clamp(p, 0.0, 1.0));
      // lifted blacks and gently pulled highlights: nothing harsh
      p = 0.07 + p * 0.9;
      // canvas: a faint woven grain and some slow, uneven pigment
      vec2 fc = gl_FragCoord.xy;
      float weave = sin(fc.x * 1.7) * sin(fc.y * 1.7) * 0.012;
      float blot = (hash(floor(fc / 6.0)) - 0.5) * 0.03;
      p += weave + blot;
      c = mix(c, p, paint);
    }

    // line of sight: rebuild the world position of this pixel from depth
    // and look it up in the mask; unseen goes to true black
    if (maskOn > 0.5) {
      float depth = texture2D(tDepth, uv).r;
      vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
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
      // unseen is black on both levels: the painted look is for what you can see
      c = mix(vec3(0.0), c, seen);
    }

    vec2 v = (vUv - 0.5) * aspect;
    // the surface gets a soft warm halo at the edges instead of a dark vignette
    c *= 1.0 - vignette * (1.0 - paint) * smoothstep(0.35, 0.95, length(v));
    c = mix(c, c * vec3(1.04, 1.0, 0.92) + vec3(0.03, 0.025, 0.0), paint * smoothstep(0.4, 1.0, length(v)));
    if (daze > 0.0) {
      // the edges close in, dark red, pulsing with the swim
      float edge = smoothstep(0.35, 0.9, length(v)) * daze * (0.8 + 0.2 * sin(time * 2.2));
      c = mix(c, vec3(0.2, 0.01, 0.01), edge * 0.75);
    }
    if (crt > 0.0) {
      // greyed-green phosphor, scanlines, noise, and black outside the curved glass
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c, vec3(l * 0.85, l * 1.05, l * 0.9), crt * 0.55);
      c *= 1.0 - crt * 0.35 * (0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159 * 0.5));
      c += crt * (hash(gl_FragCoord.xy + fract(time) * 100.0) - 0.5) * 0.12;
      c *= 1.0 - crt * 0.6 * smoothstep(0.3, 0.75, length(v));
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) c = vec3(0.0);
    }
    // the retro screen, underground: on the low-res grid, so every effect sits on the big pixels
    float retro = 1.0 - paint;
    vec2 px = floor(vUv * lowRes);
    if (levels > 0.0 && retro > 0.0) {
      // crush to a few levels per channel, the step hidden by a dither fixed to each big pixel
      vec3 q = floor(c * levels + 0.5 + bayer(px) * 0.9) / levels;
      c = mix(c, q, retro);
      // a dark line along the bottom of every pixel row
      float row = fract(vUv.y * lowRes.y);
      c *= 1.0 - scanlines * retro * smoothstep(0.55, 1.0, row);
      // grain that crawls a few times a second, not every frame
      c += (hash(px + floor(time * 12.0)) - 0.5) * grain * retro;
    }
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
  /** the game's screen effects, 0 (off) to 1 (full): dazed by a wound, the spectator's CRT, the surface's paint */
  effects: { daze: number; crt: number; paint: number };
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
    texel: { value: new THREE.Vector2(1, 1) },
    daze: { value: 0 },
    crt: { value: 0 },
    paint: { value: 0 },
    time: { value: 0 },
    levels: { value: 0 },
    scanlines: { value: 0 },
    grain: { value: 0 },
    lowRes: { value: new THREE.Vector2(1, 1) },
  };
  const effects = { daze: 0, crt: 0, paint: 0 };
  const started = performance.now();
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
    effects,
    setSize(width, height) {
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));
      target.setSize(w, h);
      uniforms.texel.value.set(1 / w, 1 / h);
      uniforms.lowRes.value.set(w, h);
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
      // the retro screen only when there are big pixels to put it on
      uniforms.levels.value = scale < 1 ? grade.levels : 0;
      uniforms.scanlines.value = grade.scanlines;
      uniforms.grain.value = grade.grain;
      uniforms.daze.value = effects.daze;
      uniforms.crt.value = effects.crt;
      uniforms.paint.value = effects.paint;
      uniforms.time.value = (performance.now() - started) / 1000;
      camera.updateMatrixWorld();
      uniforms.invViewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();

      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(blitScene, blitCamera);
    },
  };
}
