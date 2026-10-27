import * as THREE from "three";

// Snap markers: where to go next, the way Left 4 Dead points at things. A
// marker is a terminal tag pinned to a spot in the world (the lift, the
// reactor, the comms set). While the spot is on screen the tag hangs over
// it; once it's off screen the tag slides to the edge of the screen on the
// line toward it, turns into an arrow pointing out at it, and says how far.
//
// Two strengths. Faint: small and dim, always there so you can find the
// thing if you look. Loud: full size, bright, and pulsing, for when the
// game wants you to go there now. Same look as the prompts
// (client/ui/prompts.ts): VT323, phosphor white, square pixels.
//
// Every marker in one frame is passed to render(); anything not passed
// fades out. Ids keep an element tied to the same thing across frames.

export interface Marker {
  id: string;
  /** the point in the world it marks */
  at: THREE.Vector3;
  label: string;
  /** a second, smaller line (a countdown, a reason) */
  detail?: string;
  /** loud: full size, bright and pulsing; otherwise faint */
  loud?: boolean;
  /** where the reader is, for the distance shown when it's off screen */
  from?: { x: number; z: number };
}

const STYLE = `
.mk-layer { position: fixed; inset: 0; pointer-events: none; overflow: hidden; z-index: 4; }
.mk { position: absolute; left: 0; top: 0; will-change: transform; opacity: 0; transition: opacity 0.3s steps(4); }
.mk.on { opacity: 0.5; }
.mk.on.loud { opacity: 1; }
.mk-body { position: absolute; transform: translate(-50%, -100%); display: flex; flex-direction: column; align-items: center; }
.mk-tag { display: flex; flex-direction: column; align-items: center; white-space: nowrap; padding: 1px 6px;
  color: var(--ui); font: 400 16px/1 "VT323", ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: 0.08em;
  text-transform: uppercase; text-shadow: 0 0 6px var(--ui-glow), 0 1px 0 #000; -webkit-font-smoothing: none;
  background: rgba(6, 8, 6, 0.55); border: 2px solid var(--ui-dim); }
.mk-detail { font-size: 14px; opacity: 0.8; }
.mk-pin { width: 8px; height: 8px; margin-top: 4px; background: var(--ui-dim);
  clip-path: polygon(0 0, 100% 0, 100% 50%, 75% 50%, 75% 75%, 50% 75%, 50% 100%, 50% 100%, 50% 75%, 25% 75%, 25% 50%, 0 50%); }
.mk.loud .mk-tag { font-size: 22px; padding: 2px 10px; border-color: var(--ui); animation: mk-pulse 1.1s steps(2) infinite; }
.mk.loud .mk-detail { font-size: 18px; }
.mk.loud .mk-pin { width: 12px; height: 12px; background: var(--ui); animation: mk-bob 0.9s steps(3) infinite; }
.mk-arrow { position: absolute; left: -9px; top: -9px; width: 18px; height: 18px; display: none; background: var(--ui);
  clip-path: polygon(0 20%, 40% 20%, 40% 0, 100% 50%, 40% 100%, 40% 80%, 0 80%); filter: drop-shadow(0 0 3px var(--ui-glow)); }
.mk.loud .mk-arrow { width: 26px; height: 26px; left: -13px; top: -13px; animation: mk-pulse 1.1s steps(2) infinite; }
.mk.edge .mk-arrow { display: block; }
.mk.edge .mk-pin { display: none; }
.mk.edge .mk-body { transform: translate(var(--tx), var(--ty)); }
@keyframes mk-pulse { 0%, 100% { box-shadow: 0 0 0 transparent; filter: brightness(1); } 50% { box-shadow: 0 0 10px var(--ui-glow); filter: brightness(1.35); } }
@keyframes mk-bob { 0%, 100% { translate: 0 0; } 50% { translate: 0 3px; } }
`;

interface Live {
  el: HTMLDivElement;
  arrow: HTMLDivElement;
  label: HTMLSpanElement;
  detail: HTMLSpanElement;
  goneAt: number;
  last: string;
}

