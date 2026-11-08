// The company's seal, for the thanks card (pixelLogo puts it on the game's grid): a rectangular stamp whose face is
// a Code 128 barcode for PAYLOAD. The bar tops are cut
// into the surface --- regular blocks with windows, trees, and vine cables
// hung between the towers that punch holes through the bars --- and the
// bottom edge sinks into a shaft with the reactor under it, so the surface
// and the facility read as one cross-section. Everything decorative stays
// above the scan band. The bars run flush with the frame (user's call,
// 2026-10-29), which drops the quiet zone a scanner needs to find the code:
// it encodes PAYLOAD correctly but won't scan unless ~7 modules of space are
// left either side (tested with zbar).
// No letters on the face: the name is set under it by the card.
// Drawn in currentColor, so it takes the UI's phosphor colour.

// --- Code 128 ---------------------------------------------------------------
// Each symbol is six alternating bar/space widths in modules (stop has seven).
const C128 = (
  "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 " +
  "123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 " +
  "111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 " +
  "231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 " +
  "141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 " +
  "124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 " +
  "311141 411131 211412 211214 211232 2331112"
).split(" ");
const START_B = 104;
const START_C = 105;
const CODE_C = 99;
const STOP = 106;

/** what the bars say: "4020", whose thicker bars survive pixelation (user 2026-11-04; "COMP4020" was tried and didn't) */
const PAYLOAD = "4020";

/** letters in set B, trailing digit pairs in set C: black runs as [startModule, widthModules], and the total width */
function code128(text: string): { runs: [number, number][]; width: number } {
  const [, head = "", digits = ""] = text.match(/^(.*?)((?:\d\d)*)$/) ?? [];
  const pairs = (digits.match(/\d\d/g) ?? []).map(Number);
  const letters = [...head].map((c) => c.charCodeAt(0) - 32);
  const vals = letters.length ? [START_B, ...letters, ...(pairs.length ? [CODE_C, ...pairs] : [])] : [START_C, ...pairs];
  const check = vals.reduce((s, v, i) => s + v * Math.max(i, 1), 0) % 103;
  const runs: [number, number][] = [];
  let x = 0;
  for (const v of [...vals, check, STOP]) {
    [...(C128[v] ?? "")].forEach((ch, i) => {
      if (i % 2 === 0) runs.push([x, +ch]);
      x += +ch;
    });
  }
  return { runs, width: x };
}

// --- Layout (viewBox units) ---------------------------------------------------
const W = 520;
const H = 292;
const EDGE = 5; // outer frame inset
const STEP = 7; // stepped corner, as on the terminal UI's frames
const INNER = EDGE + STEP * 2 + 4; // the thin inner frame line
const X0 = INNER + 1; // bars run flush with the inner frame
const BW = W - X0 * 2;
const TOP = 30; // tallest roof
const BAND = 128; // scan band starts here; nothing is cut out below it
const BOT = 196; // bars end (the shaft goes deeper)
const CX = X0 + BW / 2;
const REACTOR_Y = BOT + 62;

const f = (n: number): string => n.toFixed(1);
const X = (v: number): number => X0 + v * BW;
const Y = (v: number): number => TOP + v * (BAND - TOP);

// Blocks as [left, right, roof], x 0..1 across the bars, y 0..1 down to the scan band.
const BLOCKS: [number, number, number][] = [
  [0, 0.1, 0.56], [0.1, 0.22, 0.26], [0.13, 0.19, 0.14], [0.26, 0.37, 0.44], [0.37, 0.45, 0.04], [0.395, 0.425, -0.08],
  [0.45, 0.56, 0.5], [0.56, 0.67, 0.2], [0.585, 0.645, 0.1], [0.71, 0.81, 0.38], [0.81, 0.89, 0.14], [0.89, 1, 0.6],
];
// Tree crowns in the two gaps, shrubs on the low roofs: [x, y, radius in units].
const CROWNS: [number, number, number][] = [
  [0.24, 0.5, 18], [0.225, 0.62, 14], [0.255, 0.66, 13], [0.69, 0.42, 20], [0.675, 0.56, 14], [0.705, 0.58, 15],
  [0.05, 0.5, 11], [0.835, 0.1, 9], [0.86, 0.12, 8], [0.5, 0.45, 9],
];
// Window grids: [left, right, first row, columns, rows].
const WINDOWS: [number, number, number, number, number][] = [
  [0.1, 0.22, 0.4, 3, 3], [0.37, 0.45, 0.18, 2, 4], [0.56, 0.67, 0.34, 3, 3], [0.81, 0.89, 0.26, 2, 3],
];
// Vine cables: from, to, and the lowest point of the sag.
const CABLES: [[number, number], [number, number], number][] = [
  [[0.2, 0.28], [0.41, 0.06], 0.62],
  [[0.43, 0.1], [0.6, 0.22], 0.52],
  [[0.62, 0.14], [0.86, 0.16], 0.58],
];

