// Sound, all synthesised in Web Audio (no files): first the beds that say
// where you are (user 2026-11-05: ambience first, after Alien --- an
// industrial hum, oppressive quiet, the odd groan of the structure), each
// zone with its own room through one convolution reverb. The structure's
// groans are out for now: synthesised they read as a mosquito (user
// 2026-11-05); a CC0 recording may replace them. Effects (client/sfx.ts) go into the same room: play() centred, playAt()
// placed by where they are against the listener (louder near, panned to
// the side they're on, duller far off).
//
// Browsers won't play sound before a gesture, so nothing starts until the
// first click or key; M mutes (remembered per browser).

import { PUNCH, SFX, SPINUPS, loadTakes, playTake, powerOn, spinUp, takeBuffer, type Punch, type SfxName, type SpinUpName, type TakeName } from "./sfx.ts";

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
  /** the place's one-off noises (clanks below) are heard here: not in the sealed lift car (user 2026-11-05) */
  events?: boolean;
}
const ROOMS: Record<Zone, Room> = {
  surface: { wet: 0.08, dry: 1, below: 0, above: 1, tone: 9000 },
  tutorial: { wet: 0.25, dry: 0.9, below: 0, above: 0.45, tone: 2500 },
  core: { wet: 0.55, dry: 0.75, below: 1, above: 0, tone: 4000, events: true },
  corridor: { wet: 0.4, dry: 0.85, below: 0.75, above: 0, tone: 3000, events: true },
  lab: { wet: 0.3, dry: 0.9, below: 0.6, above: 0, tone: 3200, events: true },
  hall: { wet: 0.35, dry: 0.9, below: 0.9, above: 0, tone: 3600, events: true },
  passage: { wet: 0.45, dry: 0.8, below: 0.7, above: 0, tone: 2600, events: true },
  car: { wet: 0.12, dry: 1, below: 0.35, above: 0, tone: 900 },
  shaft: { wet: 0.75, dry: 0.7, below: 0.8, above: 0, tone: 5000, events: true },
};
/** how fast a zone change crossfades, seconds (time constant) */
const GLIDE = 0.6;
const MUTE_KEY = "blendspitfire.muted";
/**
 * The reactor's generator: idle and running playback rates, and its
 * level at the peak of the spin-up and as the hum after (agent's numbers,
 * user 2026-11-05 asked for it to settle, not stop or stay loud); heard
 * fully within REACTOR_NEAR of it, gone by REACTOR_FAR.
 */
const REACTOR_IDLE = 0.15;
const REACTOR_RUN = 1.6;
const REACTOR_PEAK = 0.9;
const REACTOR_HUM = 0.22;
const REACTOR_NEAR = 4;
const REACTOR_FAR = 30;
/** effects fade out with distance: full within NEAR, gone by FAR (world units) */
const NEAR = 3;
const FAR = 26;
/**
 * Effects that are a recording now, not the synthesis (user 2026-11-05:
 * the rifle is the SKS, pushed heavy). The synthesised one stands in
 * until the take has loaded.
 */
