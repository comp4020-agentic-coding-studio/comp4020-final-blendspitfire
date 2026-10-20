// The one place colour comes from. Every model, light and decal picks a
// token here; nothing in the codebase writes a hex value of its own. See
// docs/art-and-interaction.md for the rules this palette is built around.
//
// Three kinds of colour, kept apart on purpose:
//
// 1. SURFACES --- what things are made of. All inside one gamut: low
//    chroma (OKLCH C <= SURFACE_CHROMA_MAX), lightness inside a real-world
//    albedo range. Many hues, none of them loud: an oxide-red wall is a
//    greyed deep red, never a fire-engine one. Each swatch is one hue at
//    three lightness steps with hue and chroma held still, so a model gets
//    depth without drifting out of the family.
// 2. EMITTERS --- lamps, indicator LEDs, screens, the reactor. The only
//    things allowed outside the gamut, because they're light, not paint.
// 3. LIGHTS --- the colour of the light itself, by colour temperature.
//    Most of the scene's hue variety comes from here: each room has its own
//    dominant light, so the same grey concrete reads warm in one room and
//    cold in the next.
//
// Plus UI signals (hover, valid/invalid) and player colours, which only
// ever appear as UI or as an emitter.

export interface Ramp {
  shade: number;
  base: number;
  light: number;
}

// --- Colour maths ----------------------------------------------------------

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const toSrgb = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const fromSrgb = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const pack = (r: number, g: number, b: number): number =>
  (Math.round(clamp01(r) * 255) << 16) | (Math.round(clamp01(g) * 255) << 8) | Math.round(clamp01(b) * 255);

/** OKLCH (lightness 0..1, chroma ~0..0.37, hue in degrees) to a packed sRGB hex */
export function oklch(L: number, C: number, h: number): number {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return pack(
    toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  );
}

