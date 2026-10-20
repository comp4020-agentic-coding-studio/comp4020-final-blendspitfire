import * as THREE from "three";
import { PLAYER_COLORS } from "../../shared/palette.ts";
import type { FixtureKind } from "../../shared/protocol.ts";
import { GUN_REST_HEIGHT, character, crawler, equipmentCase, gun, heldGun, HELD_GUN_OFFSET, sentryTurret } from "./index.ts";
import { fixtureModel } from "./facility.ts";

// Every reviewable asset in one list. The model sheet (/gallery.html) is
// generated from it, and spec/assets.test.ts checks every entry against
// its category's triangle budget and the surface gamut. Adding an asset
// means adding it here --- that's what puts it in front of review and
// under test.

/** triangle budgets per category (docs/art-and-interaction.md) */
export const BUDGETS = {
  character: 700,
  enemy: 500,
  /** a character with what they're holding */
  carrying: 1000,
  handheld: 300,
  item: 260,
  fixture: 1400,
} as const;
export type Category = keyof typeof BUDGETS;

export interface AssetEntry {
  id: string;
  category: Category;
  build: () => THREE.Object3D;
  /** how much of the world (units) the close-up views frame */
  frame: number;
}

const fixture = (kind: FixtureKind, len: number, depth: number, height: number, frame = 4): AssetEntry => ({
  id: kind,
  category: "fixture",
  build: () => fixtureModel(kind, len, depth, height),
  frame,
});

export const ASSETS: AssetEntry[] = [
  { id: "character", category: "character", build: () => character(PLAYER_COLORS[1]), frame: 2.2 },
  {
    id: "character + held M4A1",
    category: "carrying",
    build: () => {
      const g = character(PLAYER_COLORS[3]);
      const held = heldGun();
      held.position.set(HELD_GUN_OFFSET.x, HELD_GUN_OFFSET.y, HELD_GUN_OFFSET.z);
      g.add(held);
      return g;
    },
    frame: 2.6,
  },
  {
    id: "M4A1 (on the ground)",
    category: "handheld",
    build: () => {
      const g = gun();
      g.position.y = GUN_REST_HEIGHT;
      return g;
    },
    frame: 1.8,
  },
  { id: "equipment case (box item)", category: "item", build: equipmentCase, frame: 1.8 },
  { id: "sentry turret (turret item)", category: "item", build: sentryTurret, frame: 1.8 },
  fixture("supplyTerminal", 0.9, 1.2, 1.5, 3),
  { id: "crawler (enemy)", category: "enemy", build: crawler, frame: 2 },
  fixture("blastDoor", 4, 0.6, 2.5, 6),
  fixture("barrier", 2, 0.68, 0.8, 3),
  fixture("bench", 5, 1.2, 0.9, 6),
  fixture("lockers", 5, 0.9, 2, 6),
  fixture("terminal", 2.4, 1, 0.9, 3.5),
  fixture("crates", 2, 2, 1, 3.5),
  fixture("rack", 5, 1, 2.2, 6),
  fixture("toppledRack", 2.2, 1, 0.6, 3.5),
  fixture("rubble", 1.6, 1.4, 0.8, 3),
  fixture("reactor", 4.4, 4.4, 1.8, 6),
  fixture("console", 2.4, 0.9, 1, 3.5),
  fixture("pillar", 1.2, 1.2, 2.5, 3),
  fixture("fumeHood", 2.4, 1.1, 2.2, 3.5),
  fixture("gasRack", 2, 0.8, 1.6, 3),
  fixture("cooler", 2.2, 1.1, 2, 3.5),
  fixture("vending", 1.2, 0.9, 2, 3),
  fixture("seating", 2, 0.7, 0.5, 3),
  fixture("table", 2.4, 1.6, 0.76, 3),
];
