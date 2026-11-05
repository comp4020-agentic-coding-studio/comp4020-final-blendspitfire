import { NAME_MAX, ROOM_CLOSE, cleanName, type RoomInfo } from "../../shared/protocol.ts";
import { pixelLogo } from "./logo.ts";

// The title screen (ADR draft 2026-11-05): the seal, your name, and the
// sites (rooms) to join or a new one to make. Each site is a world of its
// own for up to four; one whose reactor's on can't be joined until it's
// over. Nothing behind it connects until a site's picked.

const NAME_KEY = "blendspitfire.name";
const LIST_EVERY_MS = 2000;

export interface Pick {
  /** the site to join (a new one is made on the server first) */
  room: string;
  /** the name to play under ("" = their codename) */
  name: string;
}

export class Title {
  readonly el: HTMLDivElement;
  private nameInput: HTMLInputElement;
  private listEl: HTMLDivElement;
  private whyEl: HTMLDivElement;
  private timer = 0;
  private busy = false;
  private onPick: (pick: Pick) => void;

  constructor(cell: number, onPick: (pick: Pick) => void) {
    this.onPick = onPick;
    this.el = document.createElement("div");
    this.el.className = "ui-title";
    this.el.innerHTML =
      '<div class="logo"></div>' +
      '<div class="field"><span class="dim">name</span>' +
      `<input maxlength="${NAME_MAX}" spellcheck="false" autocomplete="off" placeholder="codename" /></div>` +
      '<div class="dim small">1–12 letters or digits · blank = your codename</div>' +
      '<div class="head"><span>sites</span><span class="dim">crew</span></div>' +
      '<div class="list"></div>' +
      '<div class="why"></div>' +
      '<div class="buttons"><button class="quick">▶ quick join</button><button class="new">+ new site</button></div>';
    this.el.querySelector(".logo")!.appendChild(pixelLogo(300, cell, "#f2ead6"));
    this.nameInput = this.el.querySelector("input")!;
    this.listEl = this.el.querySelector(".list")!;
    this.whyEl = this.el.querySelector(".why")!;
    try {
      this.nameInput.value = localStorage.getItem(NAME_KEY) ?? "";
    } catch {
      // storage blocked: an empty box
    }
    this.nameInput.addEventListener("input", () => {
      this.nameInput.value = this.nameInput.value.toUpperCase();
    });
    // typing here mustn't walk anyone, or open anything
    this.nameInput.addEventListener("keydown", (e) => e.stopPropagation());
    this.el.querySelector(".new")!.addEventListener("click", () => void this.make());
    this.el.querySelector(".quick")!.addEventListener("click", () => void this.quick());
    this.listEl.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>(".row");
      if (row && !row.classList.contains("dim") && row.dataset.room) this.pick(row.dataset.room);
    });
    document.body.appendChild(this.el);
  }

  get isOpen(): boolean {
    return this.el.classList.contains("open");
  }

  /** show the title screen; `why` explains a site that turned someone away */
  open(why = ""): void {
    this.el.classList.add("open");
    this.busy = false;
    this.whyEl.textContent = why;
    void this.refresh();
    clearInterval(this.timer);
    this.timer = window.setInterval(() => void this.refresh(), LIST_EVERY_MS);
  }

  close(): void {
    this.el.classList.remove("open");
    clearInterval(this.timer);
  }

  /** the reason a socket was closed before it joined, in words (undefined: not one of ours) */
  static closeReason(code: number): string | undefined {
    if (code === ROOM_CLOSE.full) return "that site is full";
    if (code === ROOM_CLOSE.started) return "that site's reactor is on — wait for it to end";
    if (code === ROOM_CLOSE.gone) return "that site has closed";
    return undefined;
  }

  private async refresh(): Promise<void> {
    let rooms: RoomInfo[];
    try {
      rooms = (await (await fetch("/api/rooms", { cache: "no-store" })).json()) as RoomInfo[];
    } catch {
      this.listEl.innerHTML = '<div class="empty dim">can’t reach the server…</div>';
      return;
    }
    if (!this.isOpen) return;
    this.listEl.innerHTML = rooms.length
      ? rooms.map((r) => this.row(r)).join("")
      : '<div class="empty dim">no sites open — make one</div>';
  }

  private row(r: RoomInfo): string {
    const full = r.players >= r.max;
    const shut = r.started || full;
    const state = r.started ? `under way · wave ${r.wave}` : full ? "full" : "open";
    const names = r.names.map(esc).join(", ");
    return (
      `<div class="row${shut ? " dim" : ""}" data-room="${esc(r.id)}" title="${shut ? (r.started ? "reactor on: can't join until it's over" : "full") : "join"}">` +
      `<span class="id">${esc(r.id)}</span><span class="state">${state}</span>` +
      `<span class="crew">${r.players}/${r.max}</span>` +
      (names ? `<span class="names">${names}</span>` : "") +
      `</div>`
    );
  }

  /** the name as it'll be sent, remembered for next time; undefined if what's typed won't do */
  private name(): string | undefined {
    const raw = this.nameInput.value.trim();
    if (!raw) return "";
    const name = cleanName(raw);
    if (!name) {
      this.whyEl.textContent = "1 to 12 letters or digits";
      return undefined;
    }
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      // remembered for this tab only
    }
    return name;
  }

  /** join this site straight away (a shared link) */
  join(room: string): void {
    this.pick(room);
  }

  private pick(room: string): void {
    if (this.busy) return;
    const name = this.name();
    if (name === undefined) return;
    this.busy = true;
    this.whyEl.textContent = `joining ${room}…`;
    this.onPick({ room, name });
  }

  /**
   * Quick join (user 2026-11-05): the fullest site that still has room and
   * hasn't started (the server's own rule for a bare /ws), else a new one.
   * Picked here rather than by the server so the address bar still gets
   * the site's ?room= link.
   */
  private async quick(): Promise<void> {
    if (this.busy) return;
    if (this.name() === undefined) return;
    try {
      const rooms = (await (await fetch("/api/rooms", { cache: "no-store" })).json()) as RoomInfo[];
      const open = rooms.filter((r) => !r.started && r.players < r.max).sort((a, b) => b.players - a.players);
      if (open[0]) this.pick(open[0].id);
      else await this.make();
    } catch {
      this.whyEl.textContent = "can’t reach the server";
    }
  }

  private async make(): Promise<void> {
    if (this.busy) return;
    if (this.name() === undefined) return;
    try {
      const { id } = (await (await fetch("/api/rooms", { method: "POST" })).json()) as { id: string };
      this.pick(id);
    } catch {
      this.whyEl.textContent = "can’t reach the server";
    }
  }
}

