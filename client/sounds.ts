// The sound sheet (/sounds.html): every effect on a button, heard dry or in
// one of the game's rooms, so a sound can be judged before it goes in (user
// 2026-11-05). The ambience beds play on their own toggles.

import { Audio, type Zone } from "./audio.ts";
import { PUNCH, type PunchName, type SfxName, type TakeName } from "./sfx.ts";
import { FIRE_COOLDOWN_MS } from "../shared/protocol.ts";

/** recordings on trial, beside the synthesised sound they'd replace */
const TAKE_ROWS: [TakeName, string][] = [
  ["rifleAR15", "AR-15 / M4 (the game's gun is an M4A1): sharp, light"],
  ["rifleAK", "AK-47: harder, more bark"],
  ["rifleSKS", "SKS: rounder"],
  ["rifleMosin", "Mosin Nagant: a big bolt-action round, the heaviest"],
];
const GROUPS: [string, [SfxName, string][]][] = [
  ["gun", [
    ["rifle", "IN GAME: your rifle and a crewmate's = the SKS recording, heavy (user 2026-11-05)"],
    ["ricochet", "a round off a wall: tick, sometimes a zing"],
    ["fleshHit", "a round into a crawler"],
    ["dryClick", "won't fire (in the lift) / a refused action"],
    ["stampThud", "the PAID stamp on the payslip"],
  ]],
  ["crawlers", [
    ["crawlerChitter", "idle voice, now and then, from where it is"],
    ["crawlerShriek", "when one starts charging you"],
    ["crawlerDeath", "killed: choked squeal, wet slump"],
    ["bruteGrowl", "a brute's voice"],
    ["spit", "a spitter lobbing acid"],
    ["acidSplash", "the acid landing"],
  ]],
  ["grenade and turret", [
    ["grenadeThrow", "pin and throw"],
    ["explosion", "goes off: crack, boom, debris"],
    ["turretShot", "a turret firing (drier, smaller than the rifle)"],
    ["turretServo", "a turret slewing onto a target"],
  ]],
  ["you and the reactor", [
    ["playerHurt", "you take a wound"],
    ["reactorAlarm", "the reactor takes a hit"],
    ["pickup", "picking something up"],
    ["trackerPing", "motion tracker ping (Alien): could mark enemies nearby"],
  ]],
  ["out of the game, waiting on a recording", [
    ["bump", "synthesised: something bumped (read as an instrument)"],
    ["drop", "synthesised: something dropped, clattering"],
  ]],
];
const ROOMS: [Zone, string][] = [["core", "core (big)"], ["corridor", "corridor"], ["lab", "lab"], ["car", "lift car"], ["shaft", "freight shaft"], ["surface", "garden"]];

const audio = new Audio({ previewOnly: true });
let zone: Zone = "core";
const sheet = document.getElementById("sheet")!;
sheet.innerHTML =
  "<h1>Sound sheet</h1><p class=\"note\">Every effect, synthesised. Pick the room it's heard in, then click. Ambience plays only if you turn it on.</p>";
