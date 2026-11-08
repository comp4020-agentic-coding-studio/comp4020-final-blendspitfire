import { pixelSvg } from "./logo.ts";

// The mission briefing on the ride down (user 2026-11-08, ADR-086): three
// black-and-white icon slides in the seal's style, drawn as line art and put
// on the game's pixel grid the same way (pixelSvg). Activate the reactor;
// expect hostiles and keep the reactor safe while it powers up; ride the
// freight lift up with the cargo (user: no stress on the number of waves;
// mention hostiles and the reactor's safety; in-world, a company work order,
// not a game talking to the player). Exact wording and icons are the agent's.

const W = 160;
const H = 120;
/** white strokes on transparent, like the seal before it's inked */
const svg = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="square" stroke-linejoin="miter">${body}</svg>`;

/** 1: the reactor core in its cage, a hand on the switch, power arcing off it */
const REACTOR = svg(`
  <rect x="52" y="22" width="56" height="76"/>
  <line x1="52" y1="42" x2="108" y2="42"/><line x1="52" y1="78" x2="108" y2="78"/>
  <circle cx="80" cy="60" r="11" fill="#fff"/>
  <path d="M30 34 l-10 -10 M24 60 h-14 M30 86 l-10 10 M130 34 l10 -10 M136 60 h14 M130 86 l10 10"/>
  <rect x="64" y="104" width="32" height="10" fill="#fff"/>
`);

/** 2: hostile organisms may be present: a crawler, big enough to read at the icon's size */
const HOLD = svg(`
  <ellipse cx="80" cy="62" rx="30" ry="20" fill="#fff"/>
  <circle cx="80" cy="36" r="10" fill="#fff"/>
  <path d="M56 50 l-20 -16 M52 64 h-26 M56 76 l-20 16 M104 50 l20 -16 M108 64 h26 M104 76 l20 16" stroke-width="7"/>
`);

/** 3: the cargo on the freight platform going up, and you with it */
const FREIGHT = svg(`
  <path d="M42 20 v88 M118 20 v88" stroke-width="3"/>
  <rect x="52" y="64" width="24" height="24" fill="#fff"/><rect x="80" y="56" width="28" height="32"/>
  <line x1="80" y1="72" x2="108" y2="72" stroke-width="3"/>
  <line x1="46" y1="92" x2="114" y2="92"/>
  <path d="M80 46 v-32 M68 26 l12 -12 l12 12"/>
`);

/** what HQ says over each card, typed out as it comes in */
const SLIDES: { art: string; line: string }[] = [
  { art: REACTOR, line: "work order B3: restore power to the facility reactor." },
  { art: HOLD, line: "hostile organisms may be present. the reactor must not be damaged during start-up." },
  { art: FREIGHT, line: "on completion, accompany the cargo to the surface by freight lift." },
];
/** the transmission's beats, as shares of the whole: the incoming flash, the three lines one after another, then the sign-off */
const OPEN = 0.12;
const CLOSE = 0.1;
/** each line is typed out over this share of its slot, then stays (user 2026-11-08: listed, not flashed past) */
const TYPE = 0.6;
/** fades go in visible steps, like the rest of the pixel UI */
const stepped = (a: number): number => Math.round(Math.max(0, Math.min(1, a)) * 8) / 8;

export class Briefing {
  private readonly el: HTMLDivElement;
  private readonly rows: { el: HTMLDivElement; text: HTMLSpanElement; caret: HTMLSpanElement; line: string }[] = [];
  private readonly incoming: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly bars: HTMLDivElement;
  private readonly sign: HTMLDivElement;

  /** `cell`: screen px per game pixel, so the icons sit on the same grid as everything else */
  constructor(cell: number) {
    this.el = document.createElement("div");
    this.el.className = "ui-brief";
    this.el.innerHTML =
      '<div class="frame">' +
      '<div class="head"><span class="live">●</span> hq › crew · assignment b3<span class="bars"><i></i><i></i><i></i><i></i></span></div>' +
      '<div class="incoming">▲ incoming transmission ▲</div>' +
      '<div class="body"></div>' +
      '<div class="sign">— end of transmission —</div>' +
      "</div>";
    this.incoming = this.el.querySelector(".incoming")!;
    this.body = this.el.querySelector(".body")!;
    this.bars = this.el.querySelector(".bars")!;
    this.sign = this.el.querySelector(".sign")!;
    const ink = getComputedStyle(document.documentElement).getPropertyValue("--ui").trim() || "#f2ead6";
    const width = Math.min(84, window.innerWidth * 0.18);
    SLIDES.forEach((s, i) => {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<div class="num">${i + 1}</div><div class="art"></div><div class="say"><span class="text"></span><span class="caret">█</span></div>`;
      row.querySelector(".art")!.append(pixelSvg(s.art, W, H, width, cell, ink));
      this.body.append(row);
      this.rows.push({ el: row, text: row.querySelector(".text")!, caret: row.querySelector(".caret")!, line: s.line });
    });
    document.body.appendChild(this.el);
  }

  /** show the transmission `k` of the way through (0..1), or hide it (undefined) */
  update(k: number | undefined): void {
    this.el.classList.toggle("open", k !== undefined);
    if (k === undefined) return;
    // the frame itself comes in and goes out in steps
    this.el.style.opacity = `${stepped(Math.min(k / 0.03, (1 - k) / 0.03))}`;
    // the call coming in: the banner blinks, the signal bars fill one by one
    const opening = k < OPEN;
    this.incoming.style.display = opening ? "flex" : "none";
    this.incoming.style.visibility = Math.floor(k * 40) % 2 === 0 ? "visible" : "hidden";
    const bars = Math.min(4, Math.floor((k / OPEN) * 5));
    this.bars.querySelectorAll("i").forEach((b, i) => b.classList.toggle("on", i < bars));
    this.body.style.display = opening ? "none" : "flex";
    this.sign.style.visibility = k > 1 - CLOSE ? "visible" : "hidden";
    // the lines, one after another, each typed out and then left there; rows not yet reached keep their space
    const n = this.rows.length;
    const u = ((k - OPEN) / (1 - OPEN - CLOSE)) * n;
    this.rows.forEach((r, i) => {
      const within = u - i;
      r.el.style.visibility = within > 0 ? "visible" : "hidden";
      const chars = Math.round(Math.max(0, Math.min(1, within / TYPE)) * r.line.length);
      r.text.textContent = r.line.slice(0, chars);
      // the caret only on the line being typed (or the last one, waiting)
      r.caret.style.display = within > 0 && (within < 1 || i === n - 1) ? "inline" : "none";
    });
  }
}
