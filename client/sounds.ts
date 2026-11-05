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
