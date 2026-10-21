import {
  DOORWAYS,
  FIXTURES,
  LIFT_CARS,
  REACTOR,
  STATIONS,
  SUPPLY_TERMINAL,
  SURFACE,
  SURFACE_FIXTURES,
  TOP_DOOR,
  ZONE_RECTS,
  type LiftLevel,
  type Rect,
} from "../../shared/protocol.ts";
import { EMIT_REACTOR, EMIT_RED } from "../../shared/palette.ts";

// The minimap: the level you're on as a terminal readout, bottom left. The
// floor plan is drawn once per level at two pixels a unit and scaled up
// pixelated, so it has the same chunky steps as the rest of the UI. Over it,
// each frame: the crew in their colours, you with a tick for where you face,
// the lift car, and what there is to find (reactor, supply terminal, the
// gun and box stations up top). No crawlers: it's a plan, not a radar.
// Sits above the hint line and the wound pips, which also anchor bottom left.

const PX_PER_UNIT = 2;
const SCALE = 2;

const STYLE = `
.ui-map { left: 14px; bottom: 150px; padding: 6px 8px 8px; }
.ui-map .title { font-size: 16px; color: var(--ui-dim); margin-bottom: 4px; }
.ui-map canvas { display: block; image-rendering: pixelated; }
`;

interface Plan {
  bounds: Rect;
  floors: Rect[];
  solids: Rect[];
  name: string;
}

const rectOf = (o: { x: number; z: number; halfX: number; halfZ: number }): Rect => ({ minX: o.x - o.halfX, maxX: o.x + o.halfX, minZ: o.z - o.halfZ, maxZ: o.z + o.halfZ });

const PLANS: Record<LiftLevel, Plan> = {
  bottom: {
    name: "facility",
    bounds: { minX: -19, maxX: 19, minZ: -19, maxZ: LIFT_CARS.bottom.maxZ + 1 },
    floors: [...Object.values(ZONE_RECTS).filter((r) => r.maxZ < SURFACE.minZ), ...DOORWAYS],
    solids: FIXTURES.map(rectOf),
  },
  top: {
    name: "surface",
    bounds: { minX: SURFACE.minX - 1, maxX: SURFACE.maxX + 1, minZ: SURFACE.minZ - 1, maxZ: LIFT_CARS.top.maxZ + 1 },
    floors: [SURFACE, LIFT_CARS.top, TOP_DOOR],
    solids: SURFACE_FIXTURES.map(rectOf),
  },
};

export interface MapDot {
  x: number;
  z: number;
  color: string;
}

export interface MapFrame {
  level: LiftLevel;
  self?: MapDot & { rotation: number };
  crew: MapDot[];
  reactorActive: boolean;
  time: number;
}

const hex = (n: number): string => `#${n.toString(16).padStart(6, "0")}`;

export class Minimap {
  private readonly el = document.createElement("div");
  private readonly title = document.createElement("div");
  private readonly canvas = document.createElement("canvas");
  private readonly ctx = this.canvas.getContext("2d")!;
  private readonly base = document.createElement("canvas");
  private level?: LiftLevel;
  private readonly ui: string;
  private readonly dim: string;

  constructor() {
    const style = document.createElement("style");
    style.textContent = STYLE;
    document.head.appendChild(style);
    this.el.className = "ui-frame ui-map";
    this.title.className = "title";
    this.el.append(this.title, this.canvas);
    this.el.style.display = "none";
    document.body.appendChild(this.el);
    const css = getComputedStyle(document.documentElement);
    this.ui = css.getPropertyValue("--ui").trim() || "#f2ead6";
    this.dim = css.getPropertyValue("--ui-dim").trim() || "#8f8a7e";
  }

  hide(): void {
    this.el.style.display = "none";
  }

  render(f: MapFrame): void {
    this.el.style.display = "";
    if (f.level !== this.level) this.drawBase(f.level);
    const plan = PLANS[f.level];
    const { ctx } = this;
    const px = (x: number): number => Math.floor((x - plan.bounds.minX) * PX_PER_UNIT);
    const pz = (z: number): number => Math.floor((z - plan.bounds.minZ) * PX_PER_UNIT);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.base, 0, 0);
    const blink = Math.floor(f.time * 2.5) % 2 === 0;

