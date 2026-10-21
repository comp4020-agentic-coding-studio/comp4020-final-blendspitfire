import * as THREE from "three";
import { AMBIENT_GROUND, AMBIENT_SKY, EMIT_REACTOR, EMIT_RED, FAR, LIGHT_INCANDESCENT } from "../shared/palette.ts";
import { FACING_DIR, LAMPS, LAMP_SPECS, lampSource, type Lamp } from "./world/dressing.ts";

/**
 * How high the camera sits over the player, looking straight down. At 16
 * up with a 50° vertical field of view it shows about 15 units top to
 * bottom --- roughly 72 px per unit on a 1080-tall window.
 */
export const CAMERA_ALTITUDE = 16;
export const CAMERA_FOV = 50;
/** the facility's fill strength, for fading it against the surface's sun */
export const FACILITY_AMBIENT = 0.55;

/**
 * The lighting every view of the facility shares. Underground, so no sun:
 * a very dim cold ambient so the dark keeps its shape, and then the light
 * comes from the lamps --- a fixed pool of point lights (no shadows),
 * handed each frame to the lamps nearest the viewer. A fixed count means
 * shaders never recompile as you walk; no shadows and a low internal
 * resolution keep 8 lights cheap. Every lamp also has a halo (a wall
 * lamp's at its fixture, a ceiling lamp's on the floor under it), so lamps
 * outside the pool still read as lights.
 */
const POOL = 8;
const AMBIENT = FACILITY_AMBIENT;

export interface Lighting {
  /** the facility's dim cold fill, faded out on the surface */
  ambient: THREE.HemisphereLight;
  /** call every frame: which lamps light the scene, flicker, pulses, objective glow */
  update(viewX: number, viewZ: number, time: number, state: LightState, visible?: (lamp: Lamp) => boolean): void;
}

/**
 * What the facility's power is doing. `power` is "normal" day to day;
 * "full" once the run's won (every lamp on, the dead ones too, after a
 * staggered flicker-up from `since`); "out" once the reactor's dead (not a
 * lamp lit: the torch is all there is).
 */
export interface LightState {
  reactorActive: boolean;
  power?: "normal" | "full" | "out";
  /** seconds (on the update's clock) the power last changed: for the flicker-up */
  since?: number;
}

/** a small hash for per-lamp flicker that's the same on every client */
const hash = (n: number): number => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};