/** the mask over the bars: white keeps (ground, blocks, crowns), black cuts (windows, vines) */
function surfaceMask(): string {
  let keep = `<rect x="${X0}" y="${f(Y(0.86))}" width="${BW}" height="${H}" fill="#fff"/>`;
  keep += BLOCKS.map(([a, b, t]) => `<rect x="${f(X(a))}" y="${f(Y(t))}" width="${f((b - a) * BW)}" height="${H}" fill="#fff"/>`).join("");
  keep += CROWNS.map(([x, y, r]) => `<circle cx="${f(X(x))}" cy="${f(Y(y))}" r="${r}" fill="#fff"/>`).join("");
  let cut = "";
  for (const [a, b, t, cols, rows] of WINDOWS) {
    const cw = ((b - a) * BW) / cols;
    for (let c = 0; c < cols; c++)
      for (let r = 0; r < rows; r++) {
        if ((c * 7 + r * 3) % 5 === 1) continue; // a few windows stay dark
        cut += `<rect x="${f(X(a) + c * cw + cw * 0.3)}" y="${f(Y(t + r * 0.13))}" width="${f(cw * 0.4)}" height="7" fill="#000"/>`;
      }
  }
  for (const [[ax, ay], [bx, by], sag] of CABLES) {
    const at = (t: number): [number, number] => [
      X(ax + (bx - ax) * t),
      Y(ay + (by - ay) * t + 4 * (sag - (ay + by) / 2) * t * (1 - t)),
    ];
    const [sx, sy] = at(0);
    const [mx, my] = at(0.5);
    const [ex, ey] = at(1);
    cut += `<path d="M${f(sx)} ${f(sy)}Q${f(2 * mx - (sx + ex) / 2)} ${f(2 * my - (sy + ey) / 2)} ${f(ex)} ${f(ey)}" fill="none" stroke="#000" stroke-width="3.5"/>`;
    for (let i = 1; i < 12; i++) {
      const [lx, ly] = at(i / 12);
      const side = i % 2 ? -1 : 1;
      cut += `<ellipse cx="${f(lx)}" cy="${f(ly + side * 4)}" rx="5" ry="3" transform="rotate(${side * 35} ${f(lx)} ${f(ly + side * 4)})" fill="#000"/>`;
    }
    [0.3, 0.55, 0.8].forEach((t, k) => {
      const [lx, ly] = at(t);
      const len = 10 + k * 5;
      if (ly + len > Y(0.92)) return;
      cut += `<path d="M${f(lx)} ${f(ly)}V${f(ly + len)}" stroke="#000" stroke-width="2.5"/><ellipse cx="${f(lx)}" cy="${f(ly + len + 3)}" rx="3.5" ry="5" fill="#000"/>`;
    });
  }
  return keep + cut;
}

/** solid shapes the gaps between bars can't swallow: a roof slab on every block, and the crowns */
function solids(): string {
  return (
    BLOCKS.map(([a, b, t]) => `<rect x="${f(X(a))}" y="${f(Y(t) - 4)}" width="${f((b - a) * BW)}" height="5"/>`).join("") +
    CROWNS.map(([x, y, r]) => `<circle cx="${f(X(x))}" cy="${f(Y(y))}" r="${r}"/>`).join("")
  );
}

function frame(): string {
  const o = EDGE;
  const s = STEP;
  const p =
    `M${o + s * 2} ${o}H${W - o - s * 2}V${o + s}H${W - o - s}V${o + s * 2}H${W - o}V${H - o - s * 2}H${W - o - s}V${H - o - s}H${W - o - s * 2}V${H - o}` +
    `H${o + s * 2}V${H - o - s}H${o + s}V${H - o - s * 2}H${o}V${o + s * 2}H${o + s}V${o + s}H${o + s * 2}Z`;
  return (
    `<path d="${p}" fill="none" stroke="currentColor" stroke-width="6"/>` +
    `<rect x="${INNER}" y="${INNER}" width="${W - INNER * 2}" height="${H - INNER * 2}" fill="none" stroke="currentColor" stroke-width="2"/>`
  );
}

