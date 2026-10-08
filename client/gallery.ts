import * as THREE from "three";
import { setupLighting, configureRenderer } from "./look.ts";
import {
  GUN_REST_HEIGHT,
  HELD_GUN_OFFSET,
  character,
  crate,
  ground,
  gun,
  heldGun,
  pineGeometry,
  rock,
  wall,
} from "./models/index.ts";
import { mesh } from "./models/kit.ts";
import { ACCENT, PLAYER_COLORS } from "../shared/palette.ts";

// A model review sheet, not part of the game. Each row is one asset, seen:
//   1. from straight overhead at the game's own pixel scale (what a player
//      actually gets), 2. overhead, close up, 3. from the side, close up,
//   4. a slowly turning three-quarter view.
// Open /gallery.html while the dev server runs.

// the game's camera: 22 up, 50° vertical FOV
const GAME_UNITS_TALL = 2 * 22 * Math.tan((25 * Math.PI) / 180);

interface Row {
  label: string;
  build: () => THREE.Object3D;
  /** how much of the world (in units) the close-up columns frame */
  frame: number;
}

const projectile = (): THREE.Object3D => {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 0), new THREE.MeshBasicMaterial({ color: ACCENT }));
  m.position.y = 0.5;
  return m;
};

const lying = (obj: THREE.Mesh): THREE.Mesh => {
  obj.position.y = GUN_REST_HEIGHT;
  return obj;
};

const rows: Row[] = [
  { label: "character", build: () => character(PLAYER_COLORS[1]), frame: 2.2 },
  {
    label: "character + held M4A1",
    build: () => {
      const g = new THREE.Group();
      g.add(character(PLAYER_COLORS[3]));
      const held = heldGun();
      held.position.set(HELD_GUN_OFFSET.x, HELD_GUN_OFFSET.y, HELD_GUN_OFFSET.z);
      g.add(held);
      return g;
    },
    frame: 2.6,
  },
  { label: "M4A1 (on the ground)", build: () => lying(gun()), frame: 1.8 },
  { label: "crate", build: crate, frame: 1.8 },
  { label: "rock (2×2 footprint)", build: () => rock(1, 1, 1.6, 7), frame: 3 },
  { label: "wall segment", build: () => wall(3, 0.3, 0.8), frame: 7 },
  { label: "pine", build: () => mesh(pineGeometry()), frame: 4 },
  { label: "projectile", build: projectile, frame: 0.8 },
  {
    label: "together, game scale",
    build: () => {
      const g = new THREE.Group();
      const a = character(PLAYER_COLORS[2]);
      const held = heldGun();
      held.position.set(HELD_GUN_OFFSET.x, HELD_GUN_OFFSET.y, HELD_GUN_OFFSET.z);
      a.add(held);
      a.position.set(-2, 0, 0);
      a.rotation.y = 0.6;
      g.add(a);
      const b = character(PLAYER_COLORS[0]);
      b.position.set(2.5, 0, 1);
      b.rotation.y = -2;
      g.add(b);
      const loose = lying(gun());
      loose.position.x = 0.5;
      loose.rotation.y = 1.2;
      g.add(loose);
      const c = crate();
      c.position.set(1, 0, -2);
      g.add(c);
      const r = rock(1, 1, 1.6, 3);
      r.position.set(-4, 0, -2);
      g.add(r);
      return g;
    },
    frame: 10,
  },
];

const ROW_H = 150;
const COLS = 4;
const LABEL_W = 170;

const container = document.getElementById("sheet")!;
container.style.height = `${rows.length * ROW_H}px`;
const canvas = document.createElement("canvas");
container.appendChild(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
configureRenderer(renderer);

interface Prepared {
  scene: THREE.Scene;
  model: THREE.Object3D;
  frame: number;
}

const prepared: Prepared[] = rows.map((row, i) => {
  const scene = new THREE.Scene();
  setupLighting(scene, 8);
  const floor = ground(30, 30, 11 + i);
  scene.add(floor);
  const model = row.build();
  scene.add(model);
  const label = document.createElement("div");
  label.className = "label";
  label.style.top = `${i * ROW_H}px`;
  label.textContent = row.label;
  container.appendChild(label);
  return { scene, model, frame: row.frame };
});

const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 200);

function frameCamera(visibleUnits: number, aspect: number, view: "top" | "side" | "three-quarter", t: number): void {
  cam.aspect = aspect;
  const dist = 22;
  cam.fov = (2 * Math.atan(visibleUnits / 2 / dist) * 180) / Math.PI;
  cam.updateProjectionMatrix();
  if (view === "top") {
    cam.up.set(0, 0, -1);
    cam.position.set(0, dist, 0);
    cam.lookAt(0, 0, 0);
  } else if (view === "side") {
    cam.up.set(0, 1, 0);
    cam.position.set(dist, 0.6, 0);
    cam.lookAt(0, 0.6, 0);
  } else {
    cam.up.set(0, 1, 0);
    cam.position.set(Math.sin(t) * dist * 0.7, dist * 0.6, Math.cos(t) * dist * 0.7);
    cam.lookAt(0, 0.5, 0);
  }
}

function render(time: number): void {
  const width = container.clientWidth;
  renderer.setSize(width, rows.length * ROW_H, false);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${rows.length * ROW_H}px`;
  const cellW = (width - LABEL_W) / COLS;
  const fullH = rows.length * ROW_H;
  renderer.setScissorTest(true);
  const t = time / 2500;
  prepared.forEach((p, i) => {
    const y = fullH - (i + 1) * ROW_H; // GL viewports count from the bottom
    for (let col = 0; col < COLS; col++) {
      const x = LABEL_W + col * cellW;
      renderer.setViewport(x, y, cellW - 4, ROW_H - 4);
      renderer.setScissor(x, y, cellW - 4, ROW_H - 4);
      const aspect = (cellW - 4) / (ROW_H - 4);
      if (col === 0) {
        // game scale, assuming a 1080-pixel-tall game window
        frameCamera(((ROW_H - 4) / 1080) * GAME_UNITS_TALL, aspect, "top", t);
      } else {
        frameCamera(p.frame, aspect, col === 1 ? "top" : col === 2 ? "side" : "three-quarter", t);
      }
      renderer.render(p.scene, cam);
    }
  });
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
