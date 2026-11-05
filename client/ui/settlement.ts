import type { BoardMessage, CrewLine, Report } from "../../shared/protocol.ts";
import { CREDITS_ROLL_AT, CREDITS_ROLL_MS, SETTLE_PAGES_MS, THANKS_DIM_MS, THANKS_IN_MS, THANKS_MS, THANKS_OUT_MS, type EvacStage } from "../../shared/enemies.ts";
import { demoStamp, pixelLogo } from "./logo.ts";

// The settlement (ADR-060): played while the freight lift climbs, after
// Lethal Company's end-of-shift screens. Three pages on the server's clock,
// so everyone's on the same page at once: the crew's shift report (and its
// MVP), your payslip --- a big number eaten line by line down to $20 ---
// and where your name stands on the board. Then black, and the end credits
// (user 2026-11-03): the seal and its line, this run's crew, the top ten,
// the credits, the sounds' makers, and "thanks for playing". All the wording
// and every number on the payslip are the agent's, except the credits'
// sections and first line and who the credits thank (the user's).

type Attempt = Extract<Report, { type: "attempt" }>;

/**
 * The credits proper (user 2026-11-05: their name and uid, the model, the
 * course's lecturer and their tutor, and everyone who played it and said
 * what to fix; layout and wording the agent's, approved by the user).
 */
const credit = (role: string, who: string, me = false): string =>
  `<div class="cast credit${me ? " me" : ""}"><span class="role">${role}</span><span class="who">${who}</span></div>`;
const CREDITS =
  '<div class="card"><div class="head">credits</div>' +
  credit("made by", "Eric Xu · u7643101", true) +
  credit("built with", "Claude Opus 5.5 (Anthropic)") +
  credit("lecturer", "Ben Swift") +
  credit("tutor", "Tom Griffiths") +
  '<div class="cast solo dim">COMP4020 Agentic Coding Studio · ANU</div>' +
  '<div class="line thanks-all">and everyone who played this<br>and told me what to fix — thank you.</div></div>';
/** the recorded sounds' makers (all CC0 / public domain; public/sfx/CREDITS.md has the details) */
const SOUND_CREDITS =
  '<div class="card"><div class="head">sounds</div>' +
  credit("guns", "The Free Firearm Sound Library") +
  credit("blasts", "rubberduck · Kenney") +
  credit("creatures", "rubberduck · EZduzziteh · Spring Spring") +
  credit("machines", "qubodup · OpenGameArt") +
  credit("groans", "stephan (SoundBible)") +
  '<div class="cast solo dim">CC0 / public domain, via OpenGameArt</div></div>';

const money = (n: number): string => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const pct = (a: number, b: number): string => (b ? `${Math.round((a / b) * 100)}%` : "—");
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
/** fades go in visible steps, like the rest of the pixel UI */
const stepped = (a: number): number => Math.round(a * 8) / 8;
/** after the card, the garden fades in from black over this long */
const BACK_IN_MS = 1500;
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** the deadpan payslip: what the corp promised, and what it took back, for this crew member */
export function payslip(me: CrewLine | undefined, crewSize: number): [string, number][] {
  const shots = me?.shots ?? 0;
  const wounds = me?.wounds ?? 0;
  const turrets = me?.turrets ?? 0;
  const gross = 480_000;
  const lines: [string, number][] = [
    ["base pay, reactor stabilisation", gross],
    ["hazard pay clawback (reactor now rated safe)", -96_000],
    [`ammunition, ${shots} round${shots === 1 ? "" : "s"} @ $35`, -shots * 35],
    [`medical, ${wounds} wound${wounds === 1 ? "" : "s"} @ $1,200`, -wounds * 1200],
    ...(turrets ? ([[`sentry lease, ${turrets} unit${turrets === 1 ? "" : "s"}`, -turrets * 8000]] as [string, number][]) : []),
    ["rifle wear and tear", -18_400],
    [`freight lift fare (shared ${crewSize} ways)`, -Math.round(37_500 / Math.max(1, crewSize))],
    ["cargo insurance excess", -73_000],
    ["company housing, B3 dormitory", -41_250],
    ["morale programme", -9_999],
  ];
  const before = lines.reduce((a, [, v]) => a + v, 0);
  // tax on whatever's left, then the adjustment that makes it come out right
  const tax = -Math.round(Math.max(0, before) * 0.37);
  lines.push(["income tax, 37%", tax]);
  const left = before + tax;
  lines.push(["administrative rounding", 20 - left]);
  return lines;
}

