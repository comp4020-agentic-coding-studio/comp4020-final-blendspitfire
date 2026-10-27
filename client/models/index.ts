import * as THREE from "three";
import {
  ALUMINIUM,
  CLOTH,
  EMIT_ACID,
  EMIT_AMBER,
  EMIT_GREEN,
  EMIT_RED,
  FLOOR,
  HAIR,
  HAZARD,
  PLASTIC,
  RUBBER,
  SHOE,
  SKIN,
  STEEL,
  surfaceVersion,
} from "../../shared/palette.ts";
import { glowPart, merge, mesh, multiMesh, outlined, part, profile } from "./kit.ts";

// Every model faces +Z (forward) and stands on y = 0 unless noted. Sizes
// are in world units; a player is 0.4 in radius and about 1.6 tall.

const { PI } = Math;
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/** where the shoulder lamp sits on a character, for the light that goes with it */
export const SHOULDER_LAMP = { x: -0.24, y: 1.12, z: 0.06 };

/**
 * A player in facility coveralls: a work jacket in a greyed version of
 * their colour (theirs, but quiet --- it's paint, so it stays in the surface
 * gamut), dark trousers, boots, a cap. Their colour shows at full strength
 * only in the lamp clipped to the left shoulder, because that's a light,
 * and lights are the one thing allowed to be vivid. From straight overhead
 * the cap brim pointing forward is the facing cue.
 */
export function character(color: string): THREE.Group {
  const jacket = surfaceVersion(color, 0.48);
  const lamp = new THREE.Color(color).getHex();
  const body = merge(
    [
      // boots
      part(box(0.15, 0.1, 0.27), RUBBER.base, -0.11, 0.05, 0.03),
      part(box(0.15, 0.1, 0.27), RUBBER.base, 0.11, 0.05, 0.03),
      part(box(0.155, 0.03, 0.12), SHOE.shade, -0.11, 0.115, 0.1),
      part(box(0.155, 0.03, 0.12), SHOE.shade, 0.11, 0.115, 0.1),
      // trousers, with a knee pad each
      part(box(0.15, 0.48, 0.17), CLOTH.base, -0.11, 0.34, 0),
      part(box(0.15, 0.48, 0.17), CLOTH.base, 0.11, 0.34, 0),
      part(box(0.12, 0.1, 0.04), CLOTH.shade, -0.11, 0.33, 0.095),
      part(box(0.12, 0.1, 0.04), CLOTH.shade, 0.11, 0.33, 0.095),
      // belt with a pouch on the hip
      part(box(0.42, 0.07, 0.24), RUBBER.light, 0, 0.6, 0),
      part(box(0.1, 0.12, 0.08), CLOTH.shade, 0.19, 0.58, -0.06),
      // jacket: a tapered body, collar, chest pockets and a back panel
      part(new THREE.CylinderGeometry(0.29, 0.24, 0.54, 4, 1), jacket.base, 0, 0.88, 0, 0, PI / 4, 0, 1, 0.62),
      part(box(0.3, 0.07, 0.2), jacket.shade, 0, 1.17, -0.01),
      part(box(0.12, 0.12, 0.03), jacket.shade, -0.11, 0.95, 0.15),
      part(box(0.12, 0.12, 0.03), jacket.shade, 0.11, 0.95, 0.15),
      part(box(0.3, 0.32, 0.05), jacket.light, 0, 0.9, -0.16),
      // sleeves down to the forearm
      part(box(0.13, 0.22, 0.17), jacket.base, -0.27, 1.0, 0.02),
      part(box(0.13, 0.22, 0.17), jacket.base, 0.27, 1.0, 0.02),
      // forearms reaching forward to where a held item sits, gloved hands
      part(box(0.1, 0.1, 0.3), jacket.base, -0.24, 0.94, 0.17, 0, 0.3, 0),
      part(box(0.1, 0.1, 0.3), jacket.base, 0.24, 0.94, 0.17, 0, -0.3, 0),
      part(box(0.1, 0.1, 0.1), RUBBER.light, -0.18, 0.94, 0.33),
      part(box(0.1, 0.1, 0.1), RUBBER.light, 0.18, 0.94, 0.33),
      // neck and head
      part(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 5), SKIN.shade, 0, 1.2, 0),
      part(new THREE.IcosahedronGeometry(0.17, 1), SKIN.base, 0, 1.34, 0),
      part(box(0.26, 0.1, 0.1), HAIR.base, 0, 1.36, -0.12),
      // cap: a low dome and a brim forward
      part(new THREE.SphereGeometry(0.185, 7, 3, 0, PI * 2, 0, PI / 2), CLOTH.light, 0, 1.39, -0.01),
      part(box(0.24, 0.03, 0.22), CLOTH.shade, 0, 1.4, 0.25),
      // the lamp's housing on the left shoulder strap
      part(box(0.12, 0.1, 0.1), RUBBER.base, SHOULDER_LAMP.x, SHOULDER_LAMP.y, SHOULDER_LAMP.z - 0.02),
    ],
    "ground",
    0.3,
  );
  const lens = glowPart(box(0.09, 0.07, 0.03), lamp, SHOULDER_LAMP.x, SHOULDER_LAMP.y, SHOULDER_LAMP.z + 0.04);
  const top = glowPart(box(0.08, 0.02, 0.06), lamp, SHOULDER_LAMP.x, SHOULDER_LAMP.y + 0.055, SHOULDER_LAMP.z - 0.01);
  const g = multiMesh({ matte: [body], emissive: [lens, top] });
  outlined(g.children[0] as THREE.Mesh);
  return g;
}

