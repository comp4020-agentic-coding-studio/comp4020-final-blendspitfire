import { describe, expect, it } from "vitest";
import {
  HIT_RADIUS,
  OBSTACLES,
  PROJECTILE_MAX_RANGE,
  PROJECTILE_RADIUS,
  rayToObstacles,
  shotRange,
  segmentHitsCircle,
  type Obstacle,
} from "../shared/protocol.ts";

// Shots are straight lines resolved by ray-casting, not stepped positions,
// so a fast round can't tunnel. These pin the two pieces of maths that
// decide where a shot stops and who it hits.

const wall: Obstacle = { x: 5, z: 0, halfX: 0.3, halfZ: 3, halfHeight: 1 };

describe("rayToObstacles", () => {
  it("stops at the near face of a wall, allowing for the shot's radius", () => {
    const d = rayToObstacles(0, 0, 1, 0, [wall], 40);
    expect(d).toBeCloseTo(5 - 0.3 - PROJECTILE_RADIUS, 5);
  });

  it("goes the full range when nothing is in the way", () => {
    expect(rayToObstacles(0, 0, -1, 0, [wall], 40)).toBe(40);
    expect(rayToObstacles(0, 10, 1, 0, [wall], 40)).toBe(40);
  });

  it("can't skip a thin wall however far the shot travels in a tick", () => {
    // a wall 0.6 thick, a shot covering 40 units in one go: still stops at it
    const d = rayToObstacles(-10, 0, 1, 0, [wall], 1000);
    expect(d).toBeLessThan(15);
  });

  it("takes the nearest of several obstacles", () => {
    const near: Obstacle = { x: 2, z: 0, halfX: 0.5, halfZ: 0.5, halfHeight: 0.5 };
    expect(rayToObstacles(0, 0, 1, 0, [wall, near], 40)).toBeCloseTo(1.5 - PROJECTILE_RADIUS, 5);
  });

  it("handles diagonal shots", () => {
    // 30° up from the axis: meets the wall's face at x = 4.65, well within its length
    const dx = Math.cos(Math.PI / 6);
    const dz = Math.sin(Math.PI / 6);
    expect(rayToObstacles(0, 0, dx, dz, [wall], 40)).toBeCloseTo((5 - 0.3 - PROJECTILE_RADIUS) / dx, 4);
  });

  it("never flies off into nothing: shots through a breach stop at the world's edge", () => {
    // from inside the lab, straight out through the west vent
    expect(shotRange(-15, 10, -1, 0, OBSTACLES)).toBeLessThan(10);
    for (let a = 0; a < Math.PI * 2; a += 0.05) {
      expect(shotRange(0, 10, Math.cos(a), Math.sin(a), OBSTACLES)).toBeLessThan(PROJECTILE_MAX_RANGE);
    }
  });

  it("goes nowhere when fired point-blank into a wall", () => {
    expect(shotRange(4.8, 0, 1, 0, [wall])).toBe(0);
  });
});

describe("segmentHitsCircle", () => {
  it("hits a player standing on the line, at the edge of their body", () => {
    const t = segmentHitsCircle(0, 0, 1, 0, 0, 10, 5, 0, HIT_RADIUS);
    expect(t).toBeCloseTo(5 - HIT_RADIUS, 5);
  });

  it("misses a player off to the side", () => {
    expect(segmentHitsCircle(0, 0, 1, 0, 0, 10, 5, HIT_RADIUS + 0.05, HIT_RADIUS)).toBeUndefined();
  });

  it("only counts the stretch covered this tick", () => {
    // the player is at 5, but this tick the shot only went from 6 to 9
    expect(segmentHitsCircle(0, 0, 1, 0, 6, 9, 5, 0, HIT_RADIUS)).toBeUndefined();
    // and from 0 to 3 it hasn't got there yet
    expect(segmentHitsCircle(0, 0, 1, 0, 0, 3, 5, 0, HIT_RADIUS)).toBeUndefined();
  });

  it("catches a player the segment starts inside of", () => {
    expect(segmentHitsCircle(0, 0, 1, 0, 4.9, 8, 5, 0, HIT_RADIUS)).toBeCloseTo(4.9, 5);
  });

  it("doesn't hit someone behind the shot", () => {
    expect(segmentHitsCircle(0, 0, 1, 0, 0, 10, -3, 0, HIT_RADIUS)).toBeUndefined();
  });
});
