// The game's effects, synthesised (client/audio.ts plays them in the
// listener's room; /sounds.html plays each one on a click, user 2026-11-05:
// hear them there before they go in). Each takes the context, where to
// send it, and a level 0..1, and schedules itself from now.

type Out = AudioNode;

/**
 * Recorded takes (public/sfx, CC0, credited in public/sfx/CREDITS.md),
 * fetched and decoded once per context. A sound with several takes plays
 * one at random, a touch off in pitch, so a burst doesn't repeat itself.
 */
export const TAKES = {
  rifleAR15: ["ar15_a", "ar15_b"],
  rifleSKS: ["sks_a", "sks_b"],
  rifleAK: ["ak_a", "ak_b"],
  rifleMosin: ["mosin_a", "mosin_b"],
  /** the structure groaning (SoundBible "Submarine Creaking", public domain) */
  groan: ["groan_a", "groan_b", "groan_c"],
} as const;

/**
 * How hard a take is pushed (user 2026-11-05: the plain recordings sounded
 * wrong, try something that bangs more): a pre-gain into a soft clipper
 * (squashes the crack, lifts the body), a low shelf for weight, and a
 * synthesised sub thump and a short noise crack laid under and over it.
 * "raw" is the take as recorded.
 */
export interface Punch {
  /** into the clipper: 1 is clean, higher crushes more */
  drive: number;
  /** low shelf at 180 Hz, dB */
  low: number;
  /** the sub thump's level, 0 for none */
  sub: number;
  /** the noise crack's level, 0 for none */
  crack: number;
}
export const PUNCH = {
  raw: { drive: 1, low: 0, sub: 0, crack: 0 },
  punchy: { drive: 3, low: 5, sub: 0.5, crack: 0.25 },
  heavy: { drive: 6, low: 9, sub: 0.9, crack: 0.4 },
} satisfies Record<string, Punch>;
export type PunchName = keyof typeof PUNCH;

