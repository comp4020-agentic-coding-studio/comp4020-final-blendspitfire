import * as THREE from "three";
import {
  ALUMINIUM,
  CLOTH,
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
/** half the gun's thickness once laid on its side: how high it rests off the ground */
export const GUN_REST_HEIGHT = 0.035 * GUN_SCALE;

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
  const g = gunGeometry();
  g.rotateZ(PI / 2);
  return outlined(mesh(g, "glossy"), 0.02);
}

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

/** A plain stretch of facility floor, for model-sheet backdrops. */
export function floorSlab(width: number, depth: number): THREE.Mesh {
  const g = box(width, 0.02, depth);
  const m = mesh(merge([part(g, FLOOR.base, 0, -0.01, 0)], "none"), "tile");
  m.castShadow = false;
  return m;
}
