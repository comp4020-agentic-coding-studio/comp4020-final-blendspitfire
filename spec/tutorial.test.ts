import { describe, expect, it } from "vitest";
import { LEVEL_SPLIT_Z, SURFACE, TUT_AREA, inRect, isWalkable, levelOf, type ItemState } from "../shared/protocol.ts";
import {
  DROP_PAD,
  GARDEN_MIN_Z,
  HELIPADS,
  LESSONS,
  MOVE_PAD,
  TARGET_HITS,
  TUT_BOUNDS,
  TUT_CLUSTER,
  TUT_ROOMS,
  TUT_SPAWN,
  TUT_TARGETS,
  heliDestination,
  heliObstacles,
  inCabin,
  shutTutDoors,
} from "../shared/tutorial.ts";
import { Tutorial } from "../server/tutorial.ts";

describe("tutorial layout", () => {
  it("sits inside the area protocol.ts reserves, wholly on the surface level", () => {
    expect(GARDEN_MIN_Z).toBe(SURFACE.minZ);
    for (const c of [
      [TUT_BOUNDS.minX, TUT_BOUNDS.minZ],
      [TUT_BOUNDS.maxX, TUT_BOUNDS.maxZ],
    ]) {
      expect(inRect(TUT_AREA, c[0], c[1])).toBe(true);
    }
    expect(TUT_BOUNDS.minZ).toBeGreaterThan(LEVEL_SPLIT_Z);
    expect(levelOf(TUT_SPAWN.z)).toBe("top");
    for (const r of TUT_ROOMS) expect(isWalkable((r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2)).toBe(true);
  });

  it("every room's door is shut until its lesson is done, the last room has none", () => {
    expect(shutTutDoors(0)).toHaveLength(LESSONS.length - 1);
    expect(shutTutDoors(2)).toHaveLength(LESSONS.length - 3);
    expect(shutTutDoors(LESSONS.length - 1)).toHaveLength(0);
  });

  it("the helicopter fits its room, and a ride lands at the same spot in the twin", () => {
    const last = TUT_ROOMS[TUT_ROOMS.length - 1];
    for (const o of heliObstacles(HELIPADS.tutorial)) {
      expect(o.x - o.halfX).toBeGreaterThanOrEqual(last.minX);
      expect(o.x + o.halfX).toBeLessThanOrEqual(last.maxX);
      expect(o.z - o.halfZ).toBeGreaterThanOrEqual(last.minZ);
      expect(o.z + o.halfZ).toBeLessThanOrEqual(last.maxZ);
    }
    const g = HELIPADS.garden;
    const d = heliDestination("garden", g.x - 0.3, g.z + 0.5);
    expect(d.to).toBe("tutorial");
    expect(inCabin(HELIPADS.tutorial, d.x, d.z)).toBe(true);
    expect(d.x - HELIPADS.tutorial.x).toBeCloseTo(-0.3);
  });
});

describe("tutorial lessons", () => {
  function setup() {
    const items = new Map<string, ItemState>();
    const t = new Tutorial({ items, changed: () => {}, log: () => {} });
    const trainee = t.enrol("p");
    const mine = (kind: string) => [...items.values()].find((i) => i.owner === "p" && i.kind === kind);
    return { items, t, trainee, mine };
  }

  it("runs move -> pickup -> shoot -> drop -> grenade, each needing its own deed", () => {
    const { t, trainee, mine, items } = setup();
    t.step("p", TUT_SPAWN, undefined);
    expect(trainee.stage).toBe(0);
    t.step("p", MOVE_PAD, undefined);
    expect(trainee.stage).toBe(1);

    // a rifle appears for them; holding it passes
    const room1 = { x: TUT_ROOMS[1].minX + 1, z: TUT_ROOMS[1].minZ + 1 };
    t.step("p", room1, undefined);
    const gun = mine("gun")!;
    expect(gun).toBeDefined();
    gun.heldBy = "p";
    t.step("p", room1, gun);
    expect(trainee.stage).toBe(2);

    // shooting: each target takes TARGET_HITS, only a shot that crosses it counts
    const from = { x: TUT_TARGETS[0].x + 4, z: TUT_TARGETS[0].z };
    expect(t.shot("p", from.x, from.z, 0, 1, 0, 10)).toBeUndefined();
    for (const target of TUT_TARGETS) {
      for (let i = 0; i < TARGET_HITS; i++) expect(t.shot("p", target.x + 4, target.z, -1, 0, 0, 10)).toBeCloseTo(4 - 0.45, 1);
    }
    expect(t.shot("p", TUT_TARGETS[0].x + 4, TUT_TARGETS[0].z, -1, 0, 0, 10)).toBeUndefined();
    t.step("p", { x: TUT_TARGETS[0].x + 4, z: TUT_TARGETS[0].z }, gun);
    expect(trainee.stage).toBe(3);

    // put it down anywhere but the mat: not yet; on the mat: done, and the rifle's taken back
    gun.heldBy = undefined;
    gun.x = DROP_PAD.x + 3;
    gun.z = DROP_PAD.z;
    t.step("p", DROP_PAD, undefined);
    expect(trainee.stage).toBe(3);
    gun.x = DROP_PAD.x;
    t.step("p", DROP_PAD, undefined);
    expect(trainee.stage).toBe(4);
    expect(mine("gun")).toBeUndefined();

    // a grenade waits in its room; a blast that misses the huddle doesn't count
    const room4 = { x: TUT_ROOMS[4].maxX - 1, z: TUT_ROOMS[4].minZ + 1 };
    t.step("p", room4, undefined);
    expect(mine("grenade")).toBeDefined();
    t.blast("p", TUT_CLUSTER[0].x + 6, TUT_CLUSTER[0].z, 2.6);
    t.step("p", room4, undefined);
    expect(trainee.stage).toBe(4);
    t.blast("p", TUT_CLUSTER[0].x, TUT_CLUSTER[0].z, 2.6);
    t.step("p", room4, undefined);
    expect(trainee.stage).toBe(5);
    expect(LESSONS[trainee.stage]).toBe("fly");

    // leaving clears every prop of theirs
    t.leave("p");
    expect([...items.values()].filter((i) => i.owner === "p")).toHaveLength(0);
    expect(t.trainees.has("p")).toBe(false);
  });

  it("one trainee's shots never touch another's targets", () => {
    const { t } = setup();
    const other = t.enrol("q");
    other.stage = 2;
    const target = TUT_TARGETS[1];
    // p isn't on the shooting lesson: their shot passes
    expect(t.shot("p", target.x + 4, target.z, -1, 0, 0, 10)).toBeUndefined();
    expect(other.hits[1]).toBe(0);
    expect(t.shot("q", target.x + 4, target.z, -1, 0, 0, 10)).toBeDefined();
    expect(other.hits[1]).toBe(1);
  });
});
