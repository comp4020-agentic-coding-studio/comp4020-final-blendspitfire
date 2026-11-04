// The sound sheet (/sounds.html): every effect on a button, heard dry or in
// one of the game's rooms, so a sound can be judged before it goes in (user
// 2026-11-05). The ambience beds play on their own toggles.

import { Audio, type Zone } from "./audio.ts";
import { type SfxName, type TakeName } from "./sfx.ts";
import { FIRE_COOLDOWN_MS } from "../shared/protocol.ts";

/** recordings on trial, beside the synthesised sound they'd replace */
const TAKE_ROWS: [TakeName, string][] = [
  ["rifleAR15", "RECORDED: AR-15 / M4 (the game's gun is an M4A1), near, two takes"],
  ["rifleSKS", "RECORDED: SKS, near, two takes: heavier, rounder"],
];
const GROUPS: [string, [SfxName, string][]][] = [
  ["gun", [
    ["rifle", "your rifle and a crewmate's: crack, body thump, short tail"],
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
trial.textContent = "gun: recordings on trial (CC0, The Free Firearm Sound Library)";
sheet.append(trial);
for (const [name, what] of TAKE_ROWS) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `<b>${name}</b><span class="what">${what}</span>`;
  const play = document.createElement("button");
  play.textContent = "▶ play";
  play.onclick = () => audio.playTake(name);
  const burst = document.createElement("button");
  burst.textContent = "▶ ×5";
  // at the game's fire rate
  burst.onclick = () => [0, 1, 2, 3, 4].forEach((i) => setTimeout(() => audio.playTake(name), i * FIRE_COOLDOWN_MS));
  const both = document.createElement("span");
  both.style.display = "flex";
  both.style.gap = "6px";
  both.append(play, burst);
  row.append(both);
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