export class Settlement {
  private readonly el: HTMLDivElement;
  private readonly thanks: HTMLDivElement;
  /** the part of the credits that scrolls (the first card's in it, at the top) */
  private readonly roll: HTMLDivElement;
  /** the credits are filled in once per ending (crew and board as they stood) */
  private rolled = false;
  private page = -1;
  private report?: Attempt;
  private board?: BoardMessage;
  private me = "";
  /** the screen was held black by the ending (thanks/done): fade back in when it lets go */
  private wasBlack = false;
  private backAt = 0;

  /** `cell`: how many screen px one of the game's pixels is, so the seal sits on the same grid */
  constructor(cell: number) {
    this.el = document.createElement("div");
    this.el.className = "ui-settle";
    document.body.appendChild(this.el);
    this.thanks = document.createElement("div");
    this.thanks.className = "ui-thanks";
    this.thanks.innerHTML =
      '<div class="roll"><div class="card first"><div class="logo"></div><div class="sub">asset nexus unlimited</div><div class="stamp"></div>' +
      '<div class="line">assets recovered. thank you for your service.</div></div><div class="more"></div>' +
      '<div class="card last"><div class="line big">thanks for playing</div></div></div>';
    const ink = getComputedStyle(document.documentElement).getPropertyValue("--ui").trim() || "#f2ead6";
    this.thanks.querySelector(".logo")!.append(pixelLogo(Math.min(440, window.innerWidth * 0.8), cell, ink));
    this.thanks.querySelector(".stamp")!.append(demoStamp(cell, ink));
    this.roll = this.thanks.querySelector(".roll")!;
    document.body.appendChild(this.thanks);
  }

  /** the won attempt's report (the crew lines), the latest board, and our own name, as they arrive */
  set(report: Attempt | undefined, board: BoardMessage | undefined, me: string): void {
    if (report) this.report = report;
    if (board) this.board = board;
    this.me = me;
  }

  /** show whatever the evacuation's stage calls for; returns how black the screen should be, 0..1 */
  update(st: EvacStage | undefined): number {
    const rising = st?.stage === "rising";
    const thanks = st?.stage === "thanks";
    this.el.classList.toggle("open", rising);
    this.thanks.classList.toggle("open", thanks);
    if (thanks) {
      // the first card fades in over the shaft, then the scene behind it goes dark;
      // it holds, the roll scrolls up to "thanks for playing", which holds and fades out on black
      const ms = st.ms;
      if (!this.rolled) {
        this.rolled = true;
        this.thanks.querySelector(".more")!.innerHTML = this.credits();
      }
      const a = Math.min(clamp01(ms / THANKS_IN_MS), clamp01((THANKS_MS - ms) / THANKS_OUT_MS));
      this.thanks.style.opacity = `${stepped(a)}`;
      this.scroll(clamp01((ms - CREDITS_ROLL_AT) / CREDITS_ROLL_MS));
      this.page = -1;
      this.wasBlack = true;
      this.backAt = 0;
      return clamp01((ms - THANKS_IN_MS) / THANKS_DIM_MS);
    }
    if (st?.stage === "done") {
      // the server's about to bring everyone up: stay black till it does
      this.wasBlack = true;
      this.backAt = 0;
      return 1;
    }
    this.rolled = false;
    if (!rising) {
      // just brought up after the card: the garden fades in from black
      if (this.page === -1 && this.wasBlack) {
        this.wasBlack = false;
        this.backAt = performance.now();
      }
      this.page = -1;
      if (!this.backAt) return 0;
      const back = 1 - (performance.now() - this.backAt) / BACK_IN_MS;
      if (back <= 0) this.backAt = 0;
      return Math.max(0, back);
    }
    if (st.page !== this.page) {
      this.page = st.page;
      this.el.innerHTML = this.render(st.page);
    }
    // lines come in one by one through the first part of a page
    const rows = this.el.querySelectorAll<HTMLElement>(".row");
    const shown = Math.floor(st.k * (SETTLE_PAGES_MS[st.page] / 1000) * 2.2);
    rows.forEach((r, i) => r.classList.toggle("in", i < shown));
    const total = this.el.querySelector<HTMLElement>(".total");
    if (total) total.classList.toggle("in", shown > rows.length);
    // the last page fades out on its own: the shaft stays lit for the card to come in over
    this.el.style.opacity = `${1 - st.fade}`;
    return 0;
  }

