import * as THREE from "three";
import { CONCRETE, CONCRETE_DARK, EMIT_GREEN, EMIT_RED, FLOOR, HAZARD, PAINT_OCHRE, PAINT_PUTTY, PAPER, RUBBER, STEEL, WOOD, hex } from "../../shared/palette.ts";
import {
  DROP_PAD,
  HELIPADS,
  LESSONS,
  LESSON_TEXT,
  MOVE_PAD,
  TARGET_HITS,
  TARGET_RADIUS,
  TUT_BOUNDS,
  TUT_CLUSTER,
  TUT_DX,
  TUT_ROOMS,
  TUT_WALLS,
  TUT_WALL_HALF_HEIGHT,
  tutDoor,
} from "../../shared/tutorial.ts";
import { glowPart, merge, mesh, multiMesh, part } from "../models/kit.ts";
import { helicopter } from "../models/heli.ts";

// The tutorial as drawn (shared/tutorial.ts has the layout and rules): the
// corp's training shed, a row of bare rooms under a skylight, each with its
// lesson stencilled on the floor. Built only while you're in it (the client
// builds it on the way in and throws it away on the way out), so it costs
// nothing the rest of the time.
//
// What's per player --- which doors are still shut to you, which of your
// targets still stand, whether your grenade has caught the huddle --- is
// set each frame from your own state by update().

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const H = TUT_WALL_HALF_HEIGHT * 2;
const PX = 96;

/** a stencil on the floor: lesson number, title, how to do it */
function floorText(i: number): THREE.Mesh {
  const lesson = LESSONS[i];
  const t = LESSON_TEXT[lesson];
  const w = 7.6;
  const h = 2.0;
  const canvas = document.createElement("canvas");
  canvas.width = w * PX;
  canvas.height = h * PX;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(PX, PX);
  ctx.fillStyle = hex(RUBBER.shade);
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.font = `400 0.8px "VT323", ui-monospace, monospace`;
  ctx.fillText(`${i + 1}/${LESSONS.length} ${t.title.toUpperCase()}`, w / 2, 0.5);
  ctx.font = `400 0.56px "VT323", ui-monospace, monospace`;
  ctx.fillText(t.how.toUpperCase(), w / 2, 1.45);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.95, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  const r = TUT_ROOMS[i];
  // along the north wall, just inside the way in, clear of what the room's about
  // the last room's helicopter takes its north end: there the words go down the west side, by the way in
  if (i === LESSONS.length - 1) {
    m.rotation.z = Math.PI / 2;
    m.position.set(r.minX + 1.15, 0.025, (r.minZ + r.maxZ) / 2 + 0.5);
  } else m.position.set(TUT_DX, 0.025, r.minZ + 1.15);
  return m;
}

/** a painted ring on the floor: where to stand */
function pad(x: number, z: number, r: number, color: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.RingGeometry(r - 0.12, r, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false }));
  m.position.set(x, 0.03, z);
  return m;
}

/** a target: a plywood board on a stand, face tipped up toward the camera, hit pips on the rim */
function targetModel(): THREE.Group {
  const g = multiMesh({
    matte: [
      merge(
        [
          part(box(0.08, 0.9, 0.08), WOOD.shade, 0, 0.45, 0.08),
          part(box(0.6, 0.06, 0.4), STEEL.shade, 0, 0.03, 0.08),
          part(new THREE.CylinderGeometry(TARGET_RADIUS, TARGET_RADIUS, 0.05, 10), PAINT_PUTTY.light, 0, 0.95, 0, Math.PI / 2 - 0.6, 0, 0),
          part(new THREE.CylinderGeometry(TARGET_RADIUS * 0.55, TARGET_RADIUS * 0.55, 0.06, 10), PAINT_OCHRE.shade, 0, 0.96, 0.01, Math.PI / 2 - 0.6, 0, 0),
        ],
        "ground",
        0.2,
      ),
    ],
  });
  return g;
}

