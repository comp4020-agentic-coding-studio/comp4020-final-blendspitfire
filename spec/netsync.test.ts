import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ServerClock, SnapshotBuffer, Tracer } from "../client/netsync.ts";
import { PROJECTILE_SPEED } from "../shared/protocol.ts";

// The client's half of multiplayer smoothness: other players played back
// between real snapshots, and bullets drawn from the one message that
// announced them.

describe("SnapshotBuffer", () => {
  const at = (sb: SnapshotBuffer, t: number) => {
    const out = { x: 0, z: 0, rotation: 0 };
    sb.sample(t, out);
    return out;
  };

  it("interpolates between the two snapshots around the requested time", () => {
    const sb = new SnapshotBuffer();
    sb.push(1000, 0, 0, 0);
    sb.push(1050, 1, 0, 0);
    sb.push(1100, 2, 0, 0);
    expect(at(sb, 1025).x).toBeCloseTo(0.5);
    expect(at(sb, 1075).x).toBeCloseTo(1.5);
  });

  it("holds at the newest snapshot instead of guessing past it", () => {
    const sb = new SnapshotBuffer();
    sb.push(1000, 0, 0, 0);
    sb.push(1050, 1, 0, 0);
    expect(at(sb, 1300).x).toBeCloseTo(1);
  });

  it("jumps rather than slides when someone respawns across the map", () => {
    const sb = new SnapshotBuffer();
    sb.push(1000, 0, 0, 0);
    sb.push(1050, 0.3, 0, 0);
    sb.push(1100, 20, 25, 0);
    expect(at(sb, 1060).x).toBeCloseTo(20);
  });

  it("turns the short way round", () => {
    const sb = new SnapshotBuffer();
    sb.push(1000, 0, 0, Math.PI - 0.1);
    sb.push(1050, 0, 0, -Math.PI + 0.1);
    const r = at(sb, 1025).rotation;
    expect(Math.abs(Math.abs(r) - Math.PI)).toBeLessThan(0.01);
  });

  it("ignores snapshots that arrive out of order", () => {
    const sb = new SnapshotBuffer();
    sb.push(1000, 0, 0, 0);
    sb.push(1100, 2, 0, 0);
    sb.push(1050, 99, 0, 0);
    expect(at(sb, 1050).x).toBeCloseTo(1);
  });
});

describe("Tracer", () => {
  const fired = 1_000_000;
  const make = (range: number) =>
    new Tracer({ id: "s", ownerId: "o", x: 0, z: 0, dirX: 0, dirZ: -1, firedAt: fired, range }, new THREE.MeshBasicMaterial());

  it("flies at the shot's speed along its line", () => {
    const tr = make(30);
    tr.update(fired + 100);
    expect(tr.mesh.position.z).toBeCloseTo(-PROJECTILE_SPEED * 0.1, 3);
  });

  it("stops at its range, then fades out as its tail catches up", () => {
    const tr = make(5);
    const stopAt = (5 / PROJECTILE_SPEED) * 1000;
    expect(tr.update(fired + stopAt + 10)).toBe(true);
    expect(tr.mesh.position.z).toBeCloseTo(-5, 3);
    expect(tr.update(fired + stopAt + 1000)).toBe(false);
  });

  it("is invisible when fired point-blank into a wall", () => {
    const tr = make(0);
    tr.update(fired + 20);
    expect(tr.mesh.visible).toBe(false);
  });
});

describe("ServerClock", () => {
  it("tracks the server's time from message timestamps, favouring the least delayed", () => {
    const clock = new ServerClock();
    const skew = 5000;
    // a prompt packet is 5 ms old on arrival; delayed ones 80--90 ms
    clock.observe(Date.now() + skew - 80);
    for (let i = 0; i < 6; i++) clock.observe(Date.now() + skew - 5);
    for (let i = 0; i < 3; i++) clock.observe(Date.now() + skew - 90);
    // close to the prompt estimate, not dragged toward the late ones
    expect(Math.abs(clock.now() - (Date.now() + skew))).toBeLessThan(20);
  });
});