const rooms = document.createElement("div");
rooms.className = "rooms";
const roomButtons: HTMLButtonElement[] = [];
for (const [z, label] of ROOMS) {
  const b = document.createElement("button");
  b.textContent = label;
  b.onclick = () => {
    zone = z;
    audio.setZone(z);
    roomButtons.forEach((x) => x.classList.toggle("on", x === b));
  };
  if (z === zone) b.classList.add("on");
  roomButtons.push(b);
  rooms.append(b);
}
const bed = document.createElement("button");
bed.textContent = "ambience: off";
bed.onclick = () => {
  const on = audio.toggleBeds();
  bed.textContent = on ? "ambience: on" : "ambience: off";
};
rooms.append(bed);
sheet.append(rooms);
const trial = document.createElement("h2");
trial.textContent = "gun: recordings on trial (CC0, The Free Firearm Sound Library), each at three strengths";
sheet.append(trial);
const PUNCHES: PunchName[] = ["raw", "punchy", "heavy"];
for (const [name, what] of TAKE_ROWS) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `<b>${name}</b><span class="what">${what}</span>`;
  const buttons = document.createElement("span");
  buttons.style.display = "flex";
  buttons.style.gap = "6px";
  buttons.style.flexWrap = "wrap";
  for (const p of PUNCHES) {
    const one = document.createElement("button");
    one.textContent = `${p}`;
    one.onclick = () => audio.playTake(name, 1, PUNCH[p]);
    const five = document.createElement("button");
    five.textContent = "×5";
    // at the game's fire rate
    five.onclick = () => [0, 1, 2, 3, 4].forEach((i) => setTimeout(() => audio.playTake(name, 1, PUNCH[p]), i * FIRE_COOLDOWN_MS));
    buttons.append(one, five);
  }
  row.append(buttons);
  sheet.append(row);
}
const groans = document.createElement("h2");
groans.textContent = "the structure groaning (public domain, SoundBible: Submarine Creaking)";
sheet.append(groans);
for (const [label, what, play] of [
  ["groan raw", "as recorded: a submarine hull creaking, three cuts at random", () => audio.playTake("groan")],
  ["groan near", "slowed a quarter (deeper), dulled a little, off to a side", () => audio.groan(0)],
  ["groan far", "slowed more, much duller and quieter: somewhere else in the facility", () => audio.groan(1)],
] as const) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `<b>${label}</b><span class="what">${what}</span>`;
  const b = document.createElement("button");
  b.textContent = "▶ play";
  b.onclick = play;
  row.append(b);
  sheet.append(row);
}
const louder = document.createElement("h2");
louder.textContent = "louder kill and grenade: recorded (CC0), pick one each (the game plays 'boom full' and 'bug + splat' for now)";
sheet.append(louder);
for (const [label, what, play] of [
  ["boom full", "cannon body + firework bang + low boom, layered", () => audio.playMix("boomFull", 1.2)],
  ["boom bang", "a firework bang alone, pushed", () => audio.playMix("boomBang", 1.2)],
  ["boom cannon", "a cannon shot alone, pushed", () => audio.playMix("boomCannon", 1.2)],
  ["old explosion", "the synthesised one, for comparison", () => audio.playSynth("explosion")],
  ["old kill", "the synthesised crawler death, for comparison", () => audio.playSynth("crawlerDeath")],
  ["bug + splat", "an insect squeal over a wet splat (3 squeals, 3 splats, random)", () => audio.playMix("dieBugSplat", 1.2)],
  ["alien + splat", "an alien cry over a wet splat", () => audio.playMix("dieAlienSplat", 1.2)],
  ["splat only", "just the wet splat, heavier", () => audio.playMix("dieSplat", 1.2)],
] as const) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `<b>${label}</b><span class="what">${what}</span>`;
  const b = document.createElement("button");
  b.textContent = "▶ play";
  b.onclick = play;
  row.append(b);
  sheet.append(row);
}
const start = document.createElement("h2");
start.textContent = "the reactor spinning up: machine recordings (CC0) running faster and faster, one continuous curve";
sheet.append(start);
// the in-game one: the reactor as the game drives it, heard from beside it (setEar puts the ear there)
const IN_GAME_REACTOR: [string, string, () => void][] = [
  ["in game: start", "all four machines rising together, then only the volume drops to a hum (as in the game; pick a room below ground, e.g. core)", () => {
    audio.setEar(0, 0);
    audio.setReactor(true, { x: 0, z: 0 });
  }],
  ["in game: stop", "the reactor going off: winds down", () => audio.setReactor(false, { x: 0, z: 0 })],
];
const SPIN_ROWS: [string, string, () => void][] = [
  ...IN_GAME_REACTOR,
  ["generator", "a low motor (8 s up, holds 2 s)", () => audio.spinUp("generator")],
  ["boiler", "a metal, steamy machine loop", () => audio.spinUp("boiler")],
  ["fan", "a fan's blades: the beat you hear speed up", () => audio.spinUp("fan")],
  ["disk", "a hard disk's spin: thin, mechanical", () => audio.spinUp("disk")],
  ["generator + fan", "the generator's weight under the fan's whirr", () => audio.spinUp("generatorFan")],
  ["boiler + disk", "the boiler's metal under the disk's spin", () => audio.spinUp("boilerDisk")],
  ["power-on ×1", "a machine power-off, reversed (2 s, as recorded)", () => audio.powerOn(1)],
  ["power-on ×3", "the same, stretched to 6 s: slower, deeper", () => audio.powerOn(3)],
];
for (const [name, what, play] of SPIN_ROWS) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `<b>${name}</b><span class="what">${what}</span>`;
  const b = document.createElement("button");
  b.textContent = "▶ play";
  b.onclick = play;
  row.append(b);
  sheet.append(row);
}
for (const [title, list] of GROUPS) {
  const h = document.createElement("h2");
  h.textContent = title;
  sheet.append(h);
  for (const [name, what] of list) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<b>${name}</b><span class="what">${what}</span>`;
    const play = document.createElement("button");
    play.textContent = "▶ play";
    play.onclick = () => audio.play(name);
    if (name === "rifle") {
      const burst = document.createElement("button");
      burst.textContent = "▶ ×5";
      burst.onclick = () => [0, 1, 2, 3, 4].forEach((i) => setTimeout(() => audio.play(name), i * FIRE_COOLDOWN_MS));
      const both = document.createElement("span");
      both.style.display = "flex";
      both.style.gap = "6px";
      both.append(play, burst);
      row.append(both);
    } else row.append(play);
    sheet.append(row);
  }
}
audio.setZone(zone);

// the freight machinery (ADR-080): each runs for a few seconds the way the game drives it
const freight = document.createElement("h2");
freight.textContent = "IN GAME: the freight lift's blast door and winch (CC0 machine loops slowed down), and the clunk";
sheet.append(freight);
const runMachine = (name: "blastDoor" | "winch", ms: number): void => {
  audio.setMachine(name, 1);
  setTimeout(() => audio.setMachine(name, 0), ms);
};
for (const [label, what, play] of [
  ["blast door", "grinding open (4 s here, 9 s in game), then seating with a clunk", () => { runMachine("blastDoor", 4000); setTimeout(() => audio.clunk(), 4000); }],
  ["winch", "the platform lurching off with a clunk, then grinding up (6 s here, the whole settlement in game)", () => { audio.clunk(0.8); runMachine("winch", 6000); }],
  ["clunk", "the door seating / the platform lurching off", () => audio.clunk()],
] as const) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `<b>${label}</b><span class="what">${what}</span>`;
  const b = document.createElement("button");
  b.textContent = "▶ play";
  b.onclick = play;
  row.append(b);
  sheet.append(row);
}

// On trial for the blast door opening (user 2026-11-08): the facility's power
// coming on, an engineering warning while the door moves, and a louder door.
// Recordings from OpenGameArt (all CC0; sources in public/sfx/CREDITS.md once picked)
// and synthesised warnings beside them. Pick one of each.
const repeat = (n: number, gap: number, f: () => void): void => {
  for (let k = 0; k < n; k++) setTimeout(f, k * gap);
};
const TRIAL: [string, [string, string, () => void][]][] = [
  ["on trial: the whole facility's power coming on (at the win, before the door moves)", [
    ["A breaker", "a real circuit breaker slamming on (CleytonKauffman)", () => void audio.playFile("sfx/trial_power_breakeron.wav", 2.5)],
    ["B charge swell", "an electric charge-up swell, 6 s (faxcorp)", () => void audio.playFile("sfx/trial_power_chargestart.wav", 1)],
    ["C power-up", "a short electric power-up (faxcorp)", () => void audio.playFile("sfx/trial_power_powerup.wav", 1)],
    ["D breaker + swell", "A then B half a second later: the slam, then the facility humming up", () => { void audio.playFile("sfx/trial_power_breakeron.wav", 2.5); setTimeout(() => void audio.playFile("sfx/trial_power_chargestart.wav", 0.9), 400); }],
  ]],
  ["on trial: the engineering warning while the door moves (heard 3 times here, repeats in game)", [
    ["A horn (synth)", "a low two-tone industrial horn, like a crane or a big door", () => repeat(3, 1500, () => audio.play("alarmHorn"))],
    ["B beeper (synth)", "a reversing-truck beeper", () => repeat(5, 900, () => audio.play("alarmBeeper"))],
    ["C PA chime (synth)", "a three-note attention chime, like a public address", () => repeat(2, 2200, () => audio.play("alarmChime"))],
    ["D alarm loop 1", "recorded alarm loop (rubberduck)", () => repeat(3, 1980, () => void audio.playFile("sfx/trial_alarm_loop01.wav", 1))],
    ["E alarm loop 3", "recorded alarm loop (rubberduck)", () => repeat(4, 1054, () => void audio.playFile("sfx/trial_alarm_loop03.wav", 1))],
    ["F short alarm", "recorded short alarm, more sci-fi (yd)", () => repeat(3, 1800, () => void audio.playFile("sfx/trial_alarm_short.wav", 1))],
  ]],
  ["on trial: a louder blast door (layered over the grind already in game, or replacing it)", [
    ["A powered door", "a powered door opening, 2 s (Spring Spring)", () => void audio.playFile("sfx/trial_door_various.wav", 1.4)],
    ["B old lift door", "a dirty old metal lift door, 3 s (sinny), as recorded", () => void audio.playFile("sfx/trial_door_elevator.wav", 1.4)],
    ["B1 heavy, half speed", "B at 0.5x (6.3 s, an octave down), low end up, top dulled", () => void audio.playHeavy("sfx/trial_door_elevator.wav", { rate: 0.5 })],
    ["B2 heavier, 0.4x", "B at 0.4x (7.9 s, about the door's 9 s), plus a copy an octave below for weight", () => void audio.playHeavy("sfx/trial_door_elevator.wav", { rate: 0.4, sub: 0.5 })],
    ["B3 heaviest, 0.33x", "B at 0.33x (9.5 s, the whole opening), darker, more weight underneath", () => void audio.playHeavy("sfx/trial_door_elevator.wav", { rate: 0.33, sub: 0.7, lowpass: 1100, low: 11 })],
    ["B2 + grind + clunk", "B2 over the in-game grind, ending on the clunk: how it would sound in game", () => { void audio.playHeavy("sfx/trial_door_elevator.wav", { rate: 0.4, sub: 0.5 }).then((d) => setTimeout(() => { audio.setMachine("blastDoor", 0); audio.clunk(1.4); }, d * 1000)); audio.setMachine("blastDoor", 0.6); }],
    ["C construction rumble", "heavy machinery rumble bed, 8 s (rubberduck)", () => void audio.playFile("sfx/trial_door_construction.wav", 1.2)],
    ["D metal door", "a metal door opening, short (rubberduck)", () => void audio.playFile("sfx/trial_door_metalopen.wav", 2)],
    ["E in-game grind (now louder)", "the grind in game, raised to 1.6 and brighter, with the stronger clunk at the end", () => { audio.setMachine("blastDoor", 1); setTimeout(() => { audio.setMachine("blastDoor", 0); audio.clunk(1.4); }, 4000); }],
  ]],
];
for (const [head, rows] of TRIAL) {
  const h = document.createElement("h2");
  h.textContent = head;
  sheet.append(h);
  for (const [label, what, play] of rows) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<b>${label}</b><span class="what">${what}</span>`;
    const b = document.createElement("button");
    b.textContent = "▶ play";
    b.onclick = play;
    row.append(b);
    sheet.append(row);
  }
}
