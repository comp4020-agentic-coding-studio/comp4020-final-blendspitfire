import * as THREE from "three";
import { AMBIENT_GROUND, AMBIENT_SKY, EMIT_REACTOR, EMIT_RED, FAR, LIGHT_INCANDESCENT } from "../shared/palette.ts";
import { LAMPS, LAMP_SPECS, type Lamp } from "./world/dressing.ts";

/**
 * How high the camera sits over the player, looking straight down. At 16
 * up with a 50° vertical field of view it shows about 15 units top to
 * bottom --- roughly 72 px per unit on a 1080-tall window.
 */
export const CAMERA_ALTITUDE = 16;
export const CAMERA_FOV = 50;

/**
 * The lighting every view of the facility shares. Underground, so no sun:
 * a very dim cold ambient so the dark keeps its shape, and then the light
 * comes from the lamps --- a fixed pool of point lights (no shadows),
 * handed each frame to the lamps nearest the viewer. A fixed count means
 * shaders never recompile as you walk; no shadows and a low internal
 * resolution keep 8 lights cheap. Every lamp's fixture also glows
 * (emissive), so lamps outside the pool still read as lights.
 */
const POOL = 8;
const AMBIENT = 0.55;

export interface Lighting {
  /** call every frame: which lamps light the scene, flicker, pulses, objective glow */
  update(viewX: number, viewZ: number, time: number, state: { reactorActive: boolean }, visible?: (lamp: Lamp) => boolean): void;
}

/** a small hash for per-lamp flicker that's the same on every client */
const hash = (n: number): number => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};

/** `pool` overrides how many point lights are live at once (the overview lights every lamp) */
export function setupLighting(scene: THREE.Scene, reactor?: { x: number; z: number }, pool = POOL): Lighting {
  scene.background = new THREE.Color(FAR);
  scene.add(new THREE.HemisphereLight(AMBIENT_SKY, AMBIENT_GROUND, AMBIENT));

  const lights = Array.from({ length: pool }, () => {
    const light = new THREE.PointLight(0xffffff, 0, 8, 1.6);
    scene.add(light);
    return light;
  });
  const reactorLight = new THREE.PointLight(EMIT_RED, 0, 9, 1.4);
  if (reactor) {
    reactorLight.position.set(reactor.x, 2.4, reactor.z);
    scene.add(reactorLight);
  }

  const lamps = LAMPS.map((lamp, i) => ({ lamp, spec: LAMP_SPECS[lamp.kind], seed: i + 1, color: new THREE.Color(LAMP_SPECS[lamp.kind].light) }));

  return {
    update(viewX, viewZ, time, state, visible) {
      const brightness = (l: (typeof lamps)[number]): number => {
        if (l.lamp.dead) return 0;
        if (l.lamp.kind === "emergency") {
          // a faint standby glow, a slow sweep once the reactor's live
          return state.reactorActive ? 0.25 + 0.75 * Math.max(0, Math.sin(time * 3 + l.seed)) : 0.12;
        }
        if (l.lamp.flicker) {
          const t = Math.floor(time * 12 + l.seed * 7);
          return hash(t) < 0.18 ? 0.05 : hash(t + 0.5) < 0.1 ? 0.5 : 1;
        }
        return 1;
      };
      const ranked = lamps
        .map((l) => ({ l, d: Math.hypot(l.lamp.x - viewX, l.lamp.z - viewZ), b: brightness(l) }))
        .filter((r) => r.b > 0 && (!visible || visible(r.l.lamp)))
        .sort((a, b) => a.d - b.d);
      lights.forEach((light, i) => {
        const r = ranked[i];
        if (!r) {
          light.intensity = 0;
          return;
        }
        const { lamp, spec, color } = r.l;
        light.color.copy(color);
        light.distance = spec.range;
        light.position.set(lamp.x, spec.height - 0.1, lamp.z);
        // ease the farthest pooled lamps out, so a light swapping in or out isn't a pop
        const fade = i < pool - 2 ? 1 : 1 - (i - (pool - 3)) * 0.3;
        light.intensity = spec.intensity * r.b * fade;
      });
      if (reactor) {
        reactorLight.color.setHex(state.reactorActive ? EMIT_REACTOR : EMIT_RED);
        reactorLight.intensity = state.reactorActive ? 12 + 2 * Math.sin(time * 2) : 2.5 + 0.8 * Math.sin(time * 1.3);
      }
    },
  };
}

/**
 * The local player's torch: a spotlight from the shoulder in the aim
 * direction, and the only shadow-casting light --- its shadows swing as
 * you turn, the thing that makes a dark room feel unsafe.
 */
export function createTorch(scene: THREE.Scene): { light: THREE.SpotLight; aim(x: number, z: number, rotation: number): void } {
  const light = new THREE.SpotLight(LIGHT_INCANDESCENT, 18, 13, 0.62, 0.55, 1.4);
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  light.shadow.camera.near = 0.3;
  light.shadow.camera.far = 14;
  light.shadow.bias = -0.002;
  scene.add(light);
  scene.add(light.target);
  return {
    light,
    aim(x, z, rotation) {
      light.position.set(x, 1.5, z);
      light.target.position.set(x + Math.sin(rotation) * 4, 0.2, z + Math.cos(rotation) * 4);
    },
  };
}

export function configureRenderer(renderer: THREE.WebGLRenderer): void {
  // fill rate is what a laptop GPU runs out of first; 1.5 is still crisp on
  // a retina screen at under 60% of the pixels of 2
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
}

let glowTexture: THREE.CanvasTexture | undefined;

/**
 * A soft additive halo, for things that should look lit from within
 * (projectiles, lamps, the player's shoulder light). A sprite with a radial
 * gradient instead of a bloom pass: bloom would re-process the whole screen
 * every frame for the sake of a few small bright things.
 */
export function glow(color: number, size: number, opacity = 1): THREE.Sprite {
  if (!glowTexture) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    glowTexture = new THREE.CanvasTexture(c);
  }
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture,
      color,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity,
    }),
  );
  sprite.scale.setScalar(size);
  return sprite;
}

/** a glow halo at every live lamp's fixture, as one group */
export function lampHalos(): THREE.Group {
  const g = new THREE.Group();
  for (const lamp of LAMPS) {
    if (lamp.dead) continue;
    const spec = LAMP_SPECS[lamp.kind];
    const s = glow(spec.emit, lamp.kind === "emergency" ? 0.9 : 1.6, lamp.kind === "emergency" ? 0.5 : 0.35);
    s.position.set(lamp.x, spec.height - 0.05, lamp.z);
    g.add(s);
  }
  return g;
}
