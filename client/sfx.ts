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
  /** machines for the reactor's spin-up (OpenGameArt, CC0), each a seamless loop but poweron */
  spinGenerator: ["spin_generator"],
  spinBoiler: ["spin_boiler"],
  spinFan: ["spin_fan"],
  spinDisk: ["spin_disk"],
  spinPowerOn: ["spin_poweron"],
  /** bangs for the grenade (OpenGameArt, CC0): firework/cannon bangs and a low synthetic boom (Kenney) */
  boomBang: ["boom_bang6", "boom_bang10"],
  boomCannon: ["boom_cannon2"],
  boomLow: ["boom_low1"],
  /** a crawler's death cry (OpenGameArt "80 CC0 creature SFX"): insect squeals and one alien */
  dieBug: ["die_bug1", "die_bug2", "die_bug4"],
  dieAlien: ["die_alien5"],
  /** wet layers under the cry (OpenGameArt, CC0) */
  splat: ["splat_impact", "splat_squish5", "splat_splat"],
} as const;

/**
 * Mixes of recorded takes for one effect (user 2026-11-05: the kill and
 * the grenade weren't loud enough, still synthesised): each layer is a
 * take, its level and punch, and how far after the first it starts.
 * Variants go on the sound sheet first; RECORDED in audio.ts says which
 * one the game plays.
 */
export interface Layer {
  take: TakeName;
  level: number;
  punch?: Punch;
  delay?: number;
}
export const MIXES = {
  /** the cannon's body under a bang's crack, the low boom for the chest */
  boomFull: [
    { take: "boomCannon", level: 0.9, punch: { drive: 2.5, low: 6, sub: 0.9, crack: 0 } },
    { take: "boomBang", level: 0.7 },
    { take: "boomLow", level: 0.8 },
  ],
  /** just a bang, pushed */
  boomBang: [{ take: "boomBang", level: 1, punch: { drive: 3, low: 6, sub: 0.8, crack: 0.3 } }],
  /** just the cannon, pushed */
  boomCannon: [{ take: "boomCannon", level: 1, punch: { drive: 3, low: 6, sub: 0.8, crack: 0.2 } }],
  /** a squeal over a wet splat */
  dieBugSplat: [
    { take: "dieBug", level: 0.9, punch: { drive: 2, low: 0, sub: 0, crack: 0 } },
    { take: "splat", level: 0.8, delay: 0.06 },
  ],
  /** the alien cry over a wet splat */
  dieAlienSplat: [
    { take: "dieAlien", level: 0.9, punch: { drive: 2, low: 0, sub: 0, crack: 0 } },
    { take: "splat", level: 0.8, delay: 0.06 },
  ],
  /** only the splat, heavier */
  dieSplat: [{ take: "splat", level: 1, punch: { drive: 2.5, low: 6, sub: 0.5, crack: 0 } }],
} satisfies Record<string, Layer[]>;
export type MixName = keyof typeof MIXES;

/** play a mix: every layer that's loaded; false if none was */
export function playMix(ctx: BaseAudioContext, out: Out, mix: Layer[], level = 1): boolean {
  let any = false;
  for (const l of mix) {
    if (!l.delay) any = playTake(ctx, out, l.take, level * l.level, l.punch) || any;
    else if (decoded.get(ctx)?.has(TAKES[l.take][0])) {
      any = true;
      setTimeout(() => playTake(ctx, out, l.take, level * l.level, l.punch), l.delay * 1000);
    }
  }
  return any;
}

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
/** a take's (first) buffer, once loaded */
export function takeBuffer(ctx: BaseAudioContext, name: TakeName): AudioBuffer | undefined {
  return decoded.get(ctx)?.get(TAKES[name][0]);
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

/**
 * One hit on a piece of metal, at `t`: a short noise click for the
 * contact and a few inharmonic partials ringing down. Out of the game for
 * now (user 2026-11-05: reads as an instrument; waiting on a recording).
 */
function clank(ctx: BaseAudioContext, out: Out, t: number, f0: number, level: number, ring: number): void {
  burst(ctx, out, t, { type: "bandpass", f: f0 * 3, q: 1.2, gain: 0.35 * level, decay: 0.04 });
  for (const [k, v, d] of [[1, 1, 1], [2.76, 0.6, 0.7], [5.4, 0.35, 0.45], [8.93, 0.2, 0.3]] as const) {
    tone(ctx, out, t, { f: f0 * k * (1 + (Math.random() - 0.5) * 0.02), gain: 0.09 * v * level, decay: ring * d });
  }
}

/** something bumped: one clank, a pipe or a panel */
export function bump(ctx: BaseAudioContext, out: Out, level = 1): void {
  clank(ctx, out, ctx.currentTime + 0.02, 260 + Math.random() * 420, level, 0.5 + Math.random() * 0.7);
}

/** something dropped: a clank, then it bounces and clatters, each bounce sooner and softer */
export function drop(ctx: BaseAudioContext, out: Out, level = 1): void {
  const f0 = 500 + Math.random() * 600;
  let t = ctx.currentTime + 0.02;
  let gap = 0.16 + Math.random() * 0.1;
  let v = 1;
  const n = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) {
    clank(ctx, out, t, f0 * (1 + (Math.random() - 0.5) * 0.08), level * v, 0.25 + 0.2 * v);
    t += gap;
    gap *= 0.62 + Math.random() * 0.12;
    v *= 0.6;
  }
}