/** the seal as an SVG string; scale it with CSS width */
export function logoSvg(): string {
  const { runs, width } = code128(PAYLOAD);
  const m = BW / width;
  const bars = runs.map(([x, w]) => `<rect x="${(X0 + x * m).toFixed(2)}" y="0" width="${(w * m).toFixed(2)}" height="${BOT + 40}"/>`).join("");
  const shaft =
    `<polygon points="${X0},0 ${X0 + BW},0 ${X0 + BW},${BOT} ${CX + 66},${BOT} ${CX + 22},${BOT + 36} ` +
    `${CX - 22},${BOT + 36} ${CX - 66},${BOT} ${X0},${BOT}"/>`;
  return (
    `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Asset Nexus Unlimited">` +
    `<defs>` +
    `<filter id="anu-worn" x="-3%" y="-3%" width="106%" height="106%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="7" result="warp"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="warp" scale="3" result="rough"/>` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="2" seed="3" result="grain"/>` +
    `<feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  9 0 0 0 -3.3" result="keep"/>` +
    `<feComposite in="rough" in2="keep" operator="in"/>` +
    `</filter>` +
    `<mask id="anu-surface" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">${surfaceMask()}</mask>` +
    `<clipPath id="anu-shaft">${shaft}</clipPath>` +
    `</defs>` +
    `<g filter="url(#anu-worn)">${frame()}` +
    `<circle cx="${CX}" cy="${REACTOR_Y}" r="15" fill="none" stroke="currentColor" stroke-width="5"/>` +
    `<circle cx="${CX}" cy="${REACTOR_Y}" r="6" fill="currentColor"/>` +
    `<path d="M${X0} ${REACTOR_Y}H${CX - 30}M${CX + 30} ${REACTOR_Y}H${X0 + BW}" fill="none" stroke="currentColor" stroke-width="3"/>` +
    `</g>` +
    `<g clip-path="url(#anu-shaft)"><g fill="currentColor" mask="url(#anu-surface)">` +
    `<g shape-rendering="crispEdges">${bars}</g>${solids()}</g></g>` +
    `</svg>`
  );
}

/**
 * The seal on the game's own pixel grid: the SVG sampled 8x8 per pixel of
 * `cell` screen px, then each pixel full ink if at least half covered, dim
 * ink if a fifth, else none (user 2026-11-04, of six tried: keeps hard
 * pixels but lets the thin frame and vines survive a step darker). Shown
 * scaled back up nearest-neighbour. `width` is its size on screen in CSS
 * px; `color` the ink, since an image can't take currentColor.
 */
export function pixelLogo(width: number, cell: number, color: string): HTMLCanvasElement {
  // without the worn filter: its grain breaks thin lines into dashes on so coarse a grid
  const svg = logoSvg()
    .replace(' filter="url(#anu-worn)"', "")
    .replace("<svg ", `<svg width="${W}" height="${H}" color="#fff" `);
  return pixelSvg(svg, W, H, width, cell, color);
}

/**
 * Any line drawing (an SVG `w` x `h`, drawn in white) put on the game's
 * pixel grid the way the seal is: `width` screen px wide, one grid pixel
 * every `cell` px, each pixel ink, half ink or clear by how much it covers.
 */
export function pixelSvg(svg: string, w: number, h: number, width: number, cell: number, color: string): HTMLCanvasElement {
  const canvas = pixelCanvas(width, (width * h) / w, cell);
  const img = new Image();
  img.onload = () => inkPixels(canvas, (hx, hw, hh) => hx.drawImage(img, 0, 0, hw, hh), color);
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return canvas;
}

/** supersampling for inkPixels: each game pixel is the coverage of SS x SS drawn ones */
const SS = 8;

/** an empty canvas on the game's pixel grid, `width` x `height` screen px */
export function pixelCanvas(width: number, height: number, cell: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width / cell);
  canvas.height = Math.round(height / cell);
  canvas.style.width = `${canvas.width * cell}px`;
  canvas.style.imageRendering = "pixelated";
  return canvas;
}

/**
 * Ink `canvas` in game pixels: `draw` paints (any colour) onto a canvas SS
 * times finer, and each game pixel is solid, half-tone or empty by how much
 * of it got covered.
 */
export function inkPixels(canvas: HTMLCanvasElement, draw: (hx: CanvasRenderingContext2D, w: number, h: number) => void, color: string): void {
  const hi = document.createElement("canvas");
  hi.width = canvas.width * SS;
  hi.height = canvas.height * SS;
  const hx = hi.getContext("2d")!;
  draw(hx, hi.width, hi.height);
  const src = hx.getImageData(0, 0, hi.width, hi.height).data;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const out = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      let sum = 0;
      for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) sum += src[((y * SS + j) * hi.width + x * SS + i) * 4 + 3];
      const cover = sum / (255 * SS * SS);
      out.data[(y * canvas.width + x) * 4 + 3] = cover >= 0.5 ? 255 : cover >= 0.2 ? 115 : 0;
    }
  }
  ctx.putImageData(out, 0, 0);
}