    // the lift car: outlined, so the way down (or up) is always findable
    const car = LIFT_CARS[f.level];
    ctx.strokeStyle = this.ui;
    ctx.lineWidth = 1;
    ctx.strokeRect(px(car.minX) + 0.5, pz(car.minZ) + 0.5, px(car.maxX) - px(car.minX) - 1, pz(car.maxZ) - pz(car.minZ) - 1);
    if (f.level === "bottom") {
      // the reactor: red on standby (and blinking, it wants starting), blue once it's live
      ctx.fillStyle = hex(f.reactorActive ? EMIT_REACTOR : EMIT_RED);
      if (f.reactorActive || blink) this.diamond(px(REACTOR.x), pz(REACTOR.z), 3);
      ctx.fillStyle = "#e8b04a";
      ctx.fillRect(px(SUPPLY_TERMINAL.x) - 2, pz(SUPPLY_TERMINAL.z) - 1, 4, 3);
    } else {
      ctx.fillStyle = "#e8b04a";
      for (const s of STATIONS) ctx.fillRect(px(s.x) - 1, pz(s.z) - 1, 3, 3);
    }
    for (const c of f.crew) {
      ctx.fillStyle = c.color;
      ctx.fillRect(px(c.x) - 1, pz(c.z) - 1, 3, 3);
    }
    if (f.self) {
      const { x, z, rotation } = f.self;
      ctx.fillStyle = this.ui;
      ctx.fillRect(px(x + Math.sin(rotation) * 1.6), pz(z + Math.cos(rotation) * 1.6), 1, 1);
      ctx.fillRect(px(x) - 2, pz(z) - 2, 5, 5);
      ctx.fillStyle = f.self.color;
      ctx.fillRect(px(x) - 1, pz(z) - 1, 3, 3);
    }
  }

  private diamond(cx: number, cy: number, r: number): void {
    for (let dy = -r; dy <= r; dy++) {
      const w = r - Math.abs(dy);
      this.ctx.fillRect(cx - w, cy + dy, 2 * w + 1, 1);
    }
  }

  /** the floor plan: floor dim, its edge (the walls) bright, furniture as darker blocks */
  private drawBase(level: LiftLevel): void {
    this.level = level;
    const plan = PLANS[level];
    this.title.textContent = `map · ${plan.name}`;
    const w = Math.ceil((plan.bounds.maxX - plan.bounds.minX) * PX_PER_UNIT);
    const h = Math.ceil((plan.bounds.maxZ - plan.bounds.minZ) * PX_PER_UNIT);
    for (const c of [this.canvas, this.base]) {
      c.width = w;
      c.height = h;
    }
    this.canvas.style.width = `${w * SCALE}px`;
    this.canvas.style.height = `${h * SCALE}px`;
    const floor = new Uint8Array(w * h);
    const mark = (r: Rect, v: number): void => {
      const x0 = Math.max(0, Math.round((r.minX - plan.bounds.minX) * PX_PER_UNIT));
      const x1 = Math.min(w, Math.round((r.maxX - plan.bounds.minX) * PX_PER_UNIT));
      const z0 = Math.max(0, Math.round((r.minZ - plan.bounds.minZ) * PX_PER_UNIT));
      const z1 = Math.min(h, Math.round((r.maxZ - plan.bounds.minZ) * PX_PER_UNIT));
      for (let y = z0; y < z1; y++) for (let x = x0; x < x1; x++) if (floor[y * w + x] || v === 1) floor[y * w + x] = v;
    };
    for (const r of plan.floors) mark(r, 1);
    for (const r of plan.solids) mark(r, 2);
    const ctx = this.base.getContext("2d")!;
    const img = ctx.createImageData(w, h);
    const rgb = (s: string): number[] => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
    const bright = rgb(this.dim);
    const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : floor[y * w + x]);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = at(x, y);
        if (!v) continue;
        const edge = !at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1);
        const [r, g, b] = edge ? bright : v === 2 ? [38, 36, 32] : [62, 60, 54];
        const i = (y * w + x) * 4;
        img.data.set([r, g, b, 255], i);
      }
    }
    ctx.putImageData(img, 0, 0);
  }
}
