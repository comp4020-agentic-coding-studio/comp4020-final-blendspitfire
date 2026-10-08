import * as THREE from "three";
import { CLOTH, FOLIAGE, GEAR, GROUND, GROUND_ALT, HAIR, ROCK, SKIN, WOOD } from "../../shared/palette.ts";
import { jitter, merge, mesh, part, profile, rng } from "./kit.ts";

// Every model faces +Z (forward) and stands on y = 0 unless noted. Sizes
// are in world units; a player is 0.4 in radius and about 1.6 tall.

const { PI } = Math;

/**
 * A player, dressed casually: T-shirt in their colour, jeans, trainers, and
 * a cap. From straight overhead the cap is most of what shows, and its
 * brim pointing forward is the facing cue --- so the top outline says which
 * way someone faces before they're holding anything.
 */
export function character(color: string): THREE.Mesh {
  const shirt = new THREE.Color(color).getHex();
  const cap = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.1).getHex();
  const brim = new THREE.Color(color).lerp(new THREE.Color(0x000000), 0.25).getHex();
  return mesh(
    merge([
      // trainers
      part(new THREE.BoxGeometry(0.15, 0.08, 0.26), CLOTH.light, -0.11, 0.04, 0.03),
      part(new THREE.BoxGeometry(0.15, 0.08, 0.26), CLOTH.light, 0.11, 0.04, 0.03),
      // jeans
      part(new THREE.BoxGeometry(0.15, 0.5, 0.17), CLOTH.base, -0.11, 0.33, 0),
      part(new THREE.BoxGeometry(0.15, 0.5, 0.17), CLOTH.base, 0.11, 0.33, 0),
      // T-shirt: a slightly tapered box, no armour-like shoulder shapes
      part(new THREE.CylinderGeometry(0.29, 0.24, 0.56, 4, 1), shirt, 0, 0.84, 0, 0, PI / 4, 0, 1, 0.62),
      // short sleeves
      part(new THREE.BoxGeometry(0.13, 0.15, 0.17), shirt, -0.27, 1.02, 0.02),
      part(new THREE.BoxGeometry(0.13, 0.15, 0.17), shirt, 0.27, 1.02, 0.02),
      // forearms reaching forward to where a held item sits
      part(new THREE.BoxGeometry(0.09, 0.09, 0.3), SKIN.base, -0.24, 0.94, 0.17, 0, 0.3, 0),
      part(new THREE.BoxGeometry(0.09, 0.09, 0.3), SKIN.base, 0.24, 0.94, 0.17, 0, -0.3, 0),
      part(new THREE.BoxGeometry(0.1, 0.1, 0.1), SKIN.base, -0.18, 0.94, 0.33),
      part(new THREE.BoxGeometry(0.1, 0.1, 0.1), SKIN.base, 0.18, 0.94, 0.33),
      // neck and head
      part(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 5), SKIN.shade, 0, 1.15, 0),
      part(new THREE.IcosahedronGeometry(0.17, 1), SKIN.base, 0, 1.31, 0),
      // hair showing below the cap at the back
      part(new THREE.BoxGeometry(0.26, 0.1, 0.1), HAIR.base, 0, 1.33, -0.12),
      // cap: a low dome and a brim sticking out forward
      part(new THREE.SphereGeometry(0.185, 7, 3, 0, PI * 2, 0, PI / 2), cap, 0, 1.36, -0.01),
      part(new THREE.BoxGeometry(0.24, 0.03, 0.22), brim, 0, 1.37, 0.25),
    ]),
  );
}

/**
 * An M4A1, built upright in profile (barrel toward +Z, top toward +Y). On
 * the ground it's laid on its side, so from overhead you see the side
 * profile ---
 * barrel and A-frame front sight, handguard, flat-top receiver with carry
 * handle, pistol grip, the forward-curving magazine, and the collapsible
 * stock --- rather than a thin black stick. Oversized (about 1.3 long
 * against a real 0.84 m) so those features survive the camera.
 */
const GUN_SCALE = 1.25;
/** half the gun's thickness once laid on its side: how high it rests off the ground */
export const GUN_REST_HEIGHT = 0.035 * GUN_SCALE;