/**
 * An M4A1, built upright in profile (barrel toward +Z, top toward +Y). On
 * the ground it's laid on its side, so from overhead you see the side
 * profile --- barrel and A-frame front sight, handguard, flat-top receiver
 * with carry handle, pistol grip, the forward-curving magazine, and the
 * collapsible stock. Oversized (about 1.3 long against a real 0.84 m) so
 * those features survive the camera.
 */
const GUN_SCALE = 1.25;
/** a loose gun lies a touch bigger again than a held one, so it's findable on a busy floor */
const GUN_LYING_SCALE = 1.15;

function gunGeometry(): THREE.BufferGeometry {
  const dark = RUBBER;
  const g = merge(
    [
      // receiver, with the ejection port and forward assist on the right
      part(box(0.07, 0.11, 0.3), STEEL.shade, 0, 0, -0.02),
      part(box(0.075, 0.03, 0.08), dark.base, 0, 0.02, 0.02),
      part(box(0.03, 0.03, 0.05), STEEL.base, 0.045, 0.04, -0.1),
      // flat-top rail + carry handle: two posts and a bar
      part(box(0.05, 0.03, 0.3), dark.base, 0, 0.07, -0.02),
      part(box(0.04, 0.06, 0.03), STEEL.shade, 0, 0.11, -0.13),
      part(box(0.04, 0.06, 0.03), STEEL.shade, 0, 0.11, 0.07),
      part(box(0.04, 0.03, 0.23), STEEL.shade, 0, 0.15, -0.03),
      // handguard: a stubby hexagonal tube with vent slots
      part(new THREE.CylinderGeometry(0.05, 0.05, 0.24, 6), dark.light, 0, 0.01, 0.25, PI / 2, 0, 0),
      part(box(0.105, 0.012, 0.18), dark.base, 0, 0.01, 0.25),
      // barrel
      part(new THREE.CylinderGeometry(0.02, 0.02, 0.24, 5), STEEL.shade, 0, 0.01, 0.49, PI / 2, 0, 0),
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
        STEEL.shade,
      ),
      // muzzle device
      part(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 6), STEEL.base, 0, 0.01, 0.62, PI / 2, 0, 0),
      // magazine: three segments, each tipped further forward, for the curve
      part(box(0.05, 0.09, 0.075), STEEL.base, 0, -0.1, 0.06, -0.08, 0, 0),
      part(box(0.05, 0.09, 0.075), STEEL.base, 0, -0.185, 0.075, -0.25, 0, 0),
      part(box(0.05, 0.09, 0.075), STEEL.base, 0, -0.265, 0.105, -0.42, 0, 0),
      // pistol grip, raked back
      part(box(0.05, 0.14, 0.055), dark.base, 0, -0.1, -0.11, 0.35, 0, 0),
      part(box(0.03, 0.015, 0.09), dark.base, 0, -0.075, -0.04),
      // buffer tube
      part(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 6), STEEL.shade, 0, 0.02, -0.24, PI / 2, 0, 0),
      // collapsible stock: a profile that drops toward the butt, with a dark butt pad
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
        dark.light,
      ),
      part(box(0.065, 0.15, 0.02), dark.base, 0, -0.025, -0.45),
    ],
    "self",
    0.08,
  );
  g.scale(GUN_SCALE, GUN_SCALE, GUN_SCALE);
  return g;
}

