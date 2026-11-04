// Sound, all synthesised in Web Audio (no files): first the beds that say
// where you are (user 2026-11-05: ambience first, after Alien --- an
// industrial hum, oppressive quiet, the odd groan of the structure), each
// zone with its own room through one convolution reverb. Effects (guns,
// crawlers, the lift) come in later batches and go through the same rooms.
//
// Browsers won't play sound before a gesture, so nothing starts until the
// first click or key; M mutes (remembered per browser).

/** which room the listener is in: sets the bed and how much the reverb takes */
export type Zone = "surface" | "tutorial" | "core" | "corridor" | "lab" | "hall" | "passage" | "car" | "shaft";

interface Room {
  /** reverb send 0..1 and the dry level beside it */
  wet: number;
  dry: number;
  /** the underground bed's level (hum + air), and the surface's (wind + birds) */
  below: number;
  above: number;
  /** a low-pass on the bed: small or sealed rooms hear it muffled */
  tone: number;
}
const ROOMS: Record<Zone, Room> = {
  surface: { wet: 0.08, dry: 1, below: 0, above: 1, tone: 9000 },
  tutorial: { wet: 0.25, dry: 0.9, below: 0, above: 0.45, tone: 2500 },
  core: { wet: 0.55, dry: 0.75, below: 1, above: 0, tone: 4000 },
  corridor: { wet: 0.4, dry: 0.85, below: 0.75, above: 0, tone: 3000 },
  lab: { wet: 0.3, dry: 0.9, below: 0.6, above: 0, tone: 3200 },
  hall: { wet: 0.35, dry: 0.9, below: 0.9, above: 0, tone: 3600 },
  passage: { wet: 0.45, dry: 0.8, below: 0.7, above: 0, tone: 2600 },
  car: { wet: 0.12, dry: 1, below: 0.35, above: 0, tone: 900 },
  shaft: { wet: 0.75, dry: 0.7, below: 0.8, above: 0, tone: 5000 },
};
/** how fast a zone change crossfades, seconds (time constant) */
const GLIDE = 0.6;
const MUTE_KEY = "blendspitfire.muted";

function noiseBuffer(ctx: AudioContext, seconds: number, brown = false): AudioBuffer {
  const b = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  return b;
}

/** a big concrete room's impulse: decaying noise, darker as it goes, a few early slaps off the walls */
function impulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const n = Math.round(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const cut = 0.5 - 0.45 * t;
      lp += cut * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.pow(1 - t, 2.6);
    }
    for (const ms of [11, 23, 37, 58]) {
      const at = Math.round((ms + ch * 3) * ctx.sampleRate / 1000);
      if (at < n) d[at] += 0.5;
    }
  }
  return b;
}