function gunGeometry(): THREE.BufferGeometry {
  const g = merge([
    // receiver
    part(new THREE.BoxGeometry(0.07, 0.11, 0.3), GEAR.base, 0, 0, -0.02),
    // flat-top rail + carry handle: two posts and a bar
    part(new THREE.BoxGeometry(0.05, 0.03, 0.3), GEAR.shade, 0, 0.07, -0.02),
    part(new THREE.BoxGeometry(0.04, 0.06, 0.03), GEAR.base, 0, 0.11, -0.13),
    part(new THREE.BoxGeometry(0.04, 0.06, 0.03), GEAR.base, 0, 0.11, 0.07),
    part(new THREE.BoxGeometry(0.04, 0.03, 0.23), GEAR.base, 0, 0.15, -0.03),
    // handguard: a stubby hexagonal tube ahead of the receiver
    part(new THREE.CylinderGeometry(0.05, 0.05, 0.24, 6), GEAR.light, 0, 0.01, 0.25, PI / 2, 0, 0),
    // barrel
    part(new THREE.CylinderGeometry(0.02, 0.02, 0.24, 5), GEAR.shade, 0, 0.01, 0.49, PI / 2, 0, 0),
    // the A-frame front sight, the M4's most recognisable outline
    part(
      profile(
        [
          [0.34, 0.03],
          [0.43, 0.03],
          [0.395, 0.15],
          [0.375, 0.15],
        ],
        0.035,
      ),
      GEAR.base,
    ),
    // muzzle device
    part(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 6), GEAR.base, 0, 0.01, 0.62, PI / 2, 0, 0),
    // magazine: three segments, each tipped further forward, for the curve
    part(new THREE.BoxGeometry(0.05, 0.09, 0.075), GEAR.light, 0, -0.1, 0.06, -0.08, 0, 0),
    part(new THREE.BoxGeometry(0.05, 0.09, 0.075), GEAR.light, 0, -0.185, 0.075, -0.25, 0, 0),
    part(new THREE.BoxGeometry(0.05, 0.09, 0.075), GEAR.light, 0, -0.265, 0.105, -0.42, 0, 0),
    // pistol grip, raked back
    part(new THREE.BoxGeometry(0.05, 0.14, 0.055), GEAR.shade, 0, -0.1, -0.11, 0.35, 0, 0),
    // trigger guard
    part(new THREE.BoxGeometry(0.03, 0.015, 0.09), GEAR.shade, 0, -0.075, -0.04),
    // buffer tube
    part(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 6), GEAR.shade, 0, 0.02, -0.24, PI / 2, 0, 0),
    // collapsible stock: a profile that drops toward the butt
    part(
      profile(
        [
          [-0.25, 0.05],
          [-0.44, 0.05],
          [-0.44, -0.1],
          [-0.4, -0.1],
          [-0.27, -0.02],
        ],
        0.06,
      ),
      GEAR.base,
    ),
  ]);
  g.scale(GUN_SCALE, GUN_SCALE, GUN_SCALE);
  return g;
}

/** Lying on the ground, on its side: the profile, not the top edge, faces the camera. */
export function gun(): THREE.Mesh {
  const g = gunGeometry();
  g.rotateZ(PI / 2);
  return mesh(g);
}

/**
 * Held the way a person holds a rifle: upright, top up. From overhead that
 * shows less of the profile than the lying version, but a sideways-held
 * rifle reads as wrong to anyone who's seen one.
 */
export function heldGun(): THREE.Mesh {
  return mesh(gunGeometry());
}

/** where the gun sits relative to its holder, so the grip lands in the hands */
export const HELD_GUN_OFFSET = { x: 0.06, y: 1.08, z: 0.55 };

/** A wooden crate, 1×1×1: a frame of darker planks with a cross-brace on top. */
export function crate(): THREE.Mesh {
  const s = 0.5;
  const t = 0.09;
  const parts = [
    part(new THREE.BoxGeometry(0.94, 0.94, 0.94), WOOD.base, 0, s, 0),
    // top frame
    part(new THREE.BoxGeometry(1, t, t), WOOD.shade, 0, 2 * s - t / 2 + 0.01, s - t / 2),
    part(new THREE.BoxGeometry(1, t, t), WOOD.shade, 0, 2 * s - t / 2 + 0.01, -s + t / 2),
    part(new THREE.BoxGeometry(t, t, 1), WOOD.shade, s - t / 2, 2 * s - t / 2 + 0.01, 0),
    part(new THREE.BoxGeometry(t, t, 1), WOOD.shade, -s + t / 2, 2 * s - t / 2 + 0.01, 0),
    // diagonal brace across the top
    part(new THREE.BoxGeometry(t, t, 1.2), WOOD.light, 0, 2 * s - t / 2 + 0.005, 0, 0, PI / 4, 0),
  ];
  // corner posts
  for (const cx of [-1, 1]) {
    for (const cz of [-1, 1]) {
      parts.push(part(new THREE.BoxGeometry(t, 1, t), WOOD.shade, cx * (s - t / 2), s, cz * (s - t / 2)));
    }
  }
  return mesh(merge(parts));
}

/**
 * A rock filling (roughly) a halfX × halfZ footprint up to `height`: a few
 * jittered polyhedra, so it fills the square collision box without
 * looking like one. `seed` makes each rock different but identical on
 * every client.
 */