/** `pool` overrides how many point lights are live at once (the overview lights every lamp) */
export function setupLighting(scene: THREE.Scene, reactor?: { x: number; z: number }, pool = POOL): Lighting {
  scene.background = new THREE.Color(FAR);
  const ambient = new THREE.HemisphereLight(AMBIENT_SKY, AMBIENT_GROUND, AMBIENT);
  scene.add(ambient);

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

  const lamps = LAMPS.map((lamp, i) => ({
    lamp,
    at: lampSource(lamp),
    spec: LAMP_SPECS[lamp.kind],
    seed: i + 1,
    color: new THREE.Color(LAMP_SPECS[lamp.kind].light),
  }));

  return {
    ambient,
    update(viewX, viewZ, time, state, visible) {
      const power = state.power ?? "normal";
      const brightness = (l: (typeof lamps)[number]): number => {
        if (power === "out") return 0;
        if (power === "full") {
          // the alarm's over: the red emergency lamps go off, everything else comes up
          if (l.lamp.kind === "emergency") return 0;
          // each lamp catches at its own moment over the first two seconds, with a stutter, then holds
          const t = time - (state.since ?? 0) - hash(l.seed * 3.1) * 2;
          if (t < 0) return 0;
          if (t < 0.35) return hash(Math.floor(t * 30) + l.seed) < 0.5 ? 0.15 : 1.8;
          return 1.8;
        }
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
        .map((l) => ({ l, d: Math.hypot(l.at.x - viewX, l.at.z - viewZ), b: brightness(l) }))
        .filter((r) => r.b > 0 && (!visible || visible(r.l.lamp)))
        .sort((a, b) => a.d - b.d);
      // powered up, the pooled lamps reach further: the room fills instead of pooling
      const reach = power === "full" ? 1.6 : 1;
      lights.forEach((light, i) => {
        const r = ranked[i];
        if (!r) {
          light.intensity = 0;
          return;
        }
        const { at, spec, color } = r.l;
        light.color.copy(color);
        light.distance = spec.range * reach;
        light.position.set(at.x, spec.height - 0.1, at.z);
        // ease the farthest pooled lamps out, so a light swapping in or out isn't a pop
        const fade = i < pool - 2 ? 1 : 1 - (i - (pool - 3)) * 0.3;
        light.intensity = spec.intensity * r.b * fade;
      });
      if (reactor) {
        reactorLight.color.setHex(state.reactorActive ? EMIT_REACTOR : EMIT_RED);
        reactorLight.intensity =
          power === "out" ? 0 : power === "full" ? 16 : state.reactorActive ? 12 + 2 * Math.sin(time * 2) : 2.5 + 0.8 * Math.sin(time * 1.3);
      }
    },
  };
}

/**
 * The local player's torch: a headlamp at the front edge of the cap brim,
 * pointing where you aim, and the only shadow-casting light --- its shadows
 * swing as you turn, the thing that makes a dark room feel unsafe. Sitting
 * at the brim's edge, your head and cap are behind it while your hands and
 * whatever you hold are in front and below, so they throw a shadow down the
 * beam the way a real headlamp would.
 */
/** the headlamp's place on a character: the front edge of the cap brim */
const HEADLAMP = { y: 1.43, forward: 0.37 };

export function createTorch(scene: THREE.Scene): { light: THREE.SpotLight; aim(x: number, z: number, rotation: number): void } {
  const light = new THREE.SpotLight(LIGHT_INCANDESCENT, 18, 13, 0.62, 0.55, 1.4);
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  light.shadow.camera.near = 0.1;
  light.shadow.camera.far = 14;
  light.shadow.bias = -0.002;
  scene.add(light);
  scene.add(light.target);
  return {
    light,
    aim(x, z, rotation) {
      light.position.set(x + Math.sin(rotation) * HEADLAMP.forward, HEADLAMP.y, z + Math.cos(rotation) * HEADLAMP.forward);
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

/**
 * A crawler's eyes as a light caught by a lens: a hot core, a soft bloom,
 * and a four-point star whose arms stretch and shiver on their own. The
 * nearer the crawler, the brighter and longer the star and the harder it
 * trembles; close in, a lens halo rings it and a flat streak cuts across,
 * so the pack reads in the dark by its eyes before its shape. The core is
 * pushed past 1 into the HDR target, so the tone map burns it to white.
 */
export interface CrawlerEyes {
  group: THREE.Group;
  /** `distance` from the viewer in world units; `time` in seconds */
  step(distance: number, time: number): void;
}

const EYE_RED = new THREE.Color(EMIT_RED);

const flareTextures = new Map<string, THREE.CanvasTexture>();
/** a cached white-on-black canvas texture, drawn once per kind */
function flareTexture(kind: "star" | "ring" | "streak"): THREE.CanvasTexture {
  let t = flareTextures.get(kind);
  if (t) return t;
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S - 0.5;
      const v = (y + 0.5) / S - 0.5;
      const r = Math.hypot(u, v) * 2;
      let a: number;
      if (kind === "star") {
        // two thin arms tapering to nothing at the edge, brightest at the crossing
        const arm = (along: number, across: number): number => Math.exp(-((across / 0.012) ** 2)) * Math.max(0, 1 - Math.abs(along) * 2) ** 2;
        a = Math.min(1, arm(u, v) + arm(v, u));
      } else if (kind === "ring") {
        a = 0.6 * Math.exp(-(((r - 0.78) / 0.05) ** 2)) + 0.12 * Math.exp(-(((r - 0.5) / 0.12) ** 2));
      } else {
        a = Math.exp(-((v / 0.03) ** 2)) * Math.max(0, 1 - Math.abs(u) * 2) ** 1.5;
      }
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * a);
    }
  }
  ctx.putImageData(img, 0, 0);
  t = new THREE.CanvasTexture(c);
  flareTextures.set(kind, t);
  return t;
}

function flareSprite(kind: "star" | "ring" | "streak"): THREE.Sprite {
  return new THREE.Sprite(
    new THREE.SpriteMaterial({ map: flareTexture(kind), color: EMIT_RED, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
  );
}

export function crawlerEyes(seed: number): CrawlerEyes {
  const group = new THREE.Group();
  const bloom = glow(EMIT_RED, 2, 0.4);
  const core = glow(EMIT_RED, 0.55, 1);
  const star = flareSprite("star");
  const ring = flareSprite("ring");
  const streak = flareSprite("streak");
  group.add(bloom, ring, streak, star, core);
  // a little noise from a few unrelated sines: no two crawlers shiver together
  const wobble = (time: number, k: number): number =>
    Math.sin(time * (17 + k) + seed * (2.3 + k)) * 0.5 + Math.sin(time * (43 + 2 * k) + seed * (5.1 + k)) * 0.3 + Math.sin(time * (71 + 3 * k) + seed * 1.7) * 0.2;
  return {
    group,
    step(distance, time) {
      const near = 1 - THREE.MathUtils.smoothstep(distance, 1.5, 11);
      // the tremble grows as it closes in: barely a shimmer far off, a real flutter up close
      const amp = 0.04 + 0.16 * near * near;
      const flicker = 1 + amp * wobble(time, 0);
      bloom.scale.setScalar((1.1 + 0.9 * near) * (1 + 0.3 * amp * wobble(time, 1)));
      bloom.material.opacity = (0.2 + 0.35 * near) * flicker;
      core.scale.setScalar(0.45 + 0.25 * near);
      core.material.color.copy(EYE_RED).multiplyScalar((1.6 + 2.6 * near) * flicker);
      // each arm of the star stretches on its own, so its edges shiver rather than the whole thing pulsing
      const arm = 1.4 + 2.2 * near;
      star.scale.set(arm * (1 + 1.5 * amp * wobble(time, 2)), arm * (1 + 1.5 * amp * wobble(time, 3)), 1);
      star.material.rotation = 0.04 * amp * wobble(time, 4);
      star.material.color.copy(EYE_RED).multiplyScalar((0.9 + 1.8 * near) * flicker);
      // right up close the lens itself starts to show: a halo round the light, a flat streak across it
      const close = THREE.MathUtils.smoothstep(near, 0.6, 0.95);
      ring.visible = streak.visible = close > 0;
      ring.scale.setScalar(2 + 0.5 * close);
      ring.material.opacity = 0.38 * close * flicker;
      streak.scale.set((4 + 3 * close) * (1 + amp * wobble(time, 5)), 0.5, 1);
      streak.material.color.copy(EYE_RED).multiplyScalar(1.2 * close * flicker);
    },
  };
}

/**
 * A halo for every live lamp, as one group. A wall lamp's sits on its
 * fixture. A ceiling lamp's fixture isn't drawn (it's above the camera's
 * cut), so its halo is a faint wide pool on the floor beneath it --- the
 * light arriving, not the lamp.
 */
export function lampHalos(): THREE.Group {
  const g = new THREE.Group();
  for (const lamp of LAMPS) {
    if (lamp.dead) continue;
    const spec = LAMP_SPECS[lamp.kind];
    if (lamp.mount === "wall") {
      const d = FACING_DIR[lamp.facing ?? "south"];
      const s = glow(spec.emit, lamp.kind === "emergency" ? 0.9 : 1.4, lamp.kind === "emergency" ? 0.5 : 0.35);
      s.position.set(lamp.x + d.x * 0.25, spec.height, lamp.z + d.z * 0.25);
      g.add(s);
    } else {
      const s = glow(spec.light, spec.range * 0.6, 0.1);
      s.position.set(lamp.x, 0.05, lamp.z);
      g.add(s);
    }
  }
  return g;
}