  private crew(): CrewLine[] {
    return [...(this.report?.crew ?? [])].sort((a, b) => b.score - a.score);
  }

  private render(page: number): string {
    const crew = this.crew();
    if (page === 0) {
      const mvp = crew[0];
      const rows = crew
        .map(
          (c) =>
            `<div class="row${c.name === this.me ? " me" : ""}"><span class="name">${esc(c.name)}${c === mvp && c.score > 0 ? ' <b class="tag">MVP</b>' : ""}${c.out ? " †" : ""}</span>` +
            `<span>${c.kills}</span><span>${pct(c.hits, c.shots)}</span><span>${c.wounds}</span><span class="num">${c.score}</span></div>`,
        )
        .join("");
      return (
        `<div class="title">shift report</div><div class="sub">reactor stabilised · ${this.report?.waves ?? 0} waves held · attempt ${this.report?.attempt ?? 0}</div>` +
        '<div class="head"><span class="name">crew</span><span>kills</span><span>acc.</span><span>wounds</span><span class="num">score</span></div>' +
        (rows || '<div class="row in">nobody aboard</div>')
      );
    }
    if (page === 1) {
      const me = crew.find((c) => c.name === this.me);
      const lines = payslip(me, crew.length);
      const rows = lines
        .map(([what, v]) => `<div class="row"><span class="name">${esc(what)}</span><span class="num${v < 0 ? " minus" : ""}">${money(v)}</span></div>`)
        .join("");
      const net = lines.reduce((a, [, v]) => a + v, 0);
      return (
        `<div class="title">payslip</div><div class="sub">${esc(this.me || "crew member")} · contract B3-${String(this.report?.attempt ?? 0).padStart(3, "0")}</div>` +
        rows +
        `<div class="total"><span class="name">net pay</span><span class="num">${money(net)}</span></div>`
      );
    }
    const mine = crew
      .map(
        (c) =>
          `<div class="row${c.name === this.me ? " me" : ""}"><span class="name">${esc(c.name)}</span><span class="num">${c.rank ? `#${c.rank}` : "unranked"}${c.best ? ' <b class="tag">new best</b>' : ""}</span></div>`,
      )
      .join("");
    return '<div class="title">standings</div><div class="sub">your crew on the board</div>' + mine;
  }

  /**
   * Scroll the roll: `k` 0 = the first card centred on screen, 1 = "thanks
   * for playing" centred. Whole pixels of the game's grid, so it doesn't
   * shimmer.
   */
  private scroll(k: number): void {
    const first = this.roll.querySelector<HTMLElement>(".first")!;
    const last = this.roll.querySelector<HTMLElement>(".last")!;
    const mid = (el: HTMLElement): number => el.offsetTop + el.offsetHeight / 2;
    const from = window.innerHeight / 2 - mid(first);
    const to = window.innerHeight / 2 - mid(last);
    // ease in and out of the hold at each end, but only a little: a full
    // smoothstep runs the middle at 1.5x the average speed, too fast to read
    // (user 2026-11-05); this blend peaks at ~1.15x
    const e = 0.7 * k + 0.3 * k * k * (3 - 2 * k);
    this.roll.style.transform = `translateY(${Math.round(from + (to - from) * e)}px)`;
  }

  /** the middle of the roll: this run's crew, the board's top ten, and the credits */
  private credits(): string {
    const crew = this.crew()
      .map((c) => `<div class="cast"><span class="role">${c.out ? "fallen" : "crew"}</span><span class="who">${esc(c.name)}</span></div>`)
      .join("");
    const top = (this.board?.top ?? [])
      .slice(0, 10)
      .map((p, i) => `<div class="cast${p.name === this.me ? " me" : ""}"><span class="role">${i + 1}</span><span class="who">${esc(p.name)}</span><span class="pts">${p.score}</span></div>`)
      .join("");
    return (
      `<div class="card"><div class="head">the crew</div>${crew || '<div class="cast solo"><span class="who">nobody aboard</span></div>'}</div>` +
      `<div class="card"><div class="head">high scores</div>${top || '<div class="cast solo"><span class="who">nobody yet</span></div>'}</div>` +
      CREDITS +
      SOUND_CREDITS
    );
  }
}
