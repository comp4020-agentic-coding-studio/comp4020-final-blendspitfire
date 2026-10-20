import * as THREE from "three";
import type { Obstacle, Rect } from "../shared/protocol.ts";

// What the local player can see, as a 2D line-of-sight polygon on the
// floor plane, drawn into a small mask texture the composite pass reads:
// everything outside it --- other rooms, the far side of a rack row, the
// tops of walls --- goes black. Horror-game visibility, computed once per
// movement rather than per pixel.
//
// The occluders are wall, solid and tall-fixture footprints. Each is
// shrunk a hair before casting, so the face of a wall the player is
// looking at lands just inside the polygon (and is drawn) while its top
// and far side fall outside (and go dark).

export interface Segment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

/**
 * occluders shrink by this much per side, so a visible wall face is inside
 * the lit polygon --- comfortably more than one mask texel, or faces would
 * come out half-dimmed by the mask's filtering
 */
const FACE_INSET = 0.15;
/** how far a sight ray reaches when nothing stops it (bigger than any room) */
const SIGHT = 40;

function rectSegments(minX: number, maxX: number, minZ: number, maxZ: number): Segment[] {
  return [
    { ax: minX, az: minZ, bx: maxX, bz: minZ },
    { ax: maxX, az: minZ, bx: maxX, bz: maxZ },
    { ax: maxX, az: maxZ, bx: minX, bz: maxZ },
    { ax: minX, az: maxZ, bx: minX, bz: minZ },
  ];
}

/**
 * What blocks sight: walls, and fixtures taller than a person --- racks,
 * lockers, pillars, coolers. Anything lower (benches, barriers, the
 * reactor) can be seen over, and its top stays visible.
 */
export const SIGHT_BLOCKING_HALF_HEIGHT = 0.95;
export function sightBlockers(walls: Obstacle[], fixtures: Obstacle[]): Obstacle[] {
  return [...walls, ...fixtures.filter((f) => f.halfHeight >= SIGHT_BLOCKING_HALF_HEIGHT)];
}

/**
 * `bounds`: the outermost region anything can be seen in. Its edge is an
 * occluder too, so sight that slips out through an opening (a breach,
 * a doorway at the map's edge) stops there instead of running on.
 */
export function occluderSegments(obstacles: Obstacle[], solids: Rect[], bounds?: Rect): Segment[] {
  const segs: Segment[] = [];
  if (bounds) segs.push(...rectSegments(bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ));
  for (const o of obstacles) {
    segs.push(...rectSegments(o.x - o.halfX + FACE_INSET, o.x + o.halfX - FACE_INSET, o.z - o.halfZ + FACE_INSET, o.z + o.halfZ - FACE_INSET));
  }
  for (const r of solids) segs.push(...rectSegments(r.minX + FACE_INSET, r.maxX - FACE_INSET, r.minZ + FACE_INSET, r.maxZ - FACE_INSET));
  return segs;
}

/** whether (tx, tz) is in plain sight from (ox, oz) */
export function canSee(ox: number, oz: number, tx: number, tz: number, segs: Segment[]): boolean {
  const d = Math.hypot(tx - ox, tz - oz);
  if (d < 1e-6) return true;
  return castRay(ox, oz, (tx - ox) / d, (tz - oz) / d, segs) >= d - 0.05;
}

/** distance along (dx, dz) from (ox, oz) to the nearest segment, or SIGHT */
function castRay(ox: number, oz: number, dx: number, dz: number, segs: Segment[]): number {
  let best = SIGHT;
  for (const s of segs) {
    const ex = s.bx - s.ax;
    const ez = s.bz - s.az;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const fx = s.ax - ox;
    const fz = s.az - oz;
    const t = (fx * ez - fz * ex) / den;
    const u = (fx * dz - fz * dx) / den;
    if (t > 0 && u >= 0 && u <= 1 && t < best) best = t;
  }
  return best;
}

/**
 * The visibility polygon from (ox, oz): rays to every segment endpoint
 * (and a hair either side, to slip past corners), plus a coarse sweep so
 * open stretches are round, sorted by angle.
 */
