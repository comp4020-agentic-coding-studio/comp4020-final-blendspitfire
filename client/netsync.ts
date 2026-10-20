import * as THREE from "three";
import { BROADCAST_INTERVAL_MS, PROJECTILE_SPEED, type ProjectileState } from "../shared/protocol.ts";

// The client side of keeping several players in step. Three pieces:
//
// - ServerClock: an estimate of the server's Date.now(), from the
//   timestamps on its messages. Everything time-based below runs on it.
// - SnapshotBuffer: another player's recent positions, played back a
//   little in the past (INTERP_DELAY), so their movement is interpolated
//   between two real updates instead of chasing the newest one --- smooth
//   even when packets arrive unevenly.
// - Tracer: a bullet drawn from the one message that announced it (origin,
//   direction, fire time, range), so a very fast shot looks the same on
//   every screen without its position being streamed.

/**
 * How far behind the server other players are drawn: two broadcast
 * intervals, so there are almost always two snapshots to blend between
 * even if one arrives late.
 */
export const INTERP_DELAY_MS = BROADCAST_INTERVAL_MS * 2;

export class ServerClock {
  private offset = 0;
  private samples = 0;

  /** feed a server timestamp as a message arrives */
  observe(serverT: number): void {
    const sample = serverT - Date.now();
    // a packet that sat in the network arrives late, so its sample comes
    // out low; the highest samples are the least delayed. Ease up to a new
    // high quickly and down slowly, so a burst of late packets doesn't drag
    // the clock back (the slow ease still follows real drift)
    if (this.samples === 0) this.offset = sample;
    else if (sample > this.offset) this.offset += (sample - this.offset) * 0.5;
    else this.offset += (sample - this.offset) * 0.02;
    this.samples++;
  }

  now(): number {
    return Date.now() + this.offset;
  }
}

interface Snapshot {
  t: number;
  x: number;
  z: number;
  rotation: number;
}

/** an angle-aware lerp, so a turn from 179° to -179° goes the short way */
function lerpAngle(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export class SnapshotBuffer {
  private snaps: Snapshot[] = [];

  push(t: number, x: number, z: number, rotation: number): void {
    const last = this.snaps[this.snaps.length - 1];
    if (last && t <= last.t) return;
    // a big jump is a respawn, not movement: start over rather than slide across the map
    if (last && Math.hypot(x - last.x, z - last.z) > 4) this.snaps = [];
    this.snaps.push({ t, x, z, rotation });
    if (this.snaps.length > 20) this.snaps.shift();
  }

  /** where to draw them at server time `t`; holds still at the ends rather than guessing */
  sample(t: number, out: { x: number; z: number; rotation: number }): void {
    const s = this.snaps;
    if (s.length === 0) return;
    if (t <= s[0].t) {
      Object.assign(out, { x: s[0].x, z: s[0].z, rotation: s[0].rotation });
      return;
    }
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1];
      const b = s[i];
      if (t >= a.t) {
        // past the newest snapshot it holds there rather than extrapolating:
        // a brief pause on a late packet beats a guess that snaps back
        const k = Math.min(1, (t - a.t) / (b.t - a.t));
        out.x = a.x + (b.x - a.x) * k;
        out.z = a.z + (b.z - a.z) * k;
        out.rotation = lerpAngle(a.rotation, b.rotation, k);
        return;
      }
    }
  }
}

/** a bullet's streak: a thin bright line from just behind its head, so speed reads as a tracer */
const TRACER_LENGTH = 2.6;
const tracerGeometry = new THREE.BoxGeometry(0.08, 0.08, 1).translate(0, 0, -0.5);

export class Tracer {
  readonly mesh: THREE.Mesh;
  state: ProjectileState;

  constructor(state: ProjectileState, material: THREE.Material) {
    this.state = state;
    this.mesh = new THREE.Mesh(tracerGeometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.rotation.y = Math.atan2(state.dirX, state.dirZ);
  }

  /** place it for server time `t`; returns false once it's finished (reached where it stops) */
  update(t: number): boolean {
    const s = this.state;
    const d = ((t - s.firedAt) / 1000) * PROJECTILE_SPEED;
    const head = Math.min(Math.max(d, 0), s.range);
    const tail = Math.max(0, head - TRACER_LENGTH);
    const len = head - tail;
    this.mesh.visible = len > 0.01;
    this.mesh.position.set(s.x + s.dirX * head, 0.95, s.z + s.dirZ * head);
    this.mesh.scale.set(1, 1, Math.max(0.01, len));
    // once the head has stopped, the tail catches up and the streak vanishes
    return d < s.range + TRACER_LENGTH;
  }
}