const clipCurves = new Map<number, Float32Array<ArrayBuffer>>();
/** tanh(drive x), normalised so full scale stays full scale */
function clipCurve(drive: number): Float32Array<ArrayBuffer> {
  let c = clipCurves.get(drive);
  if (!c) {
    c = new Float32Array(1024);
    for (let i = 0; i < c.length; i++) {
      const x = (i / (c.length - 1)) * 2 - 1;
      c[i] = Math.tanh(drive * x) / Math.tanh(drive);
    }
    clipCurves.set(drive, c);
  }
  return c;
}
export type TakeName = keyof typeof TAKES;
const decoded = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();
export async function loadTakes(ctx: BaseAudioContext): Promise<void> {
  const have = decoded.get(ctx) ?? new Map<string, AudioBuffer>();
  decoded.set(ctx, have);
  const files = [...new Set(Object.values(TAKES).flat())];
  await Promise.all(
    files.map(async (f) => {
      if (have.has(f)) return;
      const res = await fetch(`sfx/${f}.wav`);
      have.set(f, await ctx.decodeAudioData(await res.arrayBuffer()));
    }),
  );
}
/** play one of a sound's takes, pushed as hard as `punch`; false if they're not loaded yet */
export function playTake(ctx: BaseAudioContext, out: Out, name: TakeName, level = 1, punch: Punch = PUNCH.raw, rate = 1): boolean {
  const list = TAKES[name];
  const buf = decoded.get(ctx)?.get(list[Math.floor(Math.random() * list.length)]);
  if (!buf) return false;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate * (0.96 + Math.random() * 0.08);
  const v = level * (0.9 + Math.random() * 0.1);
  // the chain: pre-gain -> soft clip -> low shelf -> level
  const pre = ctx.createGain();
  pre.gain.value = 1;
  const clip = ctx.createWaveShaper();
  clip.curve = clipCurve(punch.drive);
  clip.oversample = "2x";
  const shelf = ctx.createBiquadFilter();
  shelf.type = "lowshelf";
  shelf.frequency.value = 180;
  shelf.gain.value = punch.low;
  const g = ctx.createGain();
  // louder going in comes out about as loud: the clipper evens it, this keeps the levels comparable
  g.gain.value = v * (punch.drive > 1 ? 0.7 : 1);
  src.connect(pre).connect(clip).connect(shelf).connect(g).connect(out);
  src.start(t);
  src.stop(t + buf.duration / src.playbackRate.value + 0.05);
  // the thump in the chest and the crack at the front
  if (punch.sub) tone(ctx, out, t, { f: 120, fEnd: 38, gain: punch.sub * v, attack: 0.003, decay: 0.16 });
  if (punch.crack) burst(ctx, out, t, { type: "highpass", f: 2500, gain: punch.crack * v, decay: 0.03 });
  return true;
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
/** a second of white noise, shared */
function noise(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

/** a burst of noise through a filter, shaped by an attack/decay envelope */
function burst(ctx: BaseAudioContext, out: Out, at: number, o: { type: BiquadFilterType; f: number; q?: number; fEnd?: number; gain: number; attack?: number; decay: number }): void {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.loop = true;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter();
  f.type = o.type;
  f.frequency.setValueAtTime(o.f, at);
  if (o.fEnd) f.frequency.exponentialRampToValueAtTime(o.fEnd, at + o.decay);
  f.Q.value = o.q ?? 0.7;
  const g = ctx.createGain();
  const a = o.attack ?? 0.002;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(o.gain, at + a);
  g.gain.exponentialRampToValueAtTime(0.0001, at + a + o.decay);
  src.connect(f).connect(g).connect(out);
  src.start(at, Math.random() * 0.5);
  src.stop(at + a + o.decay + 0.05);
}

/** a tone gliding from f to fEnd, with an envelope */
function tone(ctx: BaseAudioContext, out: Out, at: number, o: { type?: OscillatorType; f: number; fEnd?: number; gain: number; attack?: number; decay: number }): void {
  const osc = ctx.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.f, at);
  if (o.fEnd) osc.frequency.exponentialRampToValueAtTime(o.fEnd, at + (o.attack ?? 0.002) + o.decay);
  const g = ctx.createGain();
  const a = o.attack ?? 0.002;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(o.gain, at + a);
  g.gain.exponentialRampToValueAtTime(0.0001, at + a + o.decay);
  osc.connect(g).connect(out);
  osc.start(at);
  osc.stop(at + a + o.decay + 0.05);
}

/** the rifle: a hard crack, a low body thump, a short tail of the gas; a touch different each time */
export function rifle(ctx: BaseAudioContext, out: Out, level = 1): void {
  const t = ctx.currentTime;
  const v = level * (0.9 + Math.random() * 0.2);
  burst(ctx, out, t, { type: "highpass", f: 1800, gain: 0.55 * v, decay: 0.045 });
  burst(ctx, out, t, { type: "bandpass", f: 900, q: 1.1, fEnd: 300, gain: 0.5 * v, decay: 0.12 });
  tone(ctx, out, t, { f: 140, fEnd: 45, gain: 0.6 * v, decay: 0.11 });
  burst(ctx, out, t + 0.02, { type: "lowpass", f: 1200, fEnd: 200, gain: 0.12 * v, attack: 0.01, decay: 0.35 });
}

/** a round off concrete or steel: a short tick and a high zing */
export function ricochet(ctx: BaseAudioContext, out: Out, level = 1): void {
  const t = ctx.currentTime;
  burst(ctx, out, t, { type: "bandpass", f: 3500, q: 2, gain: 0.25 * level, decay: 0.03 });
  if (Math.random() < 0.4) tone(ctx, out, t + 0.01, { type: "triangle", f: 3200 + Math.random() * 1500, fEnd: 1800, gain: 0.05 * level, decay: 0.25 });
}

/** a round into a body: a wet, low smack */
export function fleshHit(ctx: BaseAudioContext, out: Out, level = 1): void {
  const t = ctx.currentTime;
  burst(ctx, out, t, { type: "lowpass", f: 900, fEnd: 250, gain: 0.45 * level, decay: 0.09 });
  burst(ctx, out, t, { type: "bandpass", f: 1800, q: 3, gain: 0.12 * level, decay: 0.05 });
}

/** a crawler's voice: a rasping chitter, fast clicks through a throat-like band, rising at the end */
export function crawlerChitter(ctx: BaseAudioContext, out: Out, level = 1): void {
  const t = ctx.currentTime;
  const n = 5 + Math.floor(Math.random() * 6);
  const f = 1300 + Math.random() * 700;
  for (let i = 0; i < n; i++) {
    const at = t + i * (0.028 + Math.random() * 0.012);
    burst(ctx, out, at, { type: "bandpass", f: f * (1 + i * 0.03), q: 6, gain: 0.22 * level * (0.6 + Math.random() * 0.4), decay: 0.02 });
  }
}

/** a crawler's shriek when it charges or is hurt badly: a raspy, falling scream */
export function crawlerShriek(ctx: BaseAudioContext, out: Out, level = 1): void {
  const t = ctx.currentTime;
  const len = 0.45 + Math.random() * 0.2;
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  const f0 = 900 + Math.random() * 400;
  osc.frequency.setValueAtTime(f0 * 0.8, t);
  osc.frequency.linearRampToValueAtTime(f0 * 1.15, t + 0.06);
  osc.frequency.exponentialRampToValueAtTime(f0 * 0.5, t + len);
  // the rasp: the pitch shaken fast
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 55 + Math.random() * 25;
  const lg = ctx.createGain();
  lg.gain.value = f0 * 0.12;
  lfo.connect(lg).connect(osc.frequency);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 2200;
  bp.Q.value = 1.4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.25 * level, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  osc.connect(bp).connect(g).connect(out);
  burst(ctx, out, t, { type: "highpass", f: 4000, gain: 0.08 * level, attack: 0.02, decay: len * 0.8 });
  osc.start(t);
  lfo.start(t);
  osc.stop(t + len + 0.05);
  lfo.stop(t + len + 0.05);
}

/** a crawler dying: a short choked squeal, then a wet slump */
export function crawlerDeath(ctx: BaseAudioContext, out: Out, level = 1): void {
  const t = ctx.currentTime;
  tone(ctx, out, t, { type: "sawtooth", f: 1400, fEnd: 300, gain: 0.12 * level, decay: 0.22 });
  burst(ctx, out, t, { type: "bandpass", f: 1800, q: 4, fEnd: 500, gain: 0.15 * level, decay: 0.2 });
  burst(ctx, out, t + 0.18, { type: "lowpass", f: 500, fEnd: 120, gain: 0.4 * level, decay: 0.2 });
}

/** a brute: a deep, wet grunt */
export function bruteGrowl(ctx: BaseAudioContext, out: Out, level = 1): void {
  const t = ctx.currentTime;
  const len = 0.6 + Math.random() * 0.3;
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(75, t);
  osc.frequency.linearRampToValueAtTime(95, t + 0.15);
  osc.frequency.exponentialRampToValueAtTime(55, t + len);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 28;
  const lg = ctx.createGain();
  lg.gain.value = 18;
  lfo.connect(lg).connect(osc.frequency);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 700;
  lp.Q.value = 4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5 * level, t + 0.08);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  osc.connect(lp).connect(g).connect(out);
  osc.start(t);
  lfo.start(t);
  osc.stop(t + len + 0.05);
  lfo.stop(t + len + 0.05);
}