/** packed sRGB hex back to OKLCH, for checking a colour sits in the gamut */
export function toOklch(c: number): { L: number; C: number; h: number } {
  const r = fromSrgb(((c >> 16) & 255) / 255);
  const g = fromSrgb(((c >> 8) & 255) / 255);
  const b = fromSrgb((c & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

/**
 * The colour of a blackbody at `kelvin` (Tanner Helland's fit), normalised
 * so its brightest channel is 1 --- a light's hue, with its strength set
 * separately by intensity.
 */
function blackbody(k: number): [number, number, number] {
  const t = k / 100;
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [Math.max(r, 1), Math.max(g, 1), Math.max(b, 1)];
}

/**
 * The scene's white balance, as a camera would set it. Raw blackbody colours
 * are judged against 6500K daylight, which makes a 4000K tube look peach;
 * underground there's no daylight to compare with, so the eye (and a
 * camera) balances to the room's lights. At 4500K a fluorescent reads
 * neutral-to-cool, a bulb warm and sodium orange --- the relationships that
 * actually matter.
 */
const WHITE_POINT_K = 4500;

export function kelvin(k: number): number {
  const c = blackbody(k);
  const w = blackbody(WHITE_POINT_K);
  const r = c[0] / w[0];
  const g = c[1] / w[1];
  const b = c[2] / w[2];
  const max = Math.max(r, g, b);
  return pack(r / max, g / max, b / max);
}

// --- 1. Surfaces -----------------------------------------------------------

/**
 * The surface gamut. Chroma 0.06 in OKLCH is roughly Munsell chroma 2--3:
 * clearly tinted, never saturated. Lightness 0.28--0.82 is about sRGB
 * 45--200, the range real non-metal albedo actually falls in --- nothing
 * paper-white, nothing ink-black.
 */
export const SURFACE_CHROMA_MAX = 0.06;
export const SURFACE_L_MIN = 0.26;
export const SURFACE_L_MAX = 0.82;

/** one hue at three lightness steps; hue and chroma held still across them */
export function swatch(L: number, C: number, h: number, step = 0.09): Ramp {
  const c = Math.min(C, SURFACE_CHROMA_MAX);
  const at = (l: number) => oklch(Math.min(SURFACE_L_MAX, Math.max(SURFACE_L_MIN, l)), c, h);
  return { shade: at(L - step), base: at(L), light: at(L + step) };
}

/**
 * The mother hue every neutral leans toward: a slightly cool blue-grey, so
 * the "greys" of concrete, steel and plastic share one undertone and the
 * scene holds together even as the painted hues vary room to room.
 */
const MOTHER_H = 250;

// structure
export const CONCRETE = swatch(0.56, 0.008, MOTHER_H);
export const CONCRETE_DARK = swatch(0.4, 0.008, MOTHER_H);
/** sealed floor concrete: a touch darker than walls, so floors don't bounce light back up */
export const FLOOR = swatch(0.46, 0.01, 75, 0.035);
export const LINOLEUM = swatch(0.5, 0.03, 160, 0.035);
export const RAISED_FLOOR = swatch(0.52, 0.006, MOTHER_H, 0.04);

// painted block walls, one per zone: the "many hues, one family" part
export const PAINT_SAGE = swatch(0.6, 0.045, 150);
export const PAINT_STEEL_BLUE = swatch(0.56, 0.045, 240);
export const PAINT_OXIDE = swatch(0.44, 0.06, 30);
export const PAINT_OCHRE = swatch(0.62, 0.055, 85);
export const PAINT_PUTTY = swatch(0.66, 0.025, 70);
/** hazard yellow, worn: still reads as a warning by pattern, not by shouting */
export const HAZARD = swatch(0.66, 0.06, 92);

// materials
export const STEEL = swatch(0.5, 0.01, MOTHER_H);
export const ALUMINIUM = swatch(0.68, 0.008, MOTHER_H);
export const RUBBER = swatch(0.3, 0.006, MOTHER_H, 0.04);
export const PLASTIC = swatch(0.72, 0.012, 85);
export const RUST = swatch(0.42, 0.055, 45);
export const WOOD = swatch(0.5, 0.05, 65);
export const PAPER = swatch(0.8, 0.012, 90, 0.03);
export const FOLIAGE = swatch(0.45, 0.05, 140);

// people (clothes are greyed; the player's own colour is their lamp)
export const CLOTH = swatch(0.42, 0.012, MOTHER_H);
export const SHOE = swatch(0.74, 0.008, MOTHER_H);
export const SKIN = swatch(0.62, 0.055, 55, 0.07);
export const HAIR = swatch(0.3, 0.025, 50, 0.05);

/** a player colour pulled into the surface gamut: their shirt, so it's theirs but quiet */
export function surfaceVersion(c: string | number, L = 0.5): Ramp {
  const n = typeof c === "string" ? parseInt(c.replace("#", ""), 16) : c;
  const { h } = toOklch(n);
  return swatch(L, SURFACE_CHROMA_MAX, h);
}

// the dark around everything: unlit, unseen
export const FAR = 0x000000;
/** the dark line around players and pickups */
export const OUTLINE = 0x0b0c0e;

// --- 2. Emitters (allowed outside the gamut; they're light) ----------------

export const EMIT_WHITE = 0xfff4e0;
export const EMIT_FLUORO = 0xe8fff4;
export const EMIT_GREEN = 0x3dff7a;
export const EMIT_AMBER = 0xffa02e;
export const EMIT_RED = 0xff2a2a;
export const EMIT_CYAN = 0x4ff0ff;
export const EMIT_REACTOR = 0x5aa8ff;
/** a round in flight: hot, warm white, so it reads as a tracer and not as a UI signal */
export const EMIT_TRACER = 0xffd9a0;

/** sparks off a wall or a box where a round lands */
export const EMIT_SPARK = 0xffe08a;

// --- 2b. Gore (an exception to the gamut, like the floor guides) -------------
// Blood is the one surface colour allowed past the gamut's chroma: it's
// meant to stand out on a grey floor. Kept dark so it reads as a stain under
// lamp light and never as a UI signal.
/** the crew's: a dark arterial red */
export const BLOOD_HUMAN = 0x8a1a16;
/** the crawlers': a sour, acid green */
export const BLOOD_CRAWLER = 0x74b81a;

// --- 3. Lights (by colour temperature) ---------------------------------------

export const LIGHT_FLUORO_COOL = kelvin(5200);
export const LIGHT_LED = kelvin(6800);
export const LIGHT_INCANDESCENT = kelvin(2700);
export const LIGHT_SODIUM = kelvin(2300);
export const LIGHT_EMERGENCY = 0xff1e1e;
/** fluorescent tubes run slightly green; the tint the tubes add on top of their kelvin */
export const LIGHT_FLUORO_TINT = 0xeaffea;
/** the faint everywhere-light so pitch dark still has shape: cold and very dim */
export const AMBIENT_SKY = 0x5a6a80;
export const AMBIENT_GROUND = 0x1c1a18;

// --- UI signals ----------------------------------------------------------------

/** pickups' highlight, "you can act on this" --- a console-display cyan */
export const ACCENT = EMIT_CYAN;
/** invalid placement, "can't do that" */
export const DANGER = 0xff3346;
/** valid placement, "this will work" */
export const OK = 0x8fe08a;
/** floor stencilling: dark paint, readable on the concrete */
export const STENCIL = oklch(0.22, 0.01, MOTHER_H);

// --- Players: vivid, but only as UI and as their lamp (an emitter) -----------------

export const PLAYER_COLORS = ["#ff7a1f", "#ffc21a", "#5fd35f", "#ff4fa3", "#8f6bff", "#3d7bff"] as const;
const PLAYER_COLOR_NAMES: Record<string, string> = {
  "#ff7a1f": "Orange",
  "#ffc21a": "Yellow",
  "#5fd35f": "Green",
  "#ff4fa3": "Pink",
  "#8f6bff": "Violet",
  "#3d7bff": "Blue",
};

/**
 * What a player is called on screen and in the server log: their colour
 * plus the start of their id, so two Oranges on different days stay apart.
 */
export const codename = (p: { id: string; color: string }): string =>
  `${PLAYER_COLOR_NAMES[p.color] ?? "Grey"}-${p.id.slice(0, 4)}`;

export const hex = (c: number): string => `#${c.toString(16).padStart(6, "0")}`;
