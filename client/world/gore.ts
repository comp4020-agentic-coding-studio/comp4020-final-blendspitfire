import * as THREE from "three";
import { BLOOD_CRAWLER, BLOOD_HUMAN, CONCRETE, EMIT_SPARK } from "../../shared/palette.ts";
import { capGore, type GoreMark, type ShotHit } from "../../shared/protocol.ts";
import { character, crawler } from "../models/index.ts";
import { glow } from "../look.ts";

// What a fight leaves behind (GoreMark in shared/protocol.ts), and the
// sparks and splashes as a round lands. Blood is a flat decal on the floor,
// one instanced mesh per colour so a long run of it is two draw calls.
// Bodies are the live models laid down, darkened and pressed nearly flat, the
// crew's in their own colour: a body is something you recognise, not a new
// asset, and flat it can never stand over a live crawler.

const MAX_BLOOD = 900;
/** floor tiles' tops are at 0.02 and their painted marks at ~0.026: blood goes over both */
const BLOOD_Y = 0.03;
/** bodies lie over the blood, a few centimetres thick */
const BODY_Y = 0.045;
const BODY_THICKNESS = 0.04;

/** press a laid-down model flat onto the floor, keeping its outline from above */
function flatten(obj: THREE.Object3D): THREE.Object3D {
  const box = new THREE.Box3().setFromObject(obj);
  const k = BODY_THICKNESS / (box.max.y - box.min.y);
  const outer = new THREE.Group().add(obj);
  outer.scale.y = k;
  outer.position.y = BODY_Y - box.min.y * k;
  return new THREE.Group().add(outer);
}

/** a ragged splash: a disc with a seeded, lumpy rim, flat on the floor */
function splashGeometry(): THREE.BufferGeometry {
  const n = 9;
  const pts: number[] = [0, 0, 0];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 0.7 + 0.3 * Math.abs(Math.sin(i * 2.7 + 1.3));
    pts.push(Math.cos(a) * r, 0, Math.sin(a) * r);
  }
  const idx: number[] = [];
  for (let i = 1; i <= n; i++) idx.push(0, i + 1, i);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function bloodMesh(color: number): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(
    splashGeometry(),
    // lit, so it sits in the lamp light like the floor it's on
    new THREE.MeshLambertMaterial({ color, polygonOffset: true, polygonOffsetFactor: -2 }),
    MAX_BLOOD,
  );
  m.count = 0;
  m.frustumCulled = false;
  m.receiveShadow = true;
  return m;
}

const dim = (obj: THREE.Object3D, k: number): void => {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry.attributes.color) return;
    mesh.geometry = mesh.geometry.clone();
    const c = mesh.geometry.attributes.color;
    for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  });
};

export class Gore {
  readonly group = new THREE.Group();
  private marks: GoreMark[] = [];
  private readonly blood = { player: bloodMesh(BLOOD_HUMAN), enemy: bloodMesh(BLOOD_CRAWLER) };
  private readonly bodies = new Map<number, THREE.Object3D>();
  private enemyBody: THREE.Object3D;

  constructor() {
    this.group.add(this.blood.player, this.blood.enemy);
    // one crawler, laid on its back and darkened: cloned per body
    this.enemyBody = crawler();
    this.enemyBody.traverse((o) => {
      // dead eyes don't glow
      if ((o as THREE.Mesh).isMesh && ((o as THREE.Mesh).material as THREE.Material).type === "MeshBasicMaterial") o.visible = false;
    });
    dim(this.enemyBody, 0.5);
    // dead bug: on its back, legs in the air
    this.enemyBody.rotation.z = Math.PI;
    this.enemyBody = flatten(this.enemyBody);
  }

  /** apply a broadcast's marks: all of them after a reset, otherwise just the new ones */
  apply(marks: GoreMark[] | undefined, reset: boolean): void {
    if (!marks && !reset) return;
    this.marks = capGore(reset ? [...(marks ?? [])] : [...this.marks, ...(marks ?? [])]);
    this.rebuild();
  }