export class Audio {
  private ctx?: AudioContext;
  private master?: GainNode;
  private dry?: GainNode;
  private wet?: GainNode;
  private bedTone?: BiquadFilterNode;
  private below?: GainNode;
  private above?: GainNode;
  /** where effects go in: through the room's dry/wet split */
  private room?: GainNode;
  private zone: Zone = "surface";
  private muted = false;
  private nextGroan = 0;
  private nextBird = 0;

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      // storage blocked: start unmuted
    }
    const start = (): void => {
      this.start();
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
    };
    window.addEventListener("pointerdown", start);
    window.addEventListener("keydown", start);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): void {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? "1" : "0");
    } catch {
      // not remembered, still muted for now
    }
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  private start(): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(ctx.destination);
    const verb = ctx.createConvolver();
    verb.buffer = impulse(ctx, 3.2);
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.dry.connect(this.master);
    verb.connect(this.wet).connect(this.master);
    this.room = ctx.createGain();
    this.room.connect(this.dry);
    this.room.connect(verb);
    // the beds, through a tone control into the room
    this.bedTone = ctx.createBiquadFilter();
    this.bedTone.type = "lowpass";
    this.bedTone.connect(this.room);
    this.below = ctx.createGain();
    this.above = ctx.createGain();
    this.below.connect(this.bedTone);
    this.above.connect(this.bedTone);
    this.buildBelow(ctx, this.below);
    this.buildAbove(ctx, this.above);
    this.apply(true);
  }

  /**
   * The plant: mains hum and its harmonics, slowly beating, is the bed
   * (user 2026-11-05: a small hum, mostly); air in the ducts only just
   * under it. The harmonics carry it, since laptop speakers drop 50 Hz.
   */
  private buildBelow(ctx: AudioContext, out: GainNode): void {
    const hum = ctx.createGain();
    hum.gain.value = 0.035;
    hum.connect(out);
    for (const [f, g] of [[50, 0.8], [100, 0.7], [150, 0.45], [200.6, 0.3], [300.4, 0.12]] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(hum);
      o.start();
    }
    // a slow wobble on the hum, like a big motor under load
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lg = ctx.createGain();
    lg.gain.value = 0.01;
    lfo.connect(lg).connect(hum.gain);
    lfo.start();
    // duct air: brown noise, band-passed low, breathing
    const air = ctx.createBufferSource();
    air.buffer = noiseBuffer(ctx, 6, true);
    air.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 320;
    bp.Q.value = 0.6;
    const ag = ctx.createGain();
    ag.gain.value = 0.045;
    air.connect(bp).connect(ag).connect(out);
    air.start();
    const breathe = ctx.createOscillator();
    breathe.frequency.value = 0.07;
    const bg = ctx.createGain();
    bg.gain.value = 0.015;
    breathe.connect(bg).connect(ag.gain);
    breathe.start();
  }

  /** the garden: wind in gusts, a high leaf hiss */
  private buildAbove(ctx: AudioContext, out: GainNode): void {
    const wind = ctx.createBufferSource();
    wind.buffer = noiseBuffer(ctx, 8, true);
    wind.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 700;
    const wg = ctx.createGain();
    wg.gain.value = 0.3;
    wind.connect(lp).connect(wg).connect(out);
    wind.start();
    const gust = ctx.createOscillator();
    gust.frequency.value = 0.09;
    const gg = ctx.createGain();
    gg.gain.value = 300;
    gust.connect(gg).connect(lp.frequency);
    gust.start();
    const leaves = ctx.createBufferSource();
    leaves.buffer = noiseBuffer(ctx, 4);
    leaves.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 5000;
    const lgain = ctx.createGain();
    lgain.gain.value = 0.012;
    leaves.connect(hp).connect(lgain).connect(out);
    leaves.start();
  }

  /** set the listener's room; beds and reverb glide over */
  setZone(zone: Zone): void {
    if (zone === this.zone) return;
    this.zone = zone;
    this.apply(false);
  }

  private apply(now: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.dry || !this.wet || !this.below || !this.above || !this.bedTone) return;
    const r = ROOMS[this.zone];
    const t = ctx.currentTime;
    const set = (p: AudioParam, v: number): void => {
      if (now) p.value = v;
      else p.setTargetAtTime(v, t, GLIDE);
    };
    set(this.dry.gain, r.dry);
    set(this.wet.gain, r.wet);
    set(this.below.gain, r.below);
    set(this.above.gain, r.above);
    set(this.bedTone.frequency, r.tone);
  }

  /** each frame: the one-off sounds of the place (groans and knocks below, birds above) */
  step(): void {
    const ctx = this.ctx;
    if (!ctx || !this.room) return;
    const t = ctx.currentTime;
    const r = ROOMS[this.zone];
    if (r.below > 0.3 && t > this.nextGroan) {
      // the first a few seconds after arriving, then every 8-20 s
      if (this.nextGroan) (Math.random() < 0.5 ? this.groan : this.knock).call(this, ctx, r.below);
      this.nextGroan = t + (this.nextGroan ? 8 + Math.random() * 12 : 3 + Math.random() * 3);
    }
    if (r.below <= 0.3) this.nextGroan = 0;
    if (r.above > 0.5 && t > this.nextBird) {
      if (this.nextBird) this.bird(ctx);
      this.nextBird = t + 3 + Math.random() * 9;
    }
  }

  /**
   * The structure settling: a slow metal moan. A sawtooth bending down
   * through two resonant bands (a big plate's ring, in the range speakers
   * play), with a slight wobble, swelling in and dying away; panned off to
   * one side so it's somewhere else.
   */
  private groan(ctx: AudioContext, level: number): void {
    const t = ctx.currentTime;
    const len = 2.5 + Math.random() * 2;
    const f0 = 90 + Math.random() * 70;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.72, t + len);
    const wob = ctx.createOscillator();
    wob.frequency.value = 5 + Math.random() * 3;
    const wg = ctx.createGain();
    wg.gain.value = f0 * 0.015;
    wob.connect(wg).connect(o.frequency);
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.4);
    pan.connect(this.room!);
    for (const [k, q, v] of [[3.2, 14, 1], [6.1, 18, 0.6]] as const) {
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = q;
      bp.frequency.setValueAtTime(f0 * k, t);
      bp.frequency.exponentialRampToValueAtTime(f0 * k * 0.8, t + len);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.55 * v * level, t + len * 0.35);
      g.gain.linearRampToValueAtTime(0, t + len);
      o.connect(bp).connect(g).connect(pan);
    }
    o.start(t);
    wob.start(t);
    o.stop(t + len + 0.1);
    wob.stop(t + len + 0.1);
  }

  /**
   * Something far off in the pipes: two to four knocks, each a dull thud
   * and the short ring of the pipe it hit (a tuned band on a noise click,
   * up where speakers play), panned off to one side.
   */
  private knock(ctx: AudioContext, level: number): void {
    const n = 2 + Math.floor(Math.random() * 3);
    const ring = 420 + Math.random() * 380;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(this.room!);
    let t = ctx.currentTime;
    for (let i = 0; i < n; i++) {
      t += i ? 0.16 + Math.random() * 0.14 : 0;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 0.4);
      const thud = ctx.createBiquadFilter();
      thud.type = "lowpass";
      thud.frequency.value = 400;
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.5 * level, t);
      tg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      src.connect(thud).connect(tg).connect(pan);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = ring * (1 + (Math.random() - 0.5) * 0.04);
      bp.Q.value = 30;
      const rg = ctx.createGain();
      rg.gain.setValueAtTime(2.2 * level, t);
      rg.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      src.connect(bp).connect(rg).connect(pan);
      src.start(t);
    }
  }

  /** a small bird: a few quick chirps sliding down */
  private bird(ctx: AudioContext): void {
    const n = 2 + Math.floor(Math.random() * 4);
    const base = 2600 + Math.random() * 1800;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(this.room!);
    for (let i = 0; i < n; i++) {
      const t = ctx.currentTime + i * 0.11;
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(base * (1.15 + Math.random() * 0.1), t);
      o.frequency.exponentialRampToValueAtTime(base * 0.85, t + 0.07);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.025, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      o.connect(g).connect(pan);
      o.start(t);
      o.stop(t + 0.1);
    }
  }
}
