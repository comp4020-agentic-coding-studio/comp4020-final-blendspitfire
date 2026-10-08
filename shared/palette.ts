// The one place colour comes from. Every model, light and decal picks a
// token here; nothing in the codebase writes a hex value of its own. See
// docs/art-and-interaction.md for the rules this palette is built around.
//
// Mood: a Firewatch-style late afternoon --- warm light, plum shade, muted
// earth and teal pines. Each environment token has three values (shade /
// base / light) so a model gets depth by choosing among them, never by
// inventing a new colour.

export interface Ramp {
  shade: number;
  base: number;
  light: number;
}

const ramp = (shade: number, base: number, light: number): Ramp => ({ shade, base, light });

// --- Environment: low-to-mid saturation, never competes with players/items.
export const GROUND = ramp(0x7a5e4a, 0x917259, 0xa88666);
export const GROUND_ALT = ramp(0x8e8158, 0xa29464, 0xb5a672);
export const FOLIAGE = ramp(0x1f3d3a, 0x2f5d55, 0x4c8a7c);
export const ROCK = ramp(0x4a3a48, 0x6e5a66, 0x9a8590);
export const WOOD = ramp(0x5e301f, 0x8a4a2e, 0xb06a42);
export const GEAR = ramp(0x1e1b22, 0x2e2a33, 0x4a4552);
// clothing: worn denim and off-white trainers, muted so the shirt (the
// player's colour) is what stands out on a person
export const CLOTH = ramp(0x343c4e, 0x465169, 0xd8d2c6);
export const SKIN = ramp(0xa8775a, 0xc48e6c, 0xd9a988);
export const HAIR = ramp(0x2a1d18, 0x3b2a22, 0x55402f);

// --- The far layer: background, and what everything fades toward.
export const FAR = 0x2c1a2e;

// --- Light colours.
export const SUN = 0xffe2c0;
export const HEMI_SKY = 0xffd2b0;
export const HEMI_GROUND = 0x4a2f4a;

// --- Signal colours: reserved for things the player should notice.
/** pickups' highlight, projectiles, "you can act on this" */
export const ACCENT = 0xfde577;
/** invalid placement, "can't do that" */
export const DANGER = 0xff6c40;
/** valid placement, "this will work" */
export const OK = 0x8fe08a;
/** floor guide markings: chalky paint */
export const CHALK = 0xf4efe6;

// --- Players: saturated and lighter than the environment, and kept clear of
// the accent/danger hues so a player is never mistaken for a signal.
export const PLAYER_COLORS = ["#f4efe6", "#5fb4ff", "#a8e05f", "#ff5fa8", "#3fe0d0", "#b48cff"] as const;

export const hex = (c: number): string => `#${c.toString(16).padStart(6, "0")}`;