  private rebuild(): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const counts = { player: 0, enemy: 0 };
    const keep = new Set<number>();
    for (const g of this.marks) {
      if (g.kind === "blood") {
        const mesh = this.blood[g.who];
        if (counts[g.who] >= MAX_BLOOD) continue;
        const s = g.size ?? 0.3;
        // each splash a touch higher than the last, so overlapping ones don't fight
        m.compose(new THREE.Vector3(g.x, BLOOD_Y + (g.n % 50) * 0.0002, g.z), q.setFromAxisAngle(up, g.r), new THREE.Vector3(s, 1, s * 0.8));
        mesh.setMatrixAt(counts[g.who]++, m);
        continue;
      }
      keep.add(g.n);
      if (this.bodies.has(g.n)) continue;
      const body = g.who === "enemy" ? this.enemyBody.clone() : this.crewBody(g.color ?? "#888888");
      body.position.set(g.x, 0, g.z);
      body.rotation.y = g.r;
      this.group.add(body);
      this.bodies.set(g.n, body);
    }
    for (const [n, body] of this.bodies) {
      if (keep.has(n)) continue;
      this.group.remove(body);
      this.bodies.delete(n);
    }
    for (const who of ["player", "enemy"] as const) {
      this.blood[who].count = counts[who];
      this.blood[who].instanceMatrix.needsUpdate = true;
    }
  }

  /** a crewmate who fell: their own model, face down, darkened */
  private crewBody(color: string): THREE.Object3D {
    const body = character(color);
    dim(body, 0.55);
    body.rotation.x = Math.PI / 2;
    body.position.z = -0.55;
    return flatten(new THREE.Group().add(body));
  }
}

// --- Impacts ------------------------------------------------------------------
// Where a round lands: a burst of short-lived bits flying out from the hit,
// sparks off walls and boxes, a splash off whatever bleeds. Pooled sprites,
// so a long burst of fire allocates nothing.

interface Bit {
  sprite: THREE.Sprite;
  vx: number;
  vy: number;
  vz: number;
  born: number;
  life: number;
  size: number;
}

/** a chip of debris kicked off a wall or box: a tumbling little chunk, not a glow */
interface Chip {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  spin: THREE.Vector3;
  born: number;
  life: number;
  size: number;
}

const IMPACT_COLOUR: Record<ShotHit, number> = { wall: EMIT_SPARK, enemy: BLOOD_CRAWLER, player: BLOOD_HUMAN };
/** debris chips off a wall or box: concrete, not an emitter, so it reads as matter rather than light */
const DEBRIS_COLOURS = [CONCRETE.base, CONCRETE.shade, CONCRETE.light];
const chipGeometry = new THREE.BoxGeometry(1, 1, 1);

export class Impacts {
  readonly group = new THREE.Group();
  private readonly free: THREE.Sprite[] = [];
  private readonly freeDroplets: THREE.Sprite[] = [];
  private readonly freeChips: THREE.Mesh[] = [];
  private readonly live: Bit[] = [];
  private readonly liveChips: Chip[] = [];
  private readonly flashes: { sprite: THREE.Sprite; born: number }[] = [];

  /** a lit spark (additive), or a droplet: blood is dark, and dark can't be added on */
  private take(color: number, size: number, opacity: number, droplet = false): THREE.Sprite {
    const s = droplet
      ? (this.freeDroplets.pop() ?? new THREE.Sprite(new THREE.SpriteMaterial({ color, transparent: true, depthWrite: false })))
      : (this.free.pop() ?? glow(color, size, opacity));
    s.userData.droplet = droplet;
    s.material.color.setHex(color);
    s.material.opacity = opacity;
    s.visible = true;
    this.group.add(s);
    return s;
  }

  private takeChip(): THREE.Mesh {
    const m =
      this.freeChips.pop() ??
      new THREE.Mesh(
        chipGeometry,
        new THREE.MeshStandardMaterial({ vertexColors: false, flatShading: true, roughness: 0.95, metalness: 0, transparent: true }),
      );
    m.visible = true;
    this.group.add(m);
    return m;
  }