// --- The reactor starting --------------------------------------------------
// User 2026-11-05: not a tone sliding up (the synthesised riser read as an
// instrument), but something running faster and faster: one continuous
// spin-up, no stages. Recordings of machines (CC0) looped, their playback
// rate ramped on one smooth curve, so the machine's own pattern (blades,
// a motor's beat) speeds up; a reversed power-off is a power-on as is.

export interface SpinUp {
  /** the loops played together (each at its own level) */
  loops: [TakeName, number][];
  /** seconds from still to full speed */
  rise: number;
  /** playback rate at the start and at full speed */
  from: number;
  to: number;
  /** how long it holds at speed before it fades, seconds */
  hold: number;
}
export const SPINUPS = {
  generator: { loops: [["spinGenerator", 1]], rise: 8, from: 0.2, to: 2.2, hold: 2 },
  boiler: { loops: [["spinBoiler", 1]], rise: 8, from: 0.25, to: 2, hold: 2 },
  fan: { loops: [["spinFan", 1]], rise: 8, from: 0.15, to: 1.8, hold: 2 },
  disk: { loops: [["spinDisk", 1]], rise: 8, from: 0.1, to: 1.6, hold: 2 },
  /** the generator's weight under the fan's whirr */
  generatorFan: { loops: [["spinGenerator", 1], ["spinFan", 0.6]], rise: 8, from: 0.2, to: 2, hold: 2 },
  /** the boiler's metal under the disk's spin */
  boilerDisk: { loops: [["spinBoiler", 1], ["spinDisk", 0.5]], rise: 8, from: 0.2, to: 1.8, hold: 2 },
} satisfies Record<string, SpinUp>;
export type SpinUpName = keyof typeof SPINUPS;

/** one spin-up: each loop's rate climbs from `from` to `to` on one curve (slow to start, quickening), holds, fades */
export function spinUp(ctx: BaseAudioContext, out: Out, level = 1, o: SpinUp = SPINUPS.generator): void {
  const t0 = ctx.currentTime + 0.05;
  const top = t0 + o.rise;
  const end = top + o.hold;
  for (const [name, v] of o.loops) {
    const buf = decoded.get(ctx)?.get(TAKES[name][0]);
    if (!buf) continue;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    // the curve: rate = from * (to/from)^(k^1.4) --- exponential in pitch, eased in, one line
    const n = 64;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = o.from * Math.pow(o.to / o.from, Math.pow(i / (n - 1), 1.4));
    src.playbackRate.setValueCurveAtTime(curve, t0, o.rise);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v * level, t0 + o.rise * 0.5);
    g.gain.setValueAtTime(v * level, end);
    g.gain.exponentialRampToValueAtTime(0.0001, end + 1.5);
    src.connect(g).connect(out);
    src.start(t0, Math.random() * buf.duration);
    src.stop(end + 1.6);
  }
}

/** the reversed power-off: a machine winding up as recorded, stretched to `stretch` times as long */
export function powerOn(ctx: BaseAudioContext, out: Out, level = 1, stretch = 1): void {
  const buf = decoded.get(ctx)?.get(TAKES.spinPowerOn[0]);
  if (!buf) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = 1 / stretch;
  const g = ctx.createGain();
  g.gain.value = level;
  src.connect(g).connect(out);
  src.start();
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
  bump,
  drop,
} as const;
export type SfxName = keyof typeof SFX;
