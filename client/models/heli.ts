import * as THREE from "three";
import { EMIT_AMBER, EMIT_GREEN, EMIT_RED, HAZARD, PAINT_SAGE, RUBBER, STEEL, ALUMINIUM } from "../../shared/palette.ts";
import { CABIN } from "../../shared/tutorial.ts";
import { glowPart, merge, mesh, multiMesh, part } from "./kit.ts";

// The corp's transport helicopter: what carries a new hire from the training
// shed to the dig. Seen from straight above, so it's a top outline first ---
// a long olive fuselage, the cockpit glazing forward (north, -Z), the tail
// boom aft with its small rotor, skids either side, and the main rotor's two
// long blades over it all. The cabin is open along its west side (the door
// slid back), floored and empty, so a player can walk in.
//
// Origin at the cabin's centre on the ground, nose toward -Z. The rotor is
// its own child, named "rotor", so the client can spin it; the roof is
// "roof", hidden while someone looking is inside (the camera's overhead).

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const { PI } = Math;

export function helicopter(): THREE.Group {
  const hx = CABIN.halfX;
  const hz = CABIN.halfZ;
  const floor = 0.12;
  const roof = 1.55;
  const body = [
    // cabin floor and roof
    part(box(hx * 2 + 0.24, floor, hz * 2 + 0.24), STEEL.shade, 0, floor / 2, 0),
    // east wall (the far side), and the ends fore and aft
    part(box(0.12, roof - floor, hz * 2 + 0.24), PAINT_SAGE.base, hx + 0.06, (roof + floor) / 2, 0),
    part(box(hx * 2 + 0.24, roof - floor, 0.12), PAINT_SAGE.base, 0, (roof + floor) / 2, -hz - 0.06),
    part(box(hx * 2 + 0.24, roof - floor, 0.12), PAINT_SAGE.base, 0, (roof + floor) / 2, hz + 0.06),
    // the door slid back along the rail, outside the aft end of the open side
    part(box(0.06, roof - 0.3, 1.2), PAINT_SAGE.shade, -hx - 0.14, roof / 2 + 0.1, hz + 0.5),
    part(box(0.05, 0.05, hz * 2 + 1.4), STEEL.base, -hx - 0.1, roof - 0.1, 0.5),
    // a jump seat along the east wall, and a hazard stripe at the door sill
    part(box(0.36, 0.08, hz * 1.4), RUBBER.light, hx - 0.2, 0.5, 0),
    part(box(0.08, 0.04, hz * 2), HAZARD.base, -hx + 0.04, floor + 0.02, 0),
    // the cockpit forward: a tapered nose
    part(box(1.7, 1.2, 1.6), PAINT_SAGE.base, 0, 0.75, -hz - 0.95),
    part(box(1.4, 0.8, 0.5), PAINT_SAGE.light, 0, 0.6, -hz - 1.95),
    // the tail boom aft, tapering, and its fin
    part(box(0.44, 0.44, 3.8), PAINT_SAGE.base, 0, 1.05, hz + 2.1),
    part(box(0.1, 0.9, 0.7), PAINT_SAGE.shade, 0, 1.4, hz + 3.8),
    // a corp ID band down the boom, readable from above
    part(box(0.46, 0.02, 1.2), HAZARD.light, 0, 1.28, hz + 1.4),
  ];
  // skids either side
  for (const sx of [-1, 1]) {
    body.push(part(box(0.1, 0.08, hz * 2 + 2.2), STEEL.shade, sx * (hx + 0.45), 0.05, -0.4));
    for (const sz of [-1, 1]) body.push(part(box(0.08, 0.32, 0.08), STEEL.base, sx * (hx + 0.35), 0.2, sz * hz * 0.7 - 0.4, 0, 0, sx * 0.5));
  }
  const glass = [
    // the canopy: dark glazing over the nose, unlit
    part(box(1.5, 0.5, 1.1), RUBBER.shade, 0, 1.25, -hz - 1.25),
  ];
  const g = multiMesh({
    matte: [merge(body, "ground", 0.3)],
    glossy: [merge(glass, "none")],
    emissive: [
      // position lights: red to port (west), green to starboard (east), an amber beacon on the tail
      glowPart(box(0.08, 0.08, 0.08), EMIT_RED, -0.85, 0.9, -hz - 1.4),
      glowPart(box(0.08, 0.08, 0.08), EMIT_GREEN, 0.85, 0.9, -hz - 1.4),
      glowPart(new THREE.IcosahedronGeometry(0.07, 0), EMIT_AMBER, 0, 1.9, hz + 3.9),
    ],
  });
  // the cabin roof with the engine hump and mast on it: its own mesh, named
  // "roof", so it can be lifted away while you're inside
  const top = mesh(
    merge(
      [
        part(box(hx * 2 + 0.24, 0.1, hz * 2 + 0.24), PAINT_SAGE.shade, 0, roof, 0),
        part(box(1.0, 0.4, 1.8), PAINT_SAGE.shade, 0, roof + 0.25, -0.3),
        part(new THREE.CylinderGeometry(0.1, 0.12, 0.35, 6), STEEL.base, 0, roof + 0.6, -0.3),
      ],
      "self",
      0.2,
    ),
  );
  top.name = "roof";
  g.add(top);
  // the rotors: two long blades over the top, two short on the tail
  const rotor = mesh(
    merge(
      [
        part(box(0.22, 0.04, 8.2), ALUMINIUM.shade, 0, 0, 0),
        part(box(0.22, 0.04, 8.2), ALUMINIUM.shade, 0, 0, 0, 0, PI / 2, 0),
        part(new THREE.CylinderGeometry(0.18, 0.18, 0.12, 6), STEEL.shade, 0, 0, 0),
      ],
      "none",
    ),
  );
  rotor.name = "rotor";
  rotor.position.set(0, roof + 0.8, -0.3);
  g.add(rotor);
  const tail = mesh(merge([part(box(0.05, 1.1, 0.12), ALUMINIUM.shade, 0, 0, 0)], "none"));
  tail.name = "tailRotor";
  tail.position.set(0.12, 1.4, hz + 3.85);
  g.add(tail);
  return g;
}