/** a spitter's lob: a throaty hock, then a wet whoosh */
export function spit(ctx: BaseAudioContext, out: Out, level = 1): void {
  const t = ctx.currentTime;
  burst(ctx, out, t, { type: "bandpass", f: 600, q: 3, fEnd: 1400, gain: 0.3 * level, decay: 0.1 });
  burst(ctx, out, t + 0.08, { type: "bandpass", f: 2500, q: 1.5, fEnd: 900, gain: 0.15 * level, attack: 0.03, decay: 0.2 });
}

/** acid landing: a sizzle */
export function acidSplash(ctx: BaseAudioContext, out: Out, level = 1): void {
  const t = ctx.currentTime;
  burst(ctx, out, t, { type: "lowpass", f: 700, fEnd: 200, gain: 0.25 * level, decay: 0.08 });
  burst(ctx, out, t + 0.02, { type: "highpass", f: 5000, gain: 0.12 * level, attack: 0.02, decay: 0.7 });
}

/** a grenade's pin and throw: a metal tick and a swish */
export function grenadeThrow(ctx: BaseAudioContext, out: Out, level = 1): void {
  const t = ctx.currentTime;
  tone(ctx, out, t, { type: "triangle", f: 3800, gain: 0.08 * level, decay: 0.04 });
  burst(ctx, out, t + 0.05, { type: "bandpass", f: 1200, q: 1, fEnd: 500, gain: 0.15 * level, attack: 0.08, decay: 0.18 });
}