/** stamp words in hand-set 5x7 pixel letters: at the game's pixel size a font's M closes up */
const GLYPHS: Record<string, string[]> = {
  D: ["1110.", "1..1.", "1...1", "1...1", "1...1", "1..1.", "1110."],
  E: ["11111", "1....", "1....", "1111.", "1....", "1....", "11111"],
  M: ["1...1", "11.11", "1.1.1", "1.1.1", "1...1", "1...1", "1...1"],
  O: [".111.", "1...1", "1...1", "1...1", "1...1", "1...1", ".111."],
  P: ["1111.", "1...1", "1...1", "1111.", "1....", "1....", "1...."],
  A: [".111.", "1...1", "1...1", "11111", "1...1", "1...1", "1...1"],
  I: ["11111", "..1..", "..1..", "..1..", "..1..", "..1..", "11111"],
  R: ["1111.", "1...1", "1...1", "1111.", "1.1..", "1..1.", "1...1"],
  V: ["1...1", "1...1", "1...1", "1...1", ".1.1.", ".1.1.", "..1.."],
};

/**
 * A rubber stamp: a solid block of ink with `word` cut out of it, on the
 * same pixel grid as pixelLogo (letters from GLYPHS only).
 */
export function cutStamp(word: string, cell: number, color: string): HTMLCanvasElement {
  const n = word.length;
  const gw = n * 5 + (n - 1) * 2 + 6;
  const gh = 13;
  const canvas = document.createElement("canvas");
  canvas.width = gw;
  canvas.height = gh;
  canvas.style.width = `${gw * cell}px`;
  canvas.style.imageRendering = "pixelated";
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, gw, gh);
  const x0 = 3;
  const y0 = Math.floor((gh - 7) / 2);
  [...word].forEach((ch, i) =>
    GLYPHS[ch].forEach((row, r) => [...row].forEach((v, c) => v === "1" && ctx.clearRect(x0 + i * 7 + c, y0 + r, 1, 1))),
  );
  return canvas;
}

/**
 * The company's own seal as a rubber stamp (user 2026-11-09, the contract's
 * APPROVED): the seal in the stamp's ink, uncovered, with `word` under it and a rule round both. The ink is worn: a
 * few pixels (the same ones every time) didn't take. `width` in screen px.
 */
export function sealStamp(word: string, width: number, cell: number, color: string): HTMLCanvasElement {
  const n = word.length;
  const ww = n * 5 + (n - 1) * 2;
  const gw = Math.max(ww + 8, Math.round(width / cell));
  const lw = gw - 6;
  const lh = Math.round((lw * H) / W);
  const gh = 3 + lh + 2 + 7 + 3;
  const canvas = pixelCanvas(gw * cell, gh * cell, cell);
  const draw = (img: HTMLImageElement): void => {
    inkPixels(canvas, (g, w, h) => g.drawImage(img, (3 / gw) * w, (3 / gh) * h, (lw / gw) * w, (lh / gh) * h), color);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = color;
    // the word under the seal, and a rule round the lot like a rubber stamp's edge
    const bx = Math.floor((gw - ww) / 2);
    const by = 3 + lh + 2;
    [...word].forEach((ch, i) =>
      GLYPHS[ch].forEach((row, r) => [...row].forEach((v, c) => v === "1" && ctx.fillRect(bx + i * 7 + c, by + r, 1, 1))),
    );
    ctx.fillRect(0, 0, gw, 1);
    ctx.fillRect(0, gh - 1, gw, 1);
    ctx.fillRect(0, 0, 1, gh);
    ctx.fillRect(gw - 1, 0, 1, gh);
    // worn ink: drop about one pixel in eleven, seeded so it never flickers
    let seed = 4020;
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) if (((seed = (seed * 1103515245 + 12345) >>> 0) >>> 16) % 11 === 0) ctx.clearRect(x, y, 1, 1);
  };
  // the seal decodes once; after that every stamp is drawn at once, so a page
  // rebuilt while the stamp is down never shows it blank
  const img = sealImage();
  if (img.complete && img.naturalWidth) draw(img);
  else img.addEventListener("load", () => draw(img), { once: true });
  return canvas;
}

let sealImg: HTMLImageElement | undefined;
/** the seal (no worn filter) as an image, decoded once and kept */
function sealImage(): HTMLImageElement {
  if (sealImg) return sealImg;
  sealImg = new Image();
  const svg = logoSvg()
    .replace(' filter="url(#anu-worn)"', "")
    .replace("<svg ", `<svg width="${W}" height="${H}" color="#fff" `);
  sealImg.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return sealImg;
}

/** The DEMO stamp under the seal (user 2026-11-03/04) */
export const demoStamp = (cell: number, color: string): HTMLCanvasElement => cutStamp("DEMO", cell, color);