export function rock(halfX: number, halfZ: number, height: number, seed: number): THREE.Mesh {
  const random = rng(seed);
  const shades = [ROCK.shade, ROCK.base, ROCK.light];
  const parts: THREE.BufferGeometry[] = [];
  const main = jitter(new THREE.DodecahedronGeometry(1, 0), 0.18, random);
  main.scale(halfX * 1.05, height * 0.55, halfZ * 1.05);
  parts.push(part(main, ROCK.base, 0, height * 0.45, 0, 0, random() * PI, 0));
  for (let i = 0; i < 3; i++) {
    const r = 0.35 + random() * 0.25;
    const bit = jitter(new THREE.IcosahedronGeometry(1, 0), 0.15, random);
    bit.scale(r * halfX, r * height * 0.9, r * halfZ);
    const angle = random() * PI * 2;
    parts.push(
      part(
        bit,
        shades[i % 3],
        Math.cos(angle) * halfX * 0.55,
        r * height * 0.4,
        Math.sin(angle) * halfZ * 0.55,
        0,
        random() * PI,
        0,
      ),
    );
  }
  return mesh(merge(parts));
}

/**
 * A low dry-stone wall along a halfX × halfZ footprint: a body with a
 * lighter capstone row and a post every few units for rhythm.
 */
export function wall(halfX: number, halfZ: number, height: number): THREE.Mesh {
  const parts = [
    part(new THREE.BoxGeometry(halfX * 2, height, halfZ * 2), ROCK.shade, 0, height / 2, 0),
    part(new THREE.BoxGeometry(halfX * 2 + 0.1, 0.14, halfZ * 2 + 0.1), ROCK.light, 0, height + 0.07, 0),
  ];
  const long = Math.max(halfX, halfZ) * 2;
  const alongX = halfX >= halfZ;
  const posts = Math.max(1, Math.round(long / 3));
  for (let i = 0; i <= posts; i++) {
    const at = -long / 2 + (long * i) / posts;
    parts.push(
      part(
        new THREE.BoxGeometry(alongX ? 0.32 : halfX * 2 + 0.2, height + 0.3, alongX ? halfZ * 2 + 0.2 : 0.32),
        ROCK.base,
        alongX ? at : 0,
        (height + 0.3) / 2,
        alongX ? 0 : at,
      ),
    );
  }
  return mesh(merge(parts));
}

/** A pine: three stacked cones on a short trunk. Meant for InstancedMesh. */
export function pineGeometry(): THREE.BufferGeometry {
  return merge([
    part(new THREE.CylinderGeometry(0.12, 0.16, 0.8, 5), WOOD.shade, 0, 0.4, 0),
    part(new THREE.ConeGeometry(1.0, 1.4, 6), FOLIAGE.shade, 0, 1.2, 0),
    part(new THREE.ConeGeometry(0.8, 1.2, 6), FOLIAGE.base, 0, 1.9, 0, 0, PI / 6, 0),
    part(new THREE.ConeGeometry(0.55, 1.0, 6), FOLIAGE.light, 0, 2.55, 0),
  ]);
}

/**
 * The ground: a plane whose triangles each get one of the ground tones,
 * picked by a cheap seeded value noise so the tones gather into patches
 * instead of speckling.
 */
export function ground(width: number, depth: number, seed: number): THREE.Mesh {
  const cell = 1.5;
  const g = new THREE.PlaneGeometry(width, depth, Math.ceil(width / cell), Math.ceil(depth / cell)).toNonIndexed();
  g.rotateX(-PI / 2);
  const random = rng(seed);
  const blobs = Array.from({ length: Math.round((width * depth) / 60) }, () => ({
    x: (random() - 0.5) * width,
    z: (random() - 0.5) * depth,
    r: 2 + random() * 4,
  }));
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const base = new THREE.Color(GROUND.base);
  const light = new THREE.Color(GROUND.light);
  const altBase = new THREE.Color(GROUND_ALT.base);
  const altShade = new THREE.Color(GROUND_ALT.shade);
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const inPatch = blobs.some((b) => Math.hypot(cx - b.x, cz - b.z) < b.r);
    // within a tone, only a small step toward its neighbour: enough for the
    // facets to show, not enough to read as noise
    if (inPatch) c.copy(altBase).lerp(altShade, random() * 0.4);
    else c.copy(base).lerp(light, random() * 0.35);
    for (let k = 0; k < 3; k++) {
      colors[(i + k) * 3] = c.r;
      colors[(i + k) * 3 + 1] = c.g;
      colors[(i + k) * 3 + 2] = c.b;
    }
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.deleteAttribute("uv");
  const m = mesh(g);
  m.castShadow = false;
  return m;
}
