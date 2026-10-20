import * as THREE from "three";

// Floating prompts: thin white line-work that grows out of the thing you can
// act on and stays pinned to it. Each prompt is anchored to a point in the
// world, projected to the screen every frame, and drawn up and to the left of
// that point: a dot on the anchor, a leader line, and a bracketed tag with
// the key and what it does. Grey means "not now", with the reason as the
// label. A prompt that goes away retracts (tag first, then the line) rather
// than vanishing, and one that comes back reuses its element mid-animation.
//
// Every prompt in one frame is passed to render(); anything not passed is
// retracted. Ids keep an element tied to the same thing across frames.

export interface Prompt {
  id: string;
  /** the point in the world the prompt hangs off */
  at: THREE.Vector3;
  /** the key cap, e.g. "E"; absent for a status tag with nothing to press */
  key?: string;
  label: string;
  /** false = shown grey: the action exists but can't be done right now (label says why) */
  enabled?: boolean;
  /** a second, smaller line under the label */
  detail?: string;
}

// The leader is a staircase of square pixel-steps rather than a smooth
// line, the dot a square, and the tag a terminal readout: the same look as
// the rest of the UI (public/index.html), drawn in steps like a sprite.
const STYLE = `
.pr-layer { position: fixed; inset: 0; pointer-events: none; overflow: hidden; z-index: 5; }
.pr { position: absolute; left: 0; top: 0; will-change: transform; }
.pr-dot { position: absolute; left: -4px; top: -4px; width: 8px; height: 8px; background: var(--ui);
  box-shadow: 0 0 6px var(--ui-glow); transform: scale(0); transition: transform 0.18s steps(3); }
.pr-line { position: absolute; right: 0; bottom: 0; width: 28px; height: 28px;
  background:
    linear-gradient(var(--ui), var(--ui)) 0 0 / 4px 4px,
    linear-gradient(var(--ui), var(--ui)) 6px 6px / 4px 4px,
    linear-gradient(var(--ui), var(--ui)) 12px 12px / 4px 4px,
    linear-gradient(var(--ui), var(--ui)) 18px 18px / 4px 4px,
    linear-gradient(var(--ui), var(--ui)) 24px 24px / 4px 4px;
  background-repeat: no-repeat; clip-path: inset(100% 0 0 100%); transition: clip-path 0.16s steps(5) 0.06s; }
.pr-tag { position: absolute; right: 28px; bottom: 28px; display: flex; align-items: center; gap: 8px; white-space: nowrap;
  padding: 3px 10px 3px 4px; color: var(--ui); font: 400 20px/1 "VT323", ui-monospace, "SF Mono", Menlo, monospace;
  letter-spacing: 0.06em; text-transform: uppercase; text-shadow: 0 0 6px var(--ui-glow), 0 1px 0 #000;
  background: rgba(6, 8, 6, 0.7); border: 2px solid var(--ui); -webkit-font-smoothing: none;
  clip-path: inset(0 0 0 100%); transition: clip-path 0.2s steps(6) 0.14s; animation: pr-float 3.2s steps(4) infinite; }
.pr-key { min-width: 20px; height: 20px; display: grid; place-items: center; background: var(--ui); color: #0a0c0a;
  text-shadow: none; font-size: 18px; letter-spacing: 0; padding: 0 3px; }
.pr-text { display: flex; flex-direction: column; gap: 0; }
.pr-detail { font-size: 16px; opacity: 0.75; letter-spacing: 0.05em; }
.pr.on .pr-dot { transform: scale(1); }
.pr.on .pr-line { clip-path: inset(0 0 0 0); }
.pr.on .pr-tag { clip-path: inset(0 0 0 0); }
/* going away: the tag folds first, then the line, then the dot */
.pr:not(.on) .pr-tag { transition-delay: 0s; transition-duration: 0.12s; }
.pr:not(.on) .pr-line { transition-delay: 0.08s; }
.pr:not(.on) .pr-dot { transition-delay: 0.16s; }
.pr.off { --ui: var(--ui-dim); }
.pr.nope .pr-tag { animation: pr-nope 0.3s linear, pr-float 3.2s ease-in-out infinite; }
@keyframes pr-float { 0%, 100% { translate: 0 0; } 50% { translate: 0 -2px; } }
@keyframes pr-nope { 0%, 100% { margin-right: 0; } 25% { margin-right: 6px; } 75% { margin-right: -6px; } }
`;

interface Live {
  el: HTMLDivElement;
  key: HTMLSpanElement;
  label: HTMLSpanElement;
  detail: HTMLSpanElement;
  /** when it was retracted (for removal once the animation's done), or 0 while shown */
  goneAt: number;
  last: string;
}

export class Prompts {
  private readonly layer = document.createElement("div");
  private readonly live = new Map<string, Live>();
  private readonly v = new THREE.Vector3();

  constructor() {
    const style = document.createElement("style");
    style.textContent = STYLE;
    document.head.appendChild(style);
    this.layer.className = "pr-layer";
    document.body.appendChild(this.layer);
  }

  private make(id: string): Live {
    const el = document.createElement("div");
    el.className = "pr";
    el.innerHTML = '<div class="pr-dot"></div><div class="pr-line"></div><div class="pr-tag"><span class="pr-key"></span><span class="pr-text"><span class="pr-label"></span><span class="pr-detail"></span></span></div>';
    this.layer.appendChild(el);
    const live: Live = {
      el,
      key: el.querySelector(".pr-key")!,
      label: el.querySelector(".pr-label")!,
      detail: el.querySelector(".pr-detail")!,
      goneAt: 0,
      last: "",
    };
    this.live.set(id, live);
    // one frame in the DOM before "on", so the growing-out transition plays
    requestAnimationFrame(() => {
      if (live.goneAt === 0) el.classList.add("on");
    });
    return live;
  }

  /** a refused press: the prompt shakes */
  nope(id: string): void {
    const live = this.live.get(id);
    if (!live) return;
    live.el.classList.remove("nope");
    void live.el.offsetWidth;
    live.el.classList.add("nope");
  }

  render(prompts: Prompt[], camera: THREE.Camera): void {
    const now = performance.now();
    const seen = new Set<string>();
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const p of prompts) {
      seen.add(p.id);
      let live = this.live.get(p.id);
      if (!live) live = this.make(p.id);
      else if (live.goneAt !== 0) {
        live.goneAt = 0;
        live.el.classList.add("on");
      }
      const content = `${p.key ?? ""}|${p.label}|${p.detail ?? ""}|${p.enabled !== false}`;
      if (content !== live.last) {
        live.last = content;
        live.key.textContent = p.key ?? "";
        live.key.style.display = p.key ? "grid" : "none";
        live.label.textContent = p.label;
        live.detail.textContent = p.detail ?? "";
        live.detail.style.display = p.detail ? "block" : "none";
        live.el.classList.toggle("off", p.enabled === false);
      }
      this.v.copy(p.at).project(camera);
      const x = (this.v.x * 0.5 + 0.5) * w;
      const y = (-this.v.y * 0.5 + 0.5) * h;
      live.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
    for (const [id, live] of this.live) {
      if (seen.has(id)) continue;
      if (live.goneAt === 0) {
        live.goneAt = now;
        live.el.classList.remove("on");
      } else if (now - live.goneAt > 500) {
        live.el.remove();
        this.live.delete(id);
      }
    }
  }
}