/** how far in from the screen edge an off-screen marker sits, px */
const EDGE = 46;

export class Markers {
  private readonly layer = document.createElement("div");
  private readonly live = new Map<string, Live>();
  private readonly v = new THREE.Vector3();

  constructor() {
    const style = document.createElement("style");
    style.textContent = STYLE;
    document.head.appendChild(style);
    this.layer.className = "mk-layer";
    document.body.appendChild(this.layer);
  }

  private make(id: string): Live {
    const el = document.createElement("div");
    el.className = "mk";
    el.innerHTML = '<div class="mk-arrow"></div><div class="mk-body"><div class="mk-tag"><span class="mk-label"></span><span class="mk-detail"></span></div><div class="mk-pin"></div></div>';
    this.layer.appendChild(el);
    const live: Live = {
      el,
      arrow: el.querySelector(".mk-arrow")!,
      label: el.querySelector(".mk-label")!,
      detail: el.querySelector(".mk-detail")!,
      goneAt: 0,
      last: "",
    };
    this.live.set(id, live);
    requestAnimationFrame(() => {
      if (live.goneAt === 0) el.classList.add("on");
    });
    return live;
  }

  /** `top`: how far down the top edge sits, px (below a panel along the top of the screen) */
  render(markers: Marker[], camera: THREE.Camera, top = EDGE): void {
    const now = performance.now();
    const seen = new Set<string>();
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const m of markers) {
      seen.add(m.id);
      let live = this.live.get(m.id);
      if (!live) live = this.make(m.id);
      else if (live.goneAt !== 0) {
        live.goneAt = 0;
        live.el.classList.add("on");
      }
      this.v.copy(m.at).project(camera);
      let x = (this.v.x * 0.5 + 0.5) * w;
      let y = (-this.v.y * 0.5 + 0.5) * h;
      const edge = x < EDGE || x > w - EDGE || y < top || y > h - EDGE;
      let detail = m.detail ?? "";
      if (edge) {
        // slide along the line from the screen's centre to the spot until it meets the inset edge
        const cx = w / 2;
        const cy = (top + h - EDGE) / 2;
        const dx = x - cx;
        const dy = y - cy;
        const s = Math.min(Math.abs((cx - EDGE) / (dx || 1e-6)), Math.abs((cy - top) / (dy || 1e-6)));
        x = cx + dx * s;
        y = cy + dy * s;
        const angle = Math.atan2(dy, dx);
        live.arrow.style.transform = `rotate(${angle.toFixed(3)}rad)`;
        // the tag sits on the inward side of the arrow so it never leaves the screen
        const len = m.loud ? 30 : 22;
        live.el.style.setProperty("--tx", `calc(-50% - ${(Math.cos(angle) * len).toFixed(1)}px - ${(Math.cos(angle) * 50).toFixed(1)}%)`);
        live.el.style.setProperty("--ty", `calc(-50% - ${(Math.sin(angle) * len).toFixed(1)}px - ${(Math.sin(angle) * 50).toFixed(1)}%)`);
        if (m.from) {
          const metres = Math.round(Math.hypot(m.at.x - m.from.x, m.at.z - m.from.z));
          detail = detail ? `${detail} · ${metres}m` : `${metres}m`;
        }
      }
      const content = `${m.label}|${detail}|${!!m.loud}|${edge}`;
      if (content !== live.last) {
        live.last = content;
        live.label.textContent = m.label;
        live.detail.textContent = detail;
        live.detail.style.display = detail ? "block" : "none";
        live.el.classList.toggle("loud", !!m.loud);
        live.el.classList.toggle("edge", edge);
      }
      live.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
    for (const [id, live] of this.live) {
      if (seen.has(id)) continue;
      if (live.goneAt === 0) {
        live.goneAt = now;
        live.el.classList.remove("on");
      } else if (now - live.goneAt > 400) {
        live.el.remove();
        this.live.delete(id);
      }
    }
  }
}