const RECORDED: Partial<Record<SfxName, { take: TakeName; punch: Punch }>> = {
  rifle: { take: "rifleSKS", punch: PUNCH.heavy },
};

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
  /** when the next clank below is due (0: just arrived) */
  private nextGroan = 0;
  private nextBird = 0;

  /** the listener's spot and facing-free screen axes: +x is right, +z is down the screen */
  private ear = { x: 0, z: 0 };
  /** the recorded takes, fetched once the context starts */
  private loaded: Promise<void> = Promise.resolve();
  /** the beds playing (the sound sheet starts with them off) */
  private beds = true;

  constructor(opts: { previewOnly?: boolean } = {}) {
    if (opts.previewOnly) this.beds = false;
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
    // the one-off noises run on their own clock, not the render loop's (which stops whenever the tab's hidden)
    window.setInterval(() => this.events(), 250);
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
    this.loaded = loadTakes(ctx);
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

  /** the beds on or off (the sound sheet); returns whether they're on */
  toggleBeds(): boolean {
    this.beds = !this.beds;
    this.apply(false);
    return this.beds;
  }

  /** where the listener is, for placing effects */
  setEar(x: number, z: number): void {
    this.ear.x = x;
    this.ear.z = z;
    this.placeReactor();
  }

  /** an effect at the listener (your own gun, your wound, the UI) */
  play(name: SfxName, level = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.room) return;
    this.sound(ctx, this.room, name, level);
  }

  /** an effect into `out`: its recording if it has one and it's loaded, else the synthesis */
  private sound(ctx: AudioContext, out: AudioNode, name: SfxName, level: number): void {
    const rec = RECORDED[name];
    if (rec && playTake(ctx, out, rec.take, level, rec.punch)) return;
    SFX[name](ctx, out, level);
  }

  /** a recorded take at the listener (the sound sheet) */
  playTake(name: TakeName, level = 1, punch?: Punch): void {
    if (this.ctx && this.room) playTake(this.ctx, this.room, name, level, punch);
  }

  /**
   * The reactor running (user 2026-11-05): the generator recording spins
   * up on one smooth curve when it starts, then settles a little below its
   * peak and stays on as a quiet hum at the reactor --- loud beside it,
   * faint across the facility, gone on the surface --- until it stops,
   * when it winds down. Joining while it's already on, it's just there.
   */
  setReactor(on: boolean, at: { x: number; z: number }): void {
    this.reactorAt = at;
    if (on === this.reactorOn) return;
    this.reactorOn = on;
    void this.loaded.then(() => this.driveReactor());
  }

  private reactorOn = false;
  private reactorAt = { x: 0, z: 0 };
  private reactorSrc?: AudioBufferSourceNode;
  private reactorGain?: GainNode;
  private reactorPan?: StereoPannerNode;
  /** how much of it reaches the listener (distance), 0..1 */
  private get reactorDistance(): GainNode {
    if (!this.reactorDist) this.reactorDist = this.ctx!.createGain();
    return this.reactorDist;
  }
  private reactorDist?: GainNode;
  /** the first time it's on since the page opened: if it's already running, no spin-up */
  private reactorSeen = false;

  private driveReactor(): void {
    const ctx = this.ctx;
    if (!ctx || !this.room) return;
    const buf = takeBuffer(ctx, "spinGenerator");
    if (!buf) return;
    const t = ctx.currentTime;
    if (!this.reactorSrc) {
      this.reactorPan = ctx.createStereoPanner();
      this.reactorGain = ctx.createGain();
      this.reactorGain.gain.value = 0;
      this.reactorSrc = ctx.createBufferSource();
      this.reactorSrc.buffer = buf;
      this.reactorSrc.loop = true;
      this.reactorSrc.playbackRate.value = REACTOR_IDLE;
      this.reactorSrc.connect(this.reactorGain).connect(this.reactorPan).connect(this.reactorDistance).connect(this.room);
      this.reactorSrc.start(t, Math.random() * buf.duration);
    }
    const rate = this.reactorSrc.playbackRate;
    const level = this.reactorGain!.gain;
    rate.cancelScheduledValues(t);
    level.cancelScheduledValues(t);
    rate.setValueAtTime(rate.value, t);
    level.setValueAtTime(level.value, t);
    if (this.reactorOn) {
      const fresh = !this.reactorSeen && rate.value <= REACTOR_IDLE + 0.01;
      this.reactorSeen = true;
      if (fresh || rate.value < REACTOR_RUN * 0.6) {
        // spin up: one curve from slow to past its running speed, then ease back down to it
        const s = SPINUPS.generator;
        const n = 64;
        const curve = new Float32Array(n);
        const from = Math.max(rate.value, s.from);
        for (let i = 0; i < n; i++) curve[i] = from * Math.pow(s.to / from, Math.pow(i / (n - 1), 1.4));
        rate.setValueCurveAtTime(curve, t, s.rise);
        rate.setTargetAtTime(REACTOR_RUN, t + s.rise, 1.2);
        level.linearRampToValueAtTime(REACTOR_PEAK, t + s.rise * 0.6);
        level.setValueAtTime(REACTOR_PEAK, t + s.rise);
        level.setTargetAtTime(REACTOR_HUM, t + s.rise, 1.5);
      } else {
        rate.setTargetAtTime(REACTOR_RUN, t, 0.8);
        level.setTargetAtTime(REACTOR_HUM, t, 0.8);
      }
    } else {
      // wind down: slower and slower, and quiet
      rate.setTargetAtTime(REACTOR_IDLE, t, 1.8);
      level.setTargetAtTime(0, t, 1.6);
    }
  }

  /** each frame: the reactor's hum heard from where the listener is */
  private placeReactor(): void {
    if (!this.reactorPan || !this.ctx) return;
    const dx = this.reactorAt.x - this.ear.x;
    const d = Math.hypot(dx, this.reactorAt.z - this.ear.z);
    // nothing of it reaches the surface, the car or the tutorial
    const below = ROOMS[this.zone].events ? 1 : 0;
    const k = below * (d <= REACTOR_NEAR ? 1 : Math.max(0, 1 - (d - REACTOR_NEAR) / (REACTOR_FAR - REACTOR_NEAR)));
    this.reactorPan.pan.setTargetAtTime(Math.max(-0.7, Math.min(0.7, dx / 14)), this.ctx.currentTime, 0.1);
    this.reactorDistance.gain.setTargetAtTime(k * k, this.ctx.currentTime, 0.15);
  }

  /** the reactor spinning up (one of the variants), at the listener; waits for the recordings */
  spinUp(name: SpinUpName = "generator", level = 1): void {
    void this.loaded.then(() => {
      if (this.ctx && this.room) spinUp(this.ctx, this.room, level, SPINUPS[name]);
    });
  }

  /** the reversed power-off, stretched */
  powerOn(stretch = 1, level = 1): void {
    void this.loaded.then(() => {
      if (this.ctx && this.room) powerOn(this.ctx, this.room, level, stretch);
    });
  }

  /**
   * The structure groaning somewhere off: a recording, slowed (deeper,
   * bigger), dulled and off to one side. `far` 0..1 takes it further away.
   */
  groan(far = 0.5): void {
    const ctx = this.ctx;
    if (!ctx || !this.room) return;
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.5);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2400 - far * 1600;
    lp.connect(pan).connect(this.room);
    playTake(ctx, lp, "groan", 0.9 - far * 0.5, undefined, 0.75 - far * 0.2);
    window.setTimeout(() => {
      lp.disconnect();
      pan.disconnect();
    }, 6000);
  }

  /** an effect at a spot in the world: quieter and duller with distance, panned to its side of the screen */
  playAt(name: SfxName, x: number, z: number, level = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.room) return;
    const dx = x - this.ear.x;
    const d = Math.hypot(dx, z - this.ear.z);
    if (d >= FAR) return;
    const k = d <= NEAR ? 1 : 1 - (d - NEAR) / (FAR - NEAR);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-0.85, Math.min(0.85, dx / 12));
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2500 + 15000 * k * k;
    lp.connect(pan).connect(this.room);
    this.sound(ctx, lp, name, level * k * k);
    // let the nodes go once it's over
    window.setTimeout(() => {
      lp.disconnect();
      pan.disconnect();
    }, 3000);
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
    set(this.below.gain, this.beds ? r.below : 0);
    set(this.above.gain, this.beds ? r.above : 0);
    set(this.bedTone.frequency, r.tone);
  }

  /**
   * The place's one-off sounds, part of the ambience (so off with the beds):
   * below (not in the car) the structure groaning far off (user 2026-11-05:
   * the recording, "far"); the synthesised bump and drop are kept out until
   * they're recordings too (they read as an instrument). Birds above.
   */
  private events(): void {
    const ctx = this.ctx;
    if (!ctx || !this.room || !this.beds) return;
    const t = ctx.currentTime;
    const r = ROOMS[this.zone];
    if (r.events && t > this.nextGroan) {
      // the first a few seconds after arriving, then every 10-25 s (each is a couple of seconds long)
      if (this.nextGroan) this.groan(1);
      this.nextGroan = t + (this.nextGroan ? 10 + Math.random() * 15 : 3 + Math.random() * 3);
    }
    if (!r.events) this.nextGroan = 0;
    if (r.above > 0.5 && t > this.nextBird) {
      if (this.nextBird) this.bird(ctx);
      this.nextBird = t + 3 + Math.random() * 9;
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