  /** a round landed at (x, z) flying along (dirX, dirZ) */
  hit(kind: ShotHit, x: number, z: number, dirX: number, dirZ: number): void {
    const now = performance.now();
    const colour = IMPACT_COLOUR[kind];
    const n = kind === "wall" ? 5 : 6;
    for (let i = 0; i < n; i++) {
      // off a wall the bits kick back toward the shooter; off a body they spray on through
      const back = kind === "wall" ? -1 : 1;
      const a = Math.atan2(dirX * back, dirZ * back) + (Math.random() - 0.5) * (kind === "wall" ? 2.0 : 1.4);
      const speed = (kind === "wall" ? 7 : 3) * (0.5 + Math.random());
      const size = kind === "wall" ? 0.05 + Math.random() * 0.05 : 0.2 + Math.random() * 0.15;
      const sprite = this.take(colour, size, 1, kind !== "wall");
      sprite.scale.setScalar(size);
      sprite.position.set(x, 0.9 + (Math.random() - 0.5) * 0.3, z);
      this.live.push({ sprite, vx: Math.sin(a) * speed, vy: 1 + Math.random() * 2, vz: Math.cos(a) * speed, born: now, life: kind === "wall" ? 90 + Math.random() * 70 : 260 + Math.random() * 160, size });
    }
    if (kind === "wall") {
      // chunks of the wall itself, kicked out and tumbling, heavier and slower than the sparks
      for (let i = 0; i < 6; i++) {
        const a = Math.atan2(-dirX, -dirZ) + (Math.random() - 0.5) * 2.6;
        const speed = 1.5 + Math.random() * 2.5;
        const size = 0.035 + Math.random() * 0.05;
        const mesh = this.takeChip();
        (mesh.material as THREE.MeshStandardMaterial).color.setHex(DEBRIS_COLOURS[Math.floor(Math.random() * DEBRIS_COLOURS.length)]);
        mesh.scale.set(size, size * (0.6 + Math.random() * 0.6), size);
        mesh.position.set(x, 0.9 + (Math.random() - 0.5) * 0.3, z);
        mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        this.liveChips.push({
          mesh,
          vx: Math.sin(a) * speed,
          vy: 1.5 + Math.random() * 2,
          vz: Math.cos(a) * speed,
          spin: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12),
          born: now,
          life: 500 + Math.random() * 400,
          size,
        });
      }
    }
    // a dark puff off flesh; a wall gets no flash, only its sparks and chips
    if (kind !== "wall") {
      const flash = this.take(colour, 0.45, 0.9, true);
      flash.scale.setScalar(0.45);
      flash.position.set(x, 0.95, z);
      this.flashes.push({ sprite: flash, born: now });
    }
  }

  /**
   * The shimmer at the muzzle when a round leaves: a soft hot glow that the
   * retro grade quantises into a few stepped rings for a frame or two,
   * which reads as the air bending. It used to sit on the wall hit.
   */
  muzzle(x: number, z: number): void {
    const flash = this.take(EMIT_SPARK, 0.4, 0.95);
    flash.scale.setScalar(0.4);
    flash.position.set(x, 1.1, z);
    this.flashes.push({ sprite: flash, born: performance.now() });
  }

  step(dt: number): void {
    const now = performance.now();
    for (let i = this.live.length - 1; i >= 0; i--) {
      const b = this.live[i];
      const k = (now - b.born) / b.life;
      if (k >= 1) {
        this.release(b.sprite);
        this.live.splice(i, 1);
        continue;
      }
      b.vy -= 9 * dt;
      b.sprite.position.x += b.vx * dt;
      b.sprite.position.y = Math.max(0.03, b.sprite.position.y + b.vy * dt);
      b.sprite.position.z += b.vz * dt;
      b.sprite.material.opacity = 1 - k;
      b.sprite.scale.setScalar(b.size * (1 - k * 0.5));
    }
    for (let i = this.liveChips.length - 1; i >= 0; i--) {
      const c = this.liveChips[i];
      const k = (now - c.born) / c.life;
      if (k >= 1) {
        this.releaseChip(c.mesh);
        this.liveChips.splice(i, 1);
        continue;
      }
      c.vy -= 14 * dt;
      c.mesh.position.x += c.vx * dt;
      c.mesh.position.y += c.vy * dt;
      c.mesh.position.z += c.vz * dt;
      if (c.mesh.position.y <= 0.03) {
        // settled on the floor: stop falling, keep tumbling a touch slower till it fades
        c.mesh.position.y = 0.03;
        c.vx *= 0.7;
        c.vz *= 0.7;
        c.vy = 0;
        c.spin.multiplyScalar(0.8);
      }
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;
      if (k > 0.7) (c.mesh.material as THREE.MeshStandardMaterial).opacity = 1 - (k - 0.7) / 0.3;
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      const k = (now - f.born) / 90;
      if (k >= 1) {
        this.release(f.sprite);
        this.flashes.splice(i, 1);
        continue;
      }
      f.sprite.material.opacity = 1 - k;
    }
  }

  private release(s: THREE.Sprite): void {
    s.visible = false;
    this.group.remove(s);
    (s.userData.droplet ? this.freeDroplets : this.free).push(s);
  }

  private releaseChip(m: THREE.Mesh): void {
    m.visible = false;
    (m.material as THREE.MeshStandardMaterial).opacity = 1;
    this.group.remove(m);
    this.freeChips.push(m);
  }
}