/** Lying on the ground, on its side: the profile, not the top edge, faces the camera. */
export function gun(): THREE.Mesh {
  return outlined(mesh(lyingGunGeometry(), "glossy"), 0.02);
}

function lyingGunGeometry(): THREE.BufferGeometry {
  const g = gunGeometry();
  g.rotateZ(PI / 2);
  g.scale(GUN_LYING_SCALE, GUN_LYING_SCALE, GUN_LYING_SCALE);
  return g;
}

/**
 * How high a loose gun sits so its lowest part (the sights and forward
 * assist, not the receiver) just clears the floor tiles and the grass,
 * which stand up to ~3 cm. Measured, so it follows the model.
 */
export const GUN_REST_HEIGHT = (() => {
  const g = lyingGunGeometry();
  g.computeBoundingBox();
  return 0.035 - g.boundingBox!.min.y;
})();

/**
 * Held the way a person holds a rifle: upright, top up. From overhead that
 * shows less of the profile than the lying version, but a sideways-held
 * rifle reads as wrong to anyone who's seen one.
 */
export function heldGun(): THREE.Mesh {
  return outlined(mesh(gunGeometry(), "glossy"), 0.015);
}

/** where the gun sits relative to its holder, so the grip lands in the hands */
export const HELD_GUN_OFFSET = { x: 0.06, y: 1.08, z: 0.55 };

/**
 * The buildable box: a 1×1×1 hard-shell equipment case. Off-white plastic
 * body, worn hazard-yellow corner bumpers (the corners are what matters
 * when lining up a wall, so they're what stands out), a dark lid seam,
 * latches front and back, and a stencilled band across the lid.
 */
export function equipmentCaseGeometry(): THREE.BufferGeometry {
  const parts = [
    part(box(0.92, 0.88, 0.92), PLASTIC.base, 0, 0.44, 0),
    part(box(0.95, 0.12, 0.95), PLASTIC.light, 0, 0.93, 0),
    part(box(0.94, 0.04, 0.94), RUBBER.base, 0, 0.85, 0),
    part(box(0.955, 0.125, 0.2), STEEL.base, 0, 0.935, 0),
    // ribs down each side
    part(box(0.94, 0.5, 0.06), PLASTIC.shade, 0, 0.42, 0.18),
    part(box(0.94, 0.5, 0.06), PLASTIC.shade, 0, 0.42, -0.18),
    // latches and handles
    part(box(0.12, 0.12, 0.04), ALUMINIUM.base, -0.25, 0.8, 0.47),
    part(box(0.12, 0.12, 0.04), ALUMINIUM.base, 0.25, 0.8, 0.47),
    part(box(0.12, 0.12, 0.04), ALUMINIUM.base, -0.25, 0.8, -0.47),
    part(box(0.12, 0.12, 0.04), ALUMINIUM.base, 0.25, 0.8, -0.47),
    part(box(0.34, 0.05, 0.06), RUBBER.light, 0.47, 0.6, 0, 0, PI / 2, 0),
    part(box(0.34, 0.05, 0.06), RUBBER.light, -0.47, 0.6, 0, 0, PI / 2, 0),
  ];
  for (const cx of [-1, 1]) {
    for (const cz of [-1, 1]) {
      parts.push(part(box(0.17, 1.0, 0.17), HAZARD.base, cx * 0.43, 0.5, cz * 0.43));
      parts.push(part(box(0.18, 0.06, 0.18), HAZARD.shade, cx * 0.43, 0.06, cz * 0.43));
    }
  }
  return merge(parts, "ground", 0.12);
}

export function equipmentCase(): THREE.Mesh {
  return outlined(mesh(equipmentCaseGeometry()));
}

/**
 * The sentry turret the corp sells: a squat steel tripod on a hazard-yellow
 * footplate (the tile it holds, so it lines up with boxes), a rubber-booted
 * swivel, and a stubby boxy gun with a magazine drum. The head is its own
 * child (`turretHead`) so it can swing to face what it's shooting (or sweep
 * on its own, idle) --- a green indicator light on top and a thin green
 * laser out the muzzle turn with it, so a turret reads as a turret, live
 * and watching, well before its shape does.
 */
