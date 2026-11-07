// Phone controls (ADR-075, user 2026-11-07): twin sticks and a few buttons.
//
//   left half of the screen   --- the move stick: it appears under the thumb
//                                 wherever it lands, so there's no spot to hunt for
//   right half                --- the aim stick: a light push only turns you,
//                                 past the outer ring the rifle fires; with a
//                                 grenade readied (or a turret being placed) how
//                                 far you push is how far it goes, and letting
//                                 go throws (places) it
//   one big context button    --- whatever E would do here, worded for this
//                                 thing ("pick up rifle", "call the lift"), grey
//                                 with the reason when it won't work; the ready
//                                 vote between waves too
//   grenade (with the count), drop (only with something in hand), menu
//
// Every button is a tap: nothing to hold but the sticks themselves.
// Turned on by a coarse pointer (a phone or tablet, or DevTools' device
// mode), by the first touch anywhere, or by ?touch.

const STYLE = `
.touch-layer { position: fixed; inset: 0; z-index: 4; display: none; touch-action: none; user-select: none; -webkit-user-select: none;
  -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
body.touch .touch-layer { display: block; }
.touch-stick { position: absolute; width: 0; height: 0; display: none; pointer-events: none; }
.touch-stick.on { display: block; }
.touch-stick .base, .touch-stick .rim, .touch-stick .knob { position: absolute; left: 0; top: 0; translate: -50% -50%; border-radius: 50%; }
.touch-stick .base { width: 112px; height: 112px; border: 2px solid rgba(242, 234, 214, 0.45); background: rgba(6, 8, 6, 0.28); }
.touch-stick .rim { width: 74px; height: 74px; border: 2px dashed rgba(242, 234, 214, 0.35); }
.touch-stick .knob { width: 46px; height: 46px; background: rgba(242, 234, 214, 0.75); box-shadow: 0 0 8px rgba(255, 220, 160, 0.35); }
.touch-stick.fire .knob { background: #ff7a5a; box-shadow: 0 0 12px rgba(255, 110, 80, 0.7); }
.touch-stick.fire .base { border-color: #ff7a5a; }
.touch-btn { position: absolute; display: none; align-items: center; justify-content: center; gap: 6px;
  color: var(--ui); font: var(--ui-font); letter-spacing: 0.06em; text-transform: uppercase; text-align: center;
  text-shadow: 0 0 6px var(--ui-glow), 0 1px 0 #000; -webkit-font-smoothing: none;
  border: 2px solid var(--ui); background: rgba(6, 8, 6, 0.7); padding: 6px 10px; touch-action: none; }
.touch-btn.on { display: flex; }
.touch-btn.off { color: var(--ui-dim); border-color: var(--ui-dim); }
.touch-btn.down { background: var(--ui); color: #0a0c0a; text-shadow: none; }
.touch-btn.use { right: 12px; bottom: 236px; min-width: 132px; max-width: 46vw; min-height: 52px; font-size: 22px; line-height: 1; }
.touch-btn.grenade { right: 12px; bottom: 174px; min-width: 60px; height: 46px; }
.touch-btn.drop { right: 84px; bottom: 174px; min-width: 60px; height: 46px; }
.touch-btn.menu { right: 10px; top: 10px; width: 44px; height: 40px; padding: 0; font-size: 26px; display: flex; }
`;

export interface Stick {
  /** -1..1 each, screen right / screen down, length at most 1 */
  x: number;
  y: number;
  /** a thumb is on it */
  active: boolean;
}

export interface TouchButtons {
  use: { label: string; enabled: boolean } | undefined;
  grenade: { label: string; cancel: boolean } | undefined;
  drop: { label: string } | undefined;
}

export interface TouchHandlers {
  use: () => void;
  grenade: () => void;
  drop: () => void;
  menu: () => void;
  /** the aim stick let go after a real push (aim.x/y still hold where it was) */
  aimReleased: () => void;
  /** any touch while there's nothing to steer (spectating): next teammate */
  tap: () => boolean;
}

/** a push this far out is "fire" (the dashed ring) */
export const FIRE_AT = 74 / 112;
const RADIUS = 56;
const DEAD = 0.18;

interface Live {
  id: number;
  ox: number;
  oy: number;
  el: HTMLDivElement;
  knob: HTMLDivElement;
  stick: Stick;
  /** the furthest it got this touch */
  peak: number;
}

export class TouchControls {
  enabled = false;
  readonly move: Stick = { x: 0, y: 0, active: false };
  readonly aim: Stick = { x: 0, y: 0, active: false };
  private readonly layer = document.createElement("div");
  private readonly sticks: Record<"move" | "aim", Live>;
  private readonly btns: Record<"use" | "grenade" | "drop" | "menu", HTMLDivElement>;
  private last = "";

