import type { BoardMessage, CrewLine, Report } from "../../shared/protocol.ts";
import { CREDITS_ROLL_AT, CREDITS_ROLL_MS, SETTLE_PAGES_MS, THANKS_DIM_MS, THANKS_IN_MS, THANKS_MS, THANKS_OUT_MS, type EvacStage } from "../../shared/enemies.ts";
import { cutStamp, demoStamp, pixelLogo } from "./logo.ts";

// The settlement (ADR-060): played while the freight lift climbs, after
// Lethal Company's end-of-shift screens. Three pages on the server's clock,
// so everyone's on the same page at once: the crew's shift report (and its
// MVP), your payslip --- a big number eaten line by line down to a few dollars ---
// and where your name stands on the board. Then black, and the end credits
// (user 2026-11-03): the seal and its line, this run's crew, the top ten,
// the credits, the sounds' makers, and "thanks for playing". All the wording
// is the agent's (the payslip's rule and its stamp are the user's), except the credits'
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
  credit("doors", "sinny · yd") +
  credit("groans", "stephan (SoundBible)") +
  '<div class="cast solo dim">CC0 / public domain, via OpenGameArt</div></div>';

const money = (n: number): string => {
  // every figure to the cent, like a real payslip (user 2026-11-08: all with decimals or none)
  return `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const pct = (a: number, b: number): string => (b ? `${Math.round((a / b) * 100)}%` : "—");
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
/** fades go in visible steps, like the rest of the pixel UI */
const stepped = (a: number): number => Math.round(a * 8) / 8;
/** after the card, the garden fades in from black over this long */
const BACK_IN_MS = 1500;
/** the payslip page's beats, ms into it (SETTLE_PAGES_MS[1] = 16 s); the cuts come a second apart (user) */
const PAY_GROSS_AT = 600;
const PAY_LINES_AT = 1500;
const PAY_LINE_MS = 1000;
/** from the rule to the net pay: the beat before the reveal */
const PAY_PAUSE_MS = 2500;
const PAY_STAMP_AFTER_MS = 600;
/** the stamp's ink: the UI's "can't" red, as a rubber stamp */
const PAID_INK = "#ff5a48";
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The payslip (user 2026-11-08, ADR-079): the gross is the score times
 * PAY_PER_POINT, six cuts each take a share of whatever is left, then two
 * small flat fees (never below zero). Net pay stays proportional to the
 * score: 2000 points comes to about $222, 1000 to about $110.
 */
export const PAY_PER_POINT = 500;
const PAY_CUTS: [string, number][] = [
  ["income tax", 0.45],
  ["hazard pay clawback", 0.7],
  ["equipment depreciation", 0.8],
  ["company housing, B3 dorm", 0.85],
  ["cargo insurance excess", 0.9],
  ["administration fee", 0.5],
];
const PAY_FEES: [string, number][] = [
  ["freight lift fare", 15],
  ["morale programme", 9.99],
];
const cents = (n: number): number => Math.round(n * 100) / 100;
export function payslip(score: number): { gross: number; lines: [string, number][]; net: number } {
  const gross = Math.max(0, Math.round(score)) * PAY_PER_POINT;
  let left = gross;
  const lines: [string, number][] = [];
  for (const [what, share] of PAY_CUTS) {
    const cut = cents(left * share);
    lines.push([`${what} ${Math.round(share * 100)}%`, -cut]);
    left = cents(left - cut);
  }
  for (const [what, fee] of PAY_FEES) {
    const cut = Math.min(left, fee);
    lines.push([what, -cut]);
    left = cents(left - cut);
  }
  return { gross, lines, net: left };
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
  /** the site the shift was in (SITE-XXXX), on the shift report and the payslip's contract number */
  private site = "";
  /** the screen was held black by the ending (thanks/done): fade back in when it lets go */
  private wasBlack = false;
  private backAt = 0;
  private readonly cell: number;
  /** the PAID stamp is down on this page already (so its sound plays once) */
  private stamped = false;
  /** called the moment the PAID stamp lands (main.ts plays its thud) */
  onStamp?: () => void;

  /** `cell`: how many screen px one of the game's pixels is, so the seal sits on the same grid */
  constructor(cell: number) {
    this.cell = cell;
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
  set(report: Attempt | undefined, board: BoardMessage | undefined, me: string, site = this.site): void {
    this.site = site;
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
      this.stamped = false;
      if (st.page === 1) this.el.querySelector(".paid")!.append(cutStamp("PAID", this.cell, PAID_INK));
    }
    const rows = this.el.querySelectorAll<HTMLElement>(".row");
    const total = this.el.querySelector<HTMLElement>(".total");
    if (st.page === 1) {
      // the payslip on its own clock (user 2026-11-08): the gross, a cut a second, the
      // rule, a pause, then the net and the stamp slamming down on it
      const t = st.k * SETTLE_PAGES_MS[1];
      this.el.querySelector(".gross")!.classList.toggle("in", t >= PAY_GROSS_AT);
      rows.forEach((r, i) => r.classList.toggle("in", t >= PAY_LINES_AT + i * PAY_LINE_MS));
      const ruleAt = PAY_LINES_AT + rows.length * PAY_LINE_MS;
      this.el.querySelector(".rule")!.classList.toggle("in", t >= ruleAt);
      total!.classList.toggle("in", t >= ruleAt + PAY_PAUSE_MS);
      const stamp = t >= ruleAt + PAY_PAUSE_MS + PAY_STAMP_AFTER_MS;
      this.el.classList.toggle("stamped", stamp);
      if (stamp && !this.stamped) this.onStamp?.();
      this.stamped = stamp;
    } else {
      // lines come in one by one through the first part of a page
      const shown = Math.floor(st.k * (SETTLE_PAGES_MS[st.page] / 1000) * 2.2);
      rows.forEach((r, i) => r.classList.toggle("in", i < shown));
      if (total) total.classList.toggle("in", shown > rows.length);
    }
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
        `<div class="title">shift report</div><div class="sub">reactor stabilised · ${this.report?.waves ?? 0} waves held${this.site ? ` · ${esc(this.site)}` : ""}</div>` +
        '<div class="head"><span class="name">crew</span><span>kills</span><span>acc.</span><span>wounds</span><span class="num">score</span></div>' +
        (rows || '<div class="row in">nobody aboard</div>')
      );
    }
    if (page === 1) {
      const me = crew.find((c) => c.name === this.me);
      const { gross, lines, net } = payslip(me?.score ?? 0);
      const rows = lines
        .map(([what, v]) => `<div class="row"><span class="name">${esc(what)}</span><span class="num minus">${money(v)}</span></div>`)
        .join("");
      return (
        `<div class="title">payslip</div><div class="sub">${esc(this.me || "crew member")} · contract B3-${esc(this.site.replace(/^SITE-/, "") || "000")} · ${me?.score ?? 0} pts</div>` +
        `<div class="gross"><span class="name">gross pay</span><span class="num">${money(gross)}</span></div>` +
        rows +
        `<div class="rule"></div>` +
        `<div class="total"><span class="name">net pay</span><span class="num">${money(net)}</span><span class="paid"></span></div>`
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