export function sentryTurret(): THREE.Group {
  const base = merge(
    [
      part(box(0.86, 0.08, 0.86), HAZARD.shade, 0, 0.04, 0),
      part(box(0.7, 0.04, 0.7), STEEL.shade, 0, 0.1, 0),
      ...[0, 1, 2].map((i) => {
        const a = (i / 3) * PI * 2;
        return part(box(0.08, 0.42, 0.08), STEEL.base, Math.sin(a) * 0.22, 0.3, Math.cos(a) * 0.22, Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35);
      }),
      part(new THREE.CylinderGeometry(0.16, 0.2, 0.18, 8), RUBBER.base, 0, 0.55, 0),
    ],
    "ground",
    0.15,
  );
  const head = merge(
    [
      part(box(0.34, 0.24, 0.48), STEEL.light, 0, 0, 0),
      part(box(0.36, 0.06, 0.5), STEEL.shade, 0, 0.13, 0),
      part(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 6), RUBBER.light, 0, 0, 0.42, PI / 2, 0, 0),
      part(new THREE.CylinderGeometry(0.13, 0.13, 0.12, 8), STEEL.shade, 0.24, -0.02, -0.04, 0, 0, PI / 2),
    ],
    "self",
    0.08,
  );
  const g = new THREE.Group();
  const baseMesh = outlined(mesh(base));
  g.add(baseMesh);
  const headGroup = multiMesh({
    matte: [head],
    emissive: [
      glowPart(box(0.12, 0.06, 0.03), EMIT_AMBER, 0, 0.06, 0.25),
      // the indicator light, up top so it reads from overhead
      glowPart(new THREE.IcosahedronGeometry(0.055, 0), EMIT_GREEN, 0, 0.17, 0.04),
      // a thin sighting laser out the muzzle, long enough to read which way it's watching
      glowPart(box(0.025, 0.025, 1.6), EMIT_GREEN, 0, 0, 1.22),
    ],
  });
  outlined(headGroup.children[0] as THREE.Mesh, 0.02);
  headGroup.name = "turretHead";
  headGroup.position.y = 0.76;
  g.add(headGroup);
  return g;
}

/**
 * The comms set's call lamp: a green beacon in a small steel cage, clamped
 * on top of the desk. Lit while a break is on (supply can be ordered, the
 * next wave can be voted in), dark once a wave starts. The lens is its own
 * mesh (named "lens") so the client can switch it.
 */
export function beaconLamp(): THREE.Group {
  const cage = merge(
    [
      part(new THREE.CylinderGeometry(0.11, 0.13, 0.06, 8), STEEL.shade, 0, 0.03, 0),
      ...[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * PI * 2 + PI / 4;
        return part(box(0.025, 0.2, 0.025), STEEL.base, Math.sin(a) * 0.09, 0.15, Math.cos(a) * 0.09);
      }),
      part(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 8), STEEL.shade, 0, 0.26, 0),
    ],
    "self",
    0.05,
  );
  const g = new THREE.Group();
  g.add(mesh(cage));
  const lens = mesh(glowPart(new THREE.CylinderGeometry(0.07, 0.07, 0.16, 8), EMIT_GREEN, 0, 0.14, 0), "emissive");
  lens.name = "lens";
  g.add(lens);
  return g;
}

/**
 * What comes through the breaches: a hunched, eyeless-looking thing on
 * four legs, the colour of old meat and wet concrete (greyed, inside the
 * gamut) --- except for two small red eyes, its one emitter, so it's found
 * in the dark by its eyes before its shape. Low and wide from above, so it
 * never reads as a player.
 */
export function crawler(): THREE.Group {
  const flesh = surfaceVersion(0x8a4a3a, 0.4);
  const hide = surfaceVersion(0x5a5048, 0.32);
  const body = merge(
    [
      // torso: a low, wide wedge, heavier at the shoulders
      part(new THREE.CylinderGeometry(0.26, 0.34, 0.7, 6, 1), hide.base, 0, 0.42, -0.05, PI / 2, 0, 0, 1.1, 0.8),
      part(new THREE.IcosahedronGeometry(0.3, 0), flesh.base, 0, 0.5, 0.22, 0, 0, 0, 1.15, 0.9),
      // spine ridges, what shows from straight above
      part(box(0.1, 0.12, 0.12), flesh.shade, 0, 0.72, 0.1),
      part(box(0.09, 0.1, 0.11), flesh.shade, 0, 0.68, -0.1),
      part(box(0.08, 0.08, 0.1), flesh.shade, 0, 0.62, -0.28),
      // head, thrust forward and low
      part(new THREE.IcosahedronGeometry(0.17, 0), flesh.light, 0, 0.42, 0.5, 0, 0, 0, 1, 1.25),
      part(box(0.2, 0.06, 0.14), hide.shade, 0, 0.32, 0.6),
      // four splayed legs
      ...[
        [-1, 1],
        [1, 1],
        [-1, -1],
        [1, -1],
      ].flatMap(([sx, sz]) => [
        part(box(0.09, 0.3, 0.09), hide.base, sx * 0.3, 0.3, sz * 0.22, sz * 0.3, 0, -sx * 0.6),
        part(box(0.08, 0.28, 0.08), hide.shade, sx * 0.44, 0.12, sz * 0.28, 0, 0, sx * 0.2),
      ]),
    ],
    "ground",
    0.25,
  );
  const eyes = [-1, 1].map((s) => glowPart(box(0.05, 0.04, 0.03), EMIT_RED, s * 0.07, 0.46, 0.66));
  const g = multiMesh({ matte: [body], emissive: eyes });
  outlined(g.children[0] as THREE.Mesh, 0.025);
  return g;
}

