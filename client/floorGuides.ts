import * as THREE from "three";
import { ACCENT, STENCIL, hex } from "../shared/palette.ts";
import { LIFT_DOORS, SPAWN_POINTS, STATIONS } from "../shared/protocol.ts";

// The garden's tutorial: controls painted on the floor right next to the
// thing they're about, so a new player reads them where they need them
// instead of in a menu. Each guide is drawn with canvas 2D (keycaps, a
// mouse, a trackpad, arrows, text) into a texture on a flat decal --- the
// one place the art rules allow a texture.

const PX_PER_UNIT = 128;
const INK = hex(STENCIL);
const HIGHLIGHT = hex(ACCENT);

type Draw = (ctx: CanvasRenderingContext2D) => void;

function decal(width: number, height: number, x: number, z: number, draw: Draw): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * PX_PER_UNIT);
  canvas.height = Math.round(height * PX_PER_UNIT);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(PX_PER_UNIT, PX_PER_UNIT); // draw in world units from here on
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 0.045;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  draw(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  // flat on the floor, canvas-top toward screen-top (-Z)
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, 0.02, z);
  mesh.receiveShadow = false;
  return mesh;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size = 0.32, color = INK): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `700 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillText(s, x, y);
  ctx.restore();
}

/** a keycap outline with its label, `w` wide (Space is wider) */
function key(ctx: CanvasRenderingContext2D, label: string, x: number, y: number, w = 0.5): void {
  roundRect(ctx, x, y, w, 0.5, 0.08);
  ctx.stroke();
  ctx.save();
  ctx.font = `700 0.26px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + w / 2, y + 0.27);
  ctx.restore();
}

/** a mouse with one button filled in */
function mouse(ctx: CanvasRenderingContext2D, x: number, y: number, button: "left" | "right"): void {
  const w = 0.44;
  const h = 0.66;
  roundRect(ctx, x, y, w, h, 0.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y);
  ctx.lineTo(x + w / 2, y + h * 0.4);
  ctx.moveTo(x, y + h * 0.4);
  ctx.lineTo(x + w, y + h * 0.4);
  ctx.stroke();
  ctx.save();
  ctx.fillStyle = HIGHLIGHT;
  ctx.beginPath();
  if (button === "left") ctx.roundRect(x + 0.04, y + 0.04, w / 2 - 0.07, h * 0.4 - 0.07, [0.16, 0, 0, 0]);
  else ctx.roundRect(x + w / 2 + 0.03, y + 0.04, w / 2 - 0.07, h * 0.4 - 0.07, [0, 0.16, 0, 0]);
  ctx.fill();
  ctx.restore();
}

/** a trackpad with two fingertips: the two-finger click */
function trackpad(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  roundRect(ctx, x, y, 0.7, 0.5, 0.06);
  ctx.stroke();
  ctx.save();
  ctx.fillStyle = HIGHLIGHT;
  for (const dx of [0.25, 0.45]) {
    ctx.beginPath();
    ctx.arc(x + dx, y + 0.25, 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function arrowUp(ctx: CanvasRenderingContext2D, x: number, y: number, h: number): void {
  ctx.save();
  ctx.lineWidth = 0.09;
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y);
  ctx.moveTo(x - 0.28, y + 0.3);
  ctx.lineTo(x, y);
  ctx.lineTo(x + 0.28, y + 0.3);
  ctx.stroke();
  ctx.restore();
}

export function buildYardGuides(): THREE.Group {
  const group = new THREE.Group();
  const spawn = SPAWN_POINTS[1];

  // movement and the use key, just north of where everyone arrives
  group.add(
    decal(4.4, 1.4, spawn.x, spawn.z - 1.6, (ctx) => {
      key(ctx, "W", 0.62, 0.1);
      key(ctx, "A", 0.06, 0.68);
      key(ctx, "S", 0.62, 0.68);
      key(ctx, "D", 1.18, 0.68);
      text(ctx, "move", 1.95, 0.7, 0.38);
      key(ctx, "E", 3.0, 0.4);
      text(ctx, "use", 3.62, 0.66, 0.38);
    }),
  );

  // the rifle stands (user 2026-11-05): the stand itself (slab, rack, glowing
  // ring, marker) says "here"; the floor says how --- E beside each, and at
  // the range stand, where you'd shoot, fire and drop too
  for (const station of STATIONS) {
    const x = station.x;
    const atRange = station.z < SPAWN_POINTS[1].z - 6;
    // the lift stand's guide goes west of it (east is the path and the lift arrow)
    group.add(
      decal(2.6, 0.9, atRange ? x : x - 2.9, atRange ? station.z + 1.95 : station.z, (ctx) => {
        key(ctx, "E", 0.22, 0.2);
        text(ctx, "pick up", 0.9, 0.45);
      }),
    );
    if (station.kind === "gun" && atRange) {
      group.add(
        decal(3.8, 1.6, x + 0.2, station.z + 3.35, (ctx) => {
          mouse(ctx, 0.35, 0.05, "left");
          text(ctx, "/", 0.95, 0.3);
          key(ctx, "Space", 1.25, 0.05, 1.0);
          text(ctx, "fire", 2.5, 0.3);
          text(ctx, "hold for auto · try the targets", 1.0, 0.72, 0.2);
          key(ctx, "Q", 0.32, 1.0);
          text(ctx, "drop", 1.0, 1.25);
        }),
      );
    }
  }

  // the way down, in front of the lift door
  const door = LIFT_DOORS.top;
  group.add(
    decal(3.4, 1.4, door.x, door.z - 2.2, (ctx) => {
      ctx.save();
      ctx.translate(0.5, 0.7);
      ctx.rotate(Math.PI);
      arrowUp(ctx, 0, -0.55, 1.0);
      ctx.restore();
      text(ctx, "lift", 0.95, 0.45, 0.4);
      text(ctx, "down to the facility", 0.95, 0.95, 0.2);
    }),
  );

  return group;
}
