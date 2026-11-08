import { inkPixels, pixelCanvas, pixelLogo, pixelSvg, sealStamp } from "./logo.ts";

// The contract (user 2026-11-08, ADR-087): between the end of the tutorial
// and the dig site, the company's terms for the job on four short pages
// (click to go on), ending on a signature line: the contractor's own name
// goes down in a cursive hand, the APPROVED stamp comes down, and only then
// does the helicopter take you. It replaces the ride-down briefing
// (ADR-086). Content approved by the user in Chinese (steps, hostiles, the
// sealed exits, an expected pay on the signing page that "varies with
// performance"); the
// English wording is the agent's.

const W = 160;
const H = 120;
/** white strokes on transparent, like the seal before it's inked */
const svg = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="square" stroke-linejoin="miter">${body}</svg>`;

/** the reactor core in its cage, power arcing off it */
const REACTOR = svg(`
  <rect x="52" y="22" width="56" height="76"/>
  <line x1="52" y1="42" x2="108" y2="42"/><line x1="52" y1="78" x2="108" y2="78"/>
  <circle cx="80" cy="60" r="11" fill="#fff"/>
  <path d="M30 34 l-10 -10 M24 60 h-14 M30 86 l-10 10 M130 34 l10 -10 M136 60 h14 M130 86 l10 10"/>
  <rect x="64" y="104" width="32" height="10" fill="#fff"/>
`);
/** a crawler */
const CRAWLER = svg(`
  <ellipse cx="80" cy="62" rx="30" ry="20" fill="#fff"/>
  <circle cx="80" cy="36" r="10" fill="#fff"/>
  <path d="M56 50 l-20 -16 M52 64 h-26 M56 76 l-20 16 M104 50 l20 -16 M108 64 h26 M104 76 l20 16" stroke-width="7"/>
`);
/** the cargo on the freight platform going up */
const FREIGHT = svg(`
  <path d="M42 20 v88 M118 20 v88" stroke-width="3"/>
  <rect x="52" y="64" width="24" height="24" fill="#fff"/><rect x="80" y="56" width="28" height="32"/>
  <line x1="80" y1="72" x2="108" y2="72" stroke-width="3"/>
  <line x1="46" y1="92" x2="114" y2="92"/>
  <path d="M80 46 v-32 M68 26 l12 -12 l12 12"/>
`);
/** the lift going down a shaft */
const LIFT = svg(`
  <path d="M46 10 v100 M114 10 v100" stroke-width="3"/>
  <rect x="58" y="40" width="44" height="36"/>
  <line x1="80" y1="10" x2="80" y2="40" stroke-width="3"/>
  <path d="M80 84 v22 M68 96 l12 12 l12 -12"/>
`);
/** the reactor behind a shield: keep it safe */
const GUARD = svg(`
  <rect x="62" y="34" width="36" height="52"/>
  <circle cx="80" cy="60" r="8" fill="#fff"/>
  <path d="M80 8 l44 14 v34 q0 36 -44 56 q-44 -20 -44 -56 v-34 z"/>
`);
/** an issued rifle */
const RIFLE = svg(`
  <path d="M14 56 h96 v12 h-96 z" fill="#fff"/>
  <path d="M110 58 h36 v8 h-36 z" fill="#fff"/>
  <path d="M36 68 l-10 28 h16 l8 -28 M70 68 v20 h12 v-20" fill="#fff"/>
  <path d="M60 48 h28 v8 h-28 z" fill="#fff"/>
`);
/** blast doors shut, a padlock across the seam */
const SEALED = svg(`
  <rect x="34" y="14" width="92" height="92"/>
  <line x1="80" y1="14" x2="80" y2="106"/>
  <path d="M42 98 l30 -30 M88 98 l30 -30" stroke-width="3"/>
  <path d="M68 58 v-12 q12 -16 24 0 v12" stroke-width="5"/>
  <rect x="60" y="58" width="40" height="30" fill="#fff"/>