/**
 * A frag grenade: an olive body, the spoon and ring on top. Oversized (real
 * ones are ~0.1) so it survives the camera's height; a small amber fuse lamp
 * on top is what you track once it's on the floor ticking.
 */
export function grenade(): THREE.Group {
  const olive = surfaceVersion(0x5a6a3a, 0.42);
  const body = merge(
    [
      part(new THREE.IcosahedronGeometry(0.16, 1), olive.base, 0, 0.16, 0, 0, 0, 0, 1, 1),
      part(new THREE.CylinderGeometry(0.06, 0.07, 0.08, 6), STEEL.base, 0, 0.33, 0),
      part(box(0.04, 0.03, 0.2), STEEL.light, 0.05, 0.37, -0.02, 0.3, 0, 0),
      part(new THREE.TorusGeometry(0.05, 0.012, 3, 8), STEEL.light, -0.07, 0.36, 0, 0, PI / 2, 0),
    ],
    "ground",
    0.1,
  );
  const g = multiMesh({ matte: [body], emissive: [glowPart(box(0.04, 0.03, 0.04), EMIT_AMBER, 0, 0.385, 0.05)] });
  outlined(g.children[0] as THREE.Mesh, 0.02);
  return g;
}

/**
 * The spitter: a crawler's build, taller at the back, carrying a swollen
 * acid sac that glows through its hide --- the sac is what you see from
 * overhead, so it's told from a crawler at a glance, by light, in the dark.
 * Red eyes like the rest of them; the sac is its own emitter.
 */
export function spitter(): THREE.Group {
  const flesh = surfaceVersion(0x7a5a3a, 0.38);
  const hide = surfaceVersion(0x4e5244, 0.3);
  const body = merge(
    [
      part(new THREE.CylinderGeometry(0.22, 0.3, 0.62, 6, 1), hide.base, 0, 0.44, -0.05, PI / 2, 0, 0, 1, 0.8),
      // the sac's housing: a ring of hide round the glow
      part(new THREE.CylinderGeometry(0.27, 0.3, 0.12, 7), hide.shade, 0, 0.62, -0.12),
      // a long throat, head held up to spit
      part(box(0.14, 0.14, 0.3), flesh.shade, 0, 0.52, 0.3, -0.4, 0, 0),
      part(new THREE.IcosahedronGeometry(0.15, 0), flesh.light, 0, 0.6, 0.48, 0, 0, 0, 1, 1.2),
      ...[
        [-1, 1],
        [1, 1],
        [-1, -1],
        [1, -1],
      ].flatMap(([sx, sz]) => [
        part(box(0.08, 0.32, 0.08), hide.base, sx * 0.28, 0.3, sz * 0.2, sz * 0.3, 0, -sx * 0.6),
        part(box(0.07, 0.3, 0.07), hide.shade, sx * 0.42, 0.12, sz * 0.26, 0, 0, sx * 0.2),
      ]),
    ],
    "ground",
    0.25,
  );
  const glow = [
    glowPart(new THREE.IcosahedronGeometry(0.24, 0), EMIT_ACID, 0, 0.72, -0.12),
    ...[-1, 1].map((s) => glowPart(box(0.05, 0.04, 0.03), EMIT_RED, s * 0.06, 0.64, 0.6)),
  ];
  const g = multiMesh({ matte: [body], emissive: glow });
  outlined(g.children[0] as THREE.Mesh, 0.025);
  return g;
}

/** A plain stretch of facility floor, for model-sheet backdrops. */
export function floorSlab(width: number, depth: number): THREE.Mesh {
  const g = box(width, 0.02, depth);
  const m = mesh(merge([part(g, FLOOR.base, 0, -0.01, 0)], "none"), "tile");
  m.castShadow = false;
  return m;
}