const esc = (t: string): string => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Esc in a site (when nothing else is open): carry on, sound on/off, or
 * leave for the title screen. Leaving below mid-attempt is being out, and
 * it says so before you commit.
 */
export class PauseMenu {
  readonly el: HTMLDivElement;
  private warnEl: HTMLDivElement;
  private muteEl: HTMLButtonElement;

  constructor(handlers: { resume: () => void; mute: () => boolean; leave: () => void }) {
    this.el = document.createElement("div");
    this.el.className = "ui-pause";
    this.el.innerHTML =
      '<div class="title">paused</div>' +
      '<div class="dim site"></div>' +
      '<button class="resume">continue <span class="dim">esc</span></button>' +
      '<button class="mute"></button>' +
      '<button class="leave">leave site</button>' +
      '<div class="warn"></div>';
    this.warnEl = this.el.querySelector(".warn")!;
    this.muteEl = this.el.querySelector(".mute")!;
    this.el.querySelector(".resume")!.addEventListener("click", handlers.resume);
    this.muteEl.addEventListener("click", () => this.setMuted(handlers.mute()));
    this.el.querySelector(".leave")!.addEventListener("click", handlers.leave);
    document.body.appendChild(this.el);
  }

  get isOpen(): boolean {
    return this.el.classList.contains("open");
  }

  open(site: string, muted: boolean, outIfLeaving: boolean): void {
    this.el.querySelector(".site")!.textContent = site;
    this.setMuted(muted);
    this.warnEl.textContent = outIfLeaving ? "leaving now counts as falling: you're out of this attempt" : "";
    this.el.classList.add("open");
  }

  close(): void {
    this.el.classList.remove("open");
  }

  private setMuted(muted: boolean): void {
    this.muteEl.innerHTML = `sound: ${muted ? "off" : "on"} <span class="dim">m</span>`;
  }
}