  constructor(private readonly on: TouchHandlers) {
    const style = document.createElement("style");
    style.textContent = STYLE;
    document.head.appendChild(style);
    this.layer.className = "touch-layer";
    const stick = (s: Stick): Live => {
      const el = document.createElement("div");
      el.className = "touch-stick";
      el.innerHTML = '<div class="base"></div><div class="rim"></div><div class="knob"></div>';
      this.layer.appendChild(el);
      return { id: -1, ox: 0, oy: 0, el, knob: el.querySelector(".knob")!, stick: s, peak: 0 };
    };
    this.sticks = { move: stick(this.move), aim: stick(this.aim) };
    const btn = (cls: string, text: string, act: () => void): HTMLDivElement => {
      const el = document.createElement("div");
      el.className = `touch-btn ${cls}`;
      el.textContent = text;
      el.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        el.classList.add("down");
        act();
      });
      const up = () => el.classList.remove("down");
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      el.addEventListener("pointerleave", up);
      this.layer.appendChild(el);
      return el;
    };
    this.btns = {
      use: btn("use", "", () => on.use()),
      grenade: btn("grenade", "", () => on.grenade()),
      drop: btn("drop", "drop", () => on.drop()),
      menu: btn("menu", "≡", () => on.menu()),
    };
    this.layer.addEventListener("pointerdown", (e) => this.down(e));
    this.layer.addEventListener("pointermove", (e) => this.moveTo(e));
    this.layer.addEventListener("pointerup", (e) => this.up(e));
    this.layer.addEventListener("pointercancel", (e) => this.up(e, true));
    this.layer.addEventListener("contextmenu", (e) => e.preventDefault());
    document.body.appendChild(this.layer);
    window.addEventListener("blur", () => this.releaseAll());

    const coarse = window.matchMedia?.("(pointer: coarse)").matches;
    if (coarse || new URLSearchParams(location.search).has("touch")) this.enable();
    else window.addEventListener("touchstart", () => this.enable(), { once: true, passive: true });
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    document.body.classList.add("touch");
  }

  /** what the buttons say this frame */
  render(b: TouchButtons): void {
    if (!this.enabled) return;
    const key = JSON.stringify(b);
    if (key === this.last) return;
    this.last = key;
    const { use, grenade, drop } = this.btns;
    use.classList.toggle("on", !!b.use);
    use.classList.toggle("off", b.use?.enabled === false);
    use.textContent = b.use?.label ?? "";
    grenade.classList.toggle("on", !!b.grenade);
    grenade.textContent = b.grenade?.label ?? "";
    drop.classList.toggle("on", !!b.drop);
    drop.textContent = b.drop?.label ?? "";
  }

  private down(e: PointerEvent): void {
    e.preventDefault();
    if (this.on.tap()) return;
    const which = e.clientX < window.innerWidth / 2 ? "move" : "aim";
    const s = this.sticks[which];
    if (s.id !== -1) return;
    this.layer.setPointerCapture?.(e.pointerId);
    s.id = e.pointerId;
    s.ox = e.clientX;
    s.oy = e.clientY;
    s.peak = 0;
    s.el.style.transform = `translate(${s.ox}px, ${s.oy}px)`;
    s.el.classList.add("on");
    this.place(s, e.clientX, e.clientY);
  }

  private moveTo(e: PointerEvent): void {
    for (const s of Object.values(this.sticks)) if (s.id === e.pointerId) this.place(s, e.clientX, e.clientY);
  }

  private place(s: Live, x: number, y: number): void {
    let dx = (x - s.ox) / RADIUS;
    let dy = (y - s.oy) / RADIUS;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    const mag = Math.min(1, len);
    s.knob.style.transform = `translate(${dx * RADIUS}px, ${dy * RADIUS}px)`;
    s.el.classList.toggle("fire", s === this.sticks.aim && mag >= FIRE_AT && this.fireShown);
    s.peak = Math.max(s.peak, mag);
    // a thumb resting on the base without pushing: no direction yet
    s.stick.active = mag >= DEAD || s.stick.active;
    if (mag >= DEAD) {
      s.stick.x = dx;
      s.stick.y = dy;
    } else if (s === this.sticks.move) {
      s.stick.x = s.stick.y = 0;
    }
  }

  /** the fire colour only means something with the rifle up */
  fireShown = true;

  private up(e: PointerEvent, cancelled = false): void {
    for (const [name, s] of Object.entries(this.sticks)) {
      if (s.id !== e.pointerId) continue;
      const pushed = s.stick.active && s.peak >= DEAD;
      this.release(s);
      if (name === "aim" && pushed && !cancelled) this.on.aimReleased();
    }
  }

  private release(s: Live): void {
    s.id = -1;
    s.el.classList.remove("on", "fire");
    s.stick.active = false;
    if (s === this.sticks.move) s.stick.x = s.stick.y = 0;
  }

  releaseAll(): void {
    for (const s of Object.values(this.sticks)) this.release(s);
  }
}
