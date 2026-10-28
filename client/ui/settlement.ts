import type { BoardMessage, CrewLine, Report } from "../../shared/protocol.ts";
import { SETTLE_PAGES_MS, type EvacStage } from "../../shared/enemies.ts";

// The settlement (ADR-060): played while the freight lift climbs, after
// Lethal Company's end-of-shift screens. Three pages on the server's clock,
// so everyone's on the same page at once: the crew's shift report (and its
// MVP), your payslip --- a big number eaten line by line down to $20 ---
// and where your name stands on the board. Then black, and a thanks card.
// All the wording and every number on the payslip are the agent's.

type Attempt = Extract<Report, { type: "attempt" }>;

const money = (n: number): string => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const pct = (a: number, b: number): string => (b ? `${Math.round((a / b) * 100)}%` : "—");
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
  private page = -1;
  private report?: Attempt;
  private board?: BoardMessage;
  private me = "";

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "ui-settle";
    document.body.appendChild(this.el);
    this.thanks = document.createElement("div");
    this.thanks.className = "ui-thanks";
    this.thanks.innerHTML =
      '<div class="logo">COMMONS</div><div class="sub">[ logo placeholder ]</div>' +
      '<div class="line">the reactor holds. for now.</div><div class="line big">thanks for playing</div>';
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
    this.el.classList.toggle("open", rising);
    this.thanks.classList.toggle("open", st?.stage === "thanks");
    if (st?.stage === "thanks") {
      this.page = -1;
      return 1;
    }
    if (!rising) {
      this.page = -1;
      return 0;
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
    return st.fade;
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
    const top = (this.board?.top ?? []).slice(0, 5);
    const mine = crew
      .map(
        (c) =>
          `<div class="row${c.name === this.me ? " me" : ""}"><span class="name">${esc(c.name)}</span><span class="num">${c.rank ? `#${c.rank}` : "unranked"}${c.best ? ' <b class="tag">new best</b>' : ""}</span></div>`,
      )
      .join("");
    const board = top
      .map((p, i) => `<div class="row${p.name === this.me ? " me" : ""}"><span>${i + 1}</span><span class="name">${esc(p.name)}</span><span class="num">${p.score}</span></div>`)
      .join("");
    return (
      '<div class="title">standings</div><div class="sub">your crew on the board</div>' +
      mine +
      '<div class="title small">high scores</div>' +
      (board || '<div class="row">nobody yet</div>')
    );
  }
}
