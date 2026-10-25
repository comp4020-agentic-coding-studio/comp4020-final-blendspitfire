import * as THREE from "three";
import { EMIT_WHITE, HAZARD, STEEL, ALUMINIUM } from "../../shared/palette.ts";
import {
  DOOR_HALF_WIDTH,
  FACILITY_WALL_HALF_HEIGHT,
  LIFT_CARS,
  LIFT_DOORS,
  liftDoorOpen,
  type LiftLevel,
  type LiftState,
} from "../../shared/protocol.ts";
import { glowPart, merge, mesh, part } from "../models/kit.ts";

// The lift's moving parts, drawn identically at both ends so a ride is
// invisible: a pair of steel door leaves that part sideways into the wall,
// and the button panel inside the car by the door. The car itself (walls,
// floor, lamps) is part of the facility build.

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const HEIGHT = FACILITY_WALL_HALF_HEIGHT * 2;

function leaf(): THREE.Mesh {
  const w = DOOR_HALF_WIDTH;
  const parts = [
    part(box(w, HEIGHT, 0.12), STEEL.base, 0, HEIGHT / 2, 0),
    // a window slot and a hazard stripe at knee height, on both faces
    part(box(w - 0.3, 0.1, 0.14), HAZARD.base, 0, 0.5, 0),
    part(box(0.3, 1.0, 0.14), ALUMINIUM.shade, 0, 1.5, 0),
  ];
  return mesh(merge(parts, "none"));
}

/** where the car's button panel is at a level: on its east wall, just inside the door */
export function liftPanelAt(level: LiftLevel): THREE.Vector3 {
  const car = LIFT_CARS[level];
  return new THREE.Vector3(car.maxX - 0.1, 1.3, car.minZ + 0.9);
}

function panel(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(merge([part(box(0.08, 0.6, 0.36), STEEL.shade, 0, 0, 0)], "none")));
  const lamp = mesh(glowPart(box(0.04, 0.12, 0.12), EMIT_WHITE, -0.05, 0.12, 0), "emissive");
  g.add(lamp);
  return g;
}

/**
 * The top car has no drawn roof (the camera looks down through it), so the
 * low sun would light its floor as if it stood open to the sky. An unseen
 * lid that only throws a shadow keeps the sun out but for what slants in
 * through the doorway.
 */
function sunRoof(): THREE.Mesh {
  const car = LIFT_CARS.top;
  const roof = new THREE.Mesh(
    box(car.maxX - car.minX + 0.6, 0.1, car.maxZ - car.minZ + 0.6),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
  );
  roof.position.set((car.minX + car.maxX) / 2, HEIGHT + 0.05, (car.minZ + car.maxZ) / 2);
  roof.castShadow = true;
  return roof;
}

export class LiftDoors {
  readonly group = new THREE.Group();
  private readonly leaves: Record<LiftLevel, [THREE.Mesh, THREE.Mesh]>;

  constructor() {
    const make = (level: LiftLevel): [THREE.Mesh, THREE.Mesh] => {
      const door = LIFT_DOORS[level];
      const pair: [THREE.Mesh, THREE.Mesh] = [leaf(), leaf()];
      for (const l of pair) {
        l.position.z = door.z;
        this.group.add(l);
      }
      const p = panel();
      p.position.copy(liftPanelAt(level));
      this.group.add(p);
      return pair;
    };
    this.leaves = { top: make("top"), bottom: make("bottom") };
    this.group.add(sunRoof());
  }

  /** slide each pair to how open the server says that end is */
  update(lift: LiftState, now: number): void {
    for (const level of ["top", "bottom"] as const) {
      const open = liftDoorOpen(lift, level, now);
      const [a, b] = this.leaves[level];
      const shift = DOOR_HALF_WIDTH / 2 + open * DOOR_HALF_WIDTH * 0.95;
      a.position.x = -shift;
      b.position.x = shift;
    }
  }
}