`);

/**
 * A page: a heading, then either a row of pictograms with a short caption
 * each (`steps`, numbered when `numbered`), or a body of HTML. {name} and
 * {no} in the body are the contractor's name and the contract's number.
 */
type Page = { head: string; body?: string; logo?: true; steps?: [string, string][]; numbered?: true };
const PAGES: Page[] = [
  {
    head: "contract of engagement",
    logo: true,
    body:
      '<div class="kv"><span>contract</span><b>AN-B3-{no}</b></div>' +
      '<div class="kv"><span>contractor</span><b>{name}</b></div>' +
      '<div class="kv"><span>site</span><b>facility B3, sub-level</b></div>' +
      '<div class="kv"><span>term</span><b>one shift</b></div>',
  },
  {
    head: "§1 scope of work",
    numbered: true,
    steps: [
      [LIFT, "descend to working depth"],
      [REACTOR, "locate and power up the reactor"],
      [GUARD, "keep it safe until start-up"],
      [FREIGHT, "ride up with the cargo"],
    ],
  },
  {
    head: "§2 site conditions",
    steps: [
      [CRAWLER, "hostile organisms may be present"],
      [RIFLE, "issued firearms authorised"],
      [SEALED, "reactor lost: exits sealed"],
    ],
  },
  {
    head: "§3 acceptance",
    body:
      '<div class="pay"><span class="dim">expected pay</span><b>$947,500</b><span class="dim">varies with performance. the payslip is final.</span></div>' +
      "<p>by signing below, the contractor accepts these terms and agrees to be transported to the site.</p>" +
      '<div class="sigline"><div class="sig"></div><div class="stamp"></div></div>' +
      '<div class="kv"><span>signed</span><b>{name}</b></div>',
  },
];

const ink = (): string => getComputedStyle(document.documentElement).getPropertyValue("--ui").trim() || "#f2ead6";
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** the signature's hand (loaded with VT323 in index.html) and its box, in screen px */
const SIG_FONT = '"Homemade Apple", cursive';
const SIG_W = 330;
const SIG_H = 100;
/** how long the pen takes over the signature */
const SIG_MS = 1100;
const STAMP_AFTER_MS = 350;

/**
 * The contractor's name signed in a cursive hand, scrawled: each letter
 * crowds into the last so they run together, with its own lean, size and
 * height, all seeded by the name (the same name always signs the same way),
 * and a stroke under the lot. `k` 0..1 is how far the pen has got, left to
 * right. Drawn on the game's pixel grid.
 */
function drawSignature(canvas: HTMLCanvasElement, name: string, k: number, color: string): void {
  let seed = 7;
  for (const c of name) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  const r = (): number => ((seed = (seed * 1103515245 + 12345) >>> 0) % 1000) / 1000;
  // a hand signs in mixed case: RIPLEY -> Ripley
  const word = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  inkPixels(
    canvas,
    (g, w, h) => {
      const px = h * 0.42;
      g.lineWidth = h * 0.012;
      g.lineJoin = "round";
      g.fillStyle = g.strokeStyle = "#fff";
      g.save();
      g.translate(w * 0.04, h * 0.62);
      g.transform(1, 0, -0.25, 1, 0, 0); // the whole thing leans
      g.scale(0.92, 1); // and is a little cramped, like a hurried hand
      let x = 0;
      for (const [i, c] of [...word].entries()) {
        const size = px * (i === 0 ? 1.3 : 0.9 + r() * 0.2);
        g.font = `${size}px ${SIG_FONT}`;
        g.save();
        g.translate(x, (r() - 0.5) * h * 0.08 - i * h * 0.012);
        g.rotate((r() - 0.5) * 0.18);
        g.fillText(c, 0, 0);
        g.strokeText(c, 0, 0); // a heavier pen than the font's, so it survives the pixel grid
        g.restore();
        // the next letter starts inside this one, so the strokes join up
        x += g.measureText(c).width * (0.78 + r() * 0.1);
      }
      // the flourish: back under the name and off to the right
      g.lineWidth = h * 0.035;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(x * 0.1, h * 0.2);
      g.bezierCurveTo(x * 0.5, h * (0.28 + r() * 0.06), x * 0.9, h * 0.1, x + w * 0.06, h * (0.12 - r() * 0.08));
      g.stroke();
      g.restore();
      // the pen's got this far: rub out the rest
      g.clearRect(w * (0.02 + 0.98 * k), 0, w, h);
    },
    color,
  );
}

export class Contract {
  private readonly el: HTMLDivElement;
  private page = 0;
  private name = "";
  private signedAt = 0;
  private onDone?: () => void;
  /** played when the APPROVED stamp lands (main.ts: the PAID stamp's thud) */
  onStamp?: () => void;

  private readonly cell: number;

  /** `cell`: how many screen px one of the game's pixels is */
  constructor(cell: number) {
    this.cell = cell;
    this.el = document.createElement("div");
    this.el.className = "ui-contract";
    this.el.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (b?.dataset.act) this.act(b.dataset.act);
    });
    document.body.appendChild(this.el);
  }

  get isOpen(): boolean {
    return this.el.classList.contains("open");
  }

  /** open on the first page for `name` (the contractor); `done` runs once it's signed and they go on */
  open(name: string, done: () => void): void {
    this.name = name || "contractor";
    this.onDone = done;
    this.page = 0;
    this.signedAt = 0;
    this.el.classList.remove("stamped");
    this.el.classList.add("open");
    this.render();
  }

  close(): void {
    this.el.classList.remove("open");
    this.onDone = undefined;
  }

  /** the keyboard: Space / Enter / E go on (or sign, on the last page), Esc closes without signing */
  key(k: string): boolean {
    if (!this.isOpen) return false;
    if (k === "escape") {
      this.close();
      return true;
    }
    if (k === " " || k === "enter" || k === "e") {
      const last = this.page === PAGES.length - 1;
      this.act(!last ? "next" : this.signedAt ? "go" : "sign");
      return true;
    }
    if (k === "arrowleft" || k === "backspace") this.act("back");
    if (k === "arrowright") this.act("next");
    return true;
  }

  private act(what: string): void {
    if (what === "next" && this.page < PAGES.length - 1) this.page++;
    else if (what === "back" && this.page > 0 && !this.signedAt) this.page--;
    else if (what === "sign" && !this.signedAt) this.sign();
    else if (what === "go" && this.el.classList.contains("stamped")) {
      const done = this.onDone;
      this.close();
      done?.();
      return;
    } else if (what === "close") {
      this.close();
      return;
    } else return;
    if (what !== "sign") this.render();
  }

  private render(): void {
    const p = PAGES[this.page];
    const last = this.page === PAGES.length - 1;
    const no = String(Math.abs([...this.name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)) % 10000).padStart(4, "0");
    const body = (p.body ?? "").replaceAll("{name}", esc(this.name)).replaceAll("{no}", no);
    const steps = (p.steps ?? [])
      .map(([, say], i) => `${i && p.numbered ? '<div class="then">▸</div>' : ""}<div class="step"><div class="art"></div><div class="say">${p.numbered ? `<b>${i + 1}</b> ` : ""}${say}</div></div>`)
      .join("");
    this.el.innerHTML =
      '<div class="doc">' +
      `<div class="top"><span>${p.head}</span><span class="pg">${this.page + 1} / ${PAGES.length}</span></div>` +
      `<div class="page">${p.logo ? '<div class="seal"></div>' : ""}${steps ? `<div class="steps n${p.steps!.length}">${steps}</div>` : ""}${body ? `<div class="text">${body}</div>` : ""}</div>` +
      '<div class="nav">' +
      (this.page > 0 && !this.signedAt ? '<button data-act="back">◂ back</button>' : '<button data-act="close" class="dim">not now</button>') +
      (last
        ? this.signedAt
          ? '<button data-act="go" class="go">proceed to transport ▸</button>'
          : '<button data-act="sign" class="go">✎ sign</button>'
        : '<button data-act="next" class="go">continue ▸</button>') +
      "</div></div>";
    if (p.logo) this.el.querySelector(".seal")!.append(pixelLogo(Math.min(300, window.innerWidth * 0.6), this.cell, ink()));
    const phone = window.innerWidth < 640;
    const size = phone ? Math.min(96, window.innerWidth * 0.26) : 104;
    this.el.querySelectorAll(".step .art").forEach((el, i) => el.append(pixelSvg(p.steps![i][0], W, H, size, this.cell, ink())));
  }

  /** the pen across the line, then the stamp */
  private sign(): void {
    this.signedAt = performance.now();
    const width = Math.min(SIG_W, window.innerWidth * 0.62);
    const sig = pixelCanvas(width, (width * SIG_H) / SIG_W, this.cell);
    this.el.querySelector(".sig")!.replaceChildren(sig);
    // the hand comes from Google Fonts: wait for it (or give up and use the fallback)
    const ready = Promise.race([document.fonts.load(`40px ${SIG_FONT}`), new Promise((r) => window.setTimeout(r, 800))]);
    void ready.then(() => {
      const start = performance.now();
      const draw = (): void => {
        if (!this.isOpen || this.page !== PAGES.length - 1) return;
        const k = Math.min(1, (performance.now() - start) / SIG_MS);
        drawSignature(sig, this.name, k, ink());
        if (k < 1) window.setTimeout(draw, 60);
        else
          window.setTimeout(() => {
            this.render();
            // the re-render rebuilt the page: put the signature back, then the stamp comes down
            this.el.querySelector(".sig")!.replaceChildren(sig);
            this.el.querySelector(".stamp")!.replaceChildren(sealStamp("APPROVED", 240, this.cell, "#ff5a48"));
            void this.el.offsetWidth;
            this.el.classList.add("stamped");
            this.onStamp?.();
          }, STAMP_AFTER_MS);
      };
      draw();
    });
  }
}