export function visibilityPolygon(ox: number, oz: number, segs: Segment[]): number[] {
  const angles: number[] = [];
  for (const s of segs) {
    for (const [px, pz] of [
      [s.ax, s.az],
      [s.bx, s.bz],
    ]) {
      const dx = px - ox;
      const dz = pz - oz;
      if (dx * dx + dz * dz > SIGHT * SIGHT) continue;
      const a = Math.atan2(dz, dx);
      angles.push(a - 0.0004, a, a + 0.0004);
    }
  }
  for (let i = 0; i < 96; i++) angles.push((i / 96) * Math.PI * 2 - Math.PI);
  angles.sort((a, b) => a - b);
  const pts: number[] = [];
  for (const a of angles) {
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const t = castRay(ox, oz, dx, dz, segs);
    pts.push(ox + dx * t, oz + dz * t);
  }
  return pts;
}

/**
 * The mask: a top-down orthographic render of the visibility polygon (as
 * a triangle fan) into a small texture, white where seen. `extent` is the
 * half-size of the square it covers, centred on the viewer.
 */
export class VisibilityMask {
  readonly target: THREE.WebGLRenderTarget;
  readonly camera: THREE.OrthographicCamera;
  private readonly scene = new THREE.Scene();
  private readonly geometry = new THREE.BufferGeometry();
  segs: Segment[];
  private readonly baseSegs: Segment[];
  private lastX = NaN;
  private lastZ = NaN;
  /** world-to-mask-UV: (x - centerX) / (2 extent) + 0.5 */
  readonly center = new THREE.Vector2();

  readonly extent: number;

  constructor(obstacles: Obstacle[], solids: Rect[], bounds: Rect, extent = 20, size = 512) {
    this.extent = extent;
    this.baseSegs = occluderSegments(obstacles, solids, bounds);
    this.segs = this.baseSegs;
    this.target = new THREE.WebGLRenderTarget(size, size, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });
    this.camera = new THREE.OrthographicCamera(-extent, extent, extent, -extent, 0.1, 10);
    this.camera.up.set(0, 0, -1);
    const fan = new THREE.Mesh(this.geometry, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    fan.frustumCulled = false;
    this.scene.add(fan);
    this.scene.background = new THREE.Color(0x000000);
  }

  /** occluders that come and go (a lift door shut or open), on top of the fixed ones */
  setExtra(obstacles: Obstacle[]): void {
    this.segs = obstacles.length ? [...this.baseSegs, ...occluderSegments(obstacles, [])] : this.baseSegs;
    this.invalidate();
  }

  /** force a redraw on the next update (after switching to this mask from another) */
  invalidate(): void {
    this.lastX = NaN;
  }

  /** recompute and redraw, only if the viewer has moved */
  update(renderer: THREE.WebGLRenderer, x: number, z: number): void {
    if (Math.abs(x - this.lastX) < 0.02 && Math.abs(z - this.lastZ) < 0.02) return;
    this.lastX = x;
    this.lastZ = z;
    const poly = visibilityPolygon(x, z, this.segs);
    const n = poly.length / 2;
    const pos = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      pos.set([x, 0, z, poly[i * 2], 0, poly[i * 2 + 1], poly[j * 2], 0, poly[j * 2 + 1]], i * 9);
    }
    this.geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.geometry.computeBoundingSphere();
    this.center.set(x, z);
    this.camera.position.set(x, 5, z);
    this.camera.lookAt(x, 0, z);
    const prev = renderer.getRenderTarget();
    const prevToneMapping = renderer.toneMapping;
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prev);
    renderer.toneMapping = prevToneMapping;
  }

  /** what client/postprocess.ts needs to apply this mask; `topCutoff` is the height above which all is unseen */
  postMask(topCutoff: number): { texture: THREE.Texture; center: THREE.Vector2; extent: number; topCutoff: number } {
    return { texture: this.target.texture, center: this.center, extent: this.extent, topCutoff };
  }
}