/** a training dummy: a padded post on a weighted base */
function dummyGeometry(): THREE.BufferGeometry {
  return merge(
    [
      part(new THREE.CylinderGeometry(0.3, 0.34, 0.12, 8), RUBBER.base, 0, 0.06, 0),
      part(new THREE.CylinderGeometry(0.2, 0.22, 1.1, 7), PAINT_OCHRE.base, 0, 0.67, 0),
      part(new THREE.IcosahedronGeometry(0.2, 0), PAINT_OCHRE.light, 0, 1.36, 0),
    ],
    "ground",
    0.2,
  );
}

export interface TutorialView {
  group: THREE.Group;
  /** set what's per player from their state */
  update(stage: number, hits: number[] | undefined, blasted: boolean, time: number): void;
  dispose(): void;
}

export function buildTutorial(): TutorialView {
  const group = new THREE.Group();
  const shell: THREE.BufferGeometry[] = [];
  const floor: THREE.BufferGeometry[] = [];
  // concrete slab, a darker band at each doorway
  for (const r of TUT_ROOMS) {
    floor.push(part(box(r.maxX - r.minX, 0.04, r.maxZ - r.minZ), CONCRETE.base, (r.minX + r.maxX) / 2, 0, (r.minZ + r.maxZ) / 2));
  }
  for (let i = 0; i < LESSONS.length - 1; i++) {
    const d = tutDoor(i);
    floor.push(part(box(d.halfX * 2, 0.042, d.halfZ * 2), CONCRETE_DARK.base, d.x, 0, d.z));
    floor.push(part(box(d.halfX * 2, 0.044, 0.1), HAZARD.base, d.x, 0, d.z - d.halfZ - 0.05));
  }
  // walls: painted block, a putty dado below, a hazard stripe at the top edge
  for (const w of TUT_WALLS) {
    shell.push(part(box(w.halfX * 2, H, w.halfZ * 2), PAINT_PUTTY.base, w.x, H / 2, w.z));
    shell.push(part(box(w.halfX * 2 + 0.02, 0.6, w.halfZ * 2 + 0.02), PAINT_PUTTY.shade, w.x, 0.3, w.z));
    shell.push(part(box(w.halfX * 2 + 0.01, 0.06, w.halfZ * 2 + 0.01), HAZARD.shade, w.x, H - 0.03, w.z));
  }
  group.add(mesh(merge(shell, "ground", 0.6)));
  const floorMesh = mesh(merge(floor, "none"), "tile");
  floorMesh.receiveShadow = true;
  group.add(floorMesh);
  // the ground outside the shed: hard standing, so the sky doesn't show through gaps
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(TUT_BOUNDS.maxX - TUT_BOUNDS.minX + 40, TUT_BOUNDS.maxZ - TUT_BOUNDS.minZ + 40).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: FLOOR.shade, roughness: 1 }),
  );
  apron.position.set(TUT_DX, -0.02, (TUT_BOUNDS.minZ + TUT_BOUNDS.maxZ) / 2);
  group.add(apron);

  for (let i = 0; i < LESSONS.length; i++) group.add(floorText(i));
  group.add(pad(MOVE_PAD.x, MOVE_PAD.z, MOVE_PAD.r, PAPER.light));
  group.add(pad(DROP_PAD.x, DROP_PAD.z, DROP_PAD.r, PAPER.light));

  // the doors: one leaf per doorway, with a lamp over it (red shut, green open)
  const doors: { leaf: THREE.Mesh; lamp: THREE.Mesh; open: number }[] = [];
  const lampRed = new THREE.MeshBasicMaterial({ color: EMIT_RED });
  const lampGreen = new THREE.MeshBasicMaterial({ color: EMIT_GREEN });
  for (let i = 0; i < LESSONS.length - 1; i++) {
    const d = tutDoor(i);
    const leaf = mesh(merge([part(box(d.halfX * 2, H - 0.1, 0.14), STEEL.base, 0, (H - 0.1) / 2, 0), part(box(d.halfX * 2, 0.12, 0.16), HAZARD.base, 0, 0.5, 0)], "none"));
    leaf.position.set(d.x, 0, d.z);
    group.add(leaf);
    const lamp = new THREE.Mesh(box(0.16, 0.08, 0.1), lampRed);
    lamp.position.set(d.x + d.halfX + 0.25, H - 0.15, d.z - 0.3);
    group.add(lamp);
    doors.push({ leaf, lamp, open: 0 });
  }

  // targets, one model each so they can drop when they're done
  const targets = [0, 1, 2].map(() => targetModel());
  const pips: THREE.Mesh[][] = [];
  const room2 = TUT_ROOMS[2];
  targets.forEach((t, i) => {
    t.position.set(TUT_DX - 3.2, 0, (room2.minZ + room2.maxZ) / 2 + (i - 1) * 2);
    t.rotation.y = Math.PI / 2;
    group.add(t);
    const row: THREE.Mesh[] = [];
    for (let k = 0; k < TARGET_HITS; k++) {
      const pip = new THREE.Mesh(box(0.1, 0.04, 0.1), new THREE.MeshBasicMaterial({ color: 0x222222 }));
      pip.position.set(t.position.x + 0.55, 0.06, t.position.z - 0.2 + k * 0.2);
      group.add(pip);
      row.push(pip);
    }
    pips.push(row);
  });

  // the huddle of dummies
  const dummyGeo = dummyGeometry();
  const dummies = TUT_CLUSTER.map((c) => {
    const d = mesh(dummyGeo);
    d.position.set(c.x, 0, c.z);
    d.castShadow = true;
    group.add(d);
    return d;
  });

  // the helicopter in the last room
  const heli = helicopter();
  heli.position.set(HELIPADS.tutorial.x, 0, HELIPADS.tutorial.z);
  group.add(heli);
  const rotor = heli.getObjectByName("rotor")!;
  // its pad: a painted H
  const h = multiMesh({
    emissive: [],
    matte: [
      merge(
        [
          part(box(0.3, 0.02, 2.2), PAPER.light, HELIPADS.tutorial.x - 2.4, 0.03, HELIPADS.tutorial.z),
          part(box(0.3, 0.02, 2.2), PAPER.light, HELIPADS.tutorial.x - 1.4, 0.03, HELIPADS.tutorial.z),
          part(box(1.0, 0.02, 0.3), PAPER.light, HELIPADS.tutorial.x - 1.9, 0.03, HELIPADS.tutorial.z),
        ],
        "none",
      ),
    ],
  });
  group.add(h);
  group.add(mesh(glowPart(box(0.1, 0.06, 0.1), EMIT_GREEN, HELIPADS.tutorial.x - 1.9, 0.05, HELIPADS.tutorial.z - 1.4), "emissive"));

  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = o !== apron && o !== floorMesh;
      o.receiveShadow = true;
    }
  });

  return {
    group,
    update(stage, hits, blasted, time) {
      doors.forEach((d, i) => {
        const want = stage > i ? 1 : 0;
        d.open += (want - d.open) * 0.15;
        d.leaf.position.x = TUT_DX + d.open * 2.2;
        d.leaf.visible = d.open < 0.98;
        d.lamp.material = want ? lampGreen : lampRed;
      });
      targets.forEach((t, i) => {
        const n = stage > 2 ? TARGET_HITS : hits?.[i] ?? 0;
        const down = n >= TARGET_HITS;
        // knocked flat when it's done
        t.rotation.x += ((down ? -1.45 : 0) - t.rotation.x) * 0.2;
        pips[i].forEach((p, k) => ((p.material as THREE.MeshBasicMaterial).color.setHex(k < n ? EMIT_GREEN : 0x222222)));
      });
      dummies.forEach((d) => {
        const flat = blasted || stage > 4;
        d.rotation.z += ((flat ? 1.5 : 0) - d.rotation.z) * 0.2;
      });
      rotor.rotation.y = time * 0.6;
    },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    },
  };
}