/** a grenade going off: a hard crack, a deep boom with a sub drop, then debris pattering down */
export function explosion(ctx: BaseAudioContext, out: Out, level = 1): void {
  const t = ctx.currentTime;
  burst(ctx, out, t, { type: "highpass", f: 1200, gain: 0.6 * level, decay: 0.06 });
  burst(ctx, out, t, { type: "lowpass", f: 1500, fEnd: 120, gain: 0.9 * level, decay: 1.1 });
  tone(ctx, out, t, { f: 90, fEnd: 28, gain: 0.9 * level, decay: 0.8 });
  for (let i = 0; i < 9; i++) {
    const at = t + 0.25 + Math.random() * 1.1;
    burst(ctx, out, at, { type: "bandpass", f: 2000 + Math.random() * 3000, q: 3, gain: 0.05 * level * Math.random(), decay: 0.03 });
  }
}

/** a turret's shot: smaller and drier than the rifle, with a servo whine before it */
export function turretShot(ctx: BaseAudioContext, out: Out, level = 1): void {
  const t = ctx.currentTime;
  burst(ctx, out, t, { type: "highpass", f: 2500, gain: 0.35 * level, decay: 0.03 });
  burst(ctx, out, t, { type: "bandpass", f: 1400, q: 1.5, fEnd: 500, gain: 0.3 * level, decay: 0.07 });
  tone(ctx, out, t, { f: 220, fEnd: 90, gain: 0.25 * level, decay: 0.06 });
}

/** a turret slewing onto a target: a short servo whine */
export function turretServo(ctx: BaseAudioContext, out: Out, level = 1): void {
  const t = ctx.currentTime;
  tone(ctx, out, t, { type: "square", f: 520, fEnd: 780, gain: 0.025 * level, attack: 0.03, decay: 0.18 });
}

/** being hurt: a dull body blow and a sharp intake */
export function playerHurt(ctx: BaseAudioContext, out: Out, level = 1): void {
  const t = ctx.currentTime;
  burst(ctx, out, t, { type: "lowpass", f: 600, fEnd: 150, gain: 0.6 * level, decay: 0.15 });
  tone(ctx, out, t, { f: 110, fEnd: 50, gain: 0.5 * level, decay: 0.15 });
  burst(ctx, out, t + 0.05, { type: "bandpass", f: 2200, q: 2, gain: 0.08 * level, attack: 0.04, decay: 0.2 });
}

/** the reactor taking a hit: an alarm blip, two low tones */
export function reactorAlarm(ctx: BaseAudioContext, out: Out, level = 1): void {
  const t = ctx.currentTime;
  tone(ctx, out, t, { type: "square", f: 440, gain: 0.05 * level, attack: 0.005, decay: 0.12 });
  tone(ctx, out, t + 0.16, { type: "square", f: 330, gain: 0.05 * level, attack: 0.005, decay: 0.16 });
}

/** a dry click: the gun when it won't fire, a refused action */
export function dryClick(ctx: BaseAudioContext, out: Out, level = 1): void {
  const t = ctx.currentTime;
  burst(ctx, out, t, { type: "bandpass", f: 3000, q: 4, gain: 0.15 * level, decay: 0.015 });
  burst(ctx, out, t + 0.03, { type: "bandpass", f: 2200, q: 4, gain: 0.08 * level, decay: 0.012 });
}

/** a pickup: a short cloth-and-metal shuffle */
export function pickup(ctx: BaseAudioContext, out: Out, level = 1): void {
  const t = ctx.currentTime;
  burst(ctx, out, t, { type: "bandpass", f: 1800, q: 1, gain: 0.12 * level, attack: 0.02, decay: 0.08 });
  tone(ctx, out, t + 0.06, { type: "triangle", f: 1600, fEnd: 1500, gain: 0.04 * level, decay: 0.08 });
}

/** the motion tracker, after Alien: a pure ping with a long tail; `near` 0..1 raises it */
export function trackerPing(ctx: BaseAudioContext, out: Out, level = 1, near = 0): void {
  const t = ctx.currentTime;
  const f = 1050 + near * 250;
  tone(ctx, out, t, { f, gain: 0.12 * level, attack: 0.004, decay: 0.5 });
  tone(ctx, out, t, { f: f * 2, gain: 0.03 * level, attack: 0.004, decay: 0.25 });
}

/** every effect by name, for the preview page and for audio.ts */
export const SFX = {
  rifle,
  ricochet,
  fleshHit,
  crawlerChitter,
  crawlerShriek,
  crawlerDeath,
  bruteGrowl,
  spit,
  acidSplash,
  grenadeThrow,
  explosion,
  turretShot,
  turretServo,
  playerHurt,
  reactorAlarm,
  dryClick,
  pickup,
  trackerPing,
} as const;
export type SfxName = keyof typeof SFX;
