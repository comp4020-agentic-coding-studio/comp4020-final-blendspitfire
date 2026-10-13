import * as THREE from "three";
import { connect } from "./net.ts";
import { CAMERA_ALTITUDE, CAMERA_FOV, configureRenderer, createTorch, glow, lampHalos, setupLighting } from "./look.ts";
import { createPostProcess } from "./postprocess.ts";
import { GRADE } from "./assets/grade.ts";
import { VisibilityMask, canSee, sightBlockers } from "./visibility.ts";
import { buildYardGuides } from "./floorGuides.ts";
import {
  GUN_REST_HEIGHT,
  HELD_GUN_OFFSET,
  SHOULDER_LAMP,
  character,
  equipmentCase,
  gun,
  heldGun,
} from "./models/index.ts";
import { REACTOR_LIVE, REACTOR_STANDBY, buildFacility, reactorCore } from "./models/facility.ts";
import { mesh } from "./models/kit.ts";
import { LAMPS, LAMP_SPECS } from "./world/dressing.ts";
import { ACCENT, STENCIL, DANGER, OK, EMIT_GREEN, EMIT_RED } from "../shared/palette.ts";
import {
  BOX_HALF_EXTENT,
  BREACHES,
  DOORWAYS,
  FACILITY_HALF,
  FACILITY_WALL_HALF_HEIGHT,
  FIXTURES,
  GATE,
  REACTOR,
  SIGHT_BOUNDS,
  SOLID,
  WALLS,
  ZONE_RECTS,
  BROADCAST_INTERVAL_MS,
  FIRE_COOLDOWN_MS,
  ITEM_KINDS,
  OBSTACLES,
  PICKUP_RANGE,
  PLACE_RANGE,
  PROJECTILE_SPEED,
  activateVerdict,
  clampToPlayBounds,
  hasPassedGate,
  isInYard,
  obstaclesFor,
  placementVerdict,
  resolveObstacles,
  snapToGrid,
  worldObstacles,
  type ItemState,
  type ObjectiveState,
  type Obstacle,
  type PlacementVerdict,
  type PlayerState,
  type ProjectileState,
} from "../shared/protocol.ts";

function showFatalError(message: string): void {
  const el = document.getElementById("fatal-error")!;
  el.querySelector("div")!.textContent = message;
  el.style.display = "flex";
}

// A WebGLRenderer construction failure (hardware acceleration disabled by
// device policy, a locked-down lab machine, a VM/remote desktop with no GPU
// passthrough) otherwise throws silently at module load and the visitor
// just sees a blank page with no explanation. Check first, so there's
// something on screen either way.
function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

if (!hasWebGL()) {
  showFatalError(
    "This browser or device can't create a WebGL context, so the 3D scene can't render here. Try enabling hardware acceleration, or a different browser or device.",
  );
  throw new Error("WebGL unavailable");
}

const scene = new THREE.Scene();

// Perspective camera, but positioned directly overhead and looking straight
// down --- no tilt, no angled follow. Perspective (rather than orthographic)
// means distance still reads normally, and wall faces show at the edges of
// the view; it's the angle, not the projection, that's fixed.
const camera = new THREE.PerspectiveCamera(CAMERA_FOV, window.innerWidth / window.innerHeight, 0.1, 100);
camera.up.set(0, 0, -1);

const params = new URLSearchParams(location.search);
// The internal render size as a fraction of the window: a retro pixel grid
// (see client/postprocess.ts), tuned by eye --- 0.42 keeps a player and a
// dropped item clearly distinct at a glance. ?pixel=0 turns it off.
const PIXEL_SCALE = params.get("pixel") === "0" ? 1 : 0.42;

let renderer: THREE.WebGLRenderer;
try {
  // antialias is pointless once the low-res target is nearest-upscaled --- a
  // smoothed edge at 480p just gets blown back up into a blurry one
  renderer = new THREE.WebGLRenderer({ antialias: false });
} catch {
  showFatalError(
    "This browser or device can't create a WebGL context, so the 3D scene can't render here. Try enabling hardware acceleration, or a different browser or device.",
  );
  throw new Error("WebGLRenderer construction failed");
}
configureRenderer(renderer);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
const post = createPostProcess(renderer, PIXEL_SCALE, GRADE);
post.setSize(window.innerWidth, window.innerHeight);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
});

// --- The static world ------------------------------------------------------

const lighting = setupLighting(scene, REACTOR);
const torch = createTorch(scene);
scene.add(
  buildFacility({
    zones: ZONE_RECTS,
    walls: WALLS,
    doorways: DOORWAYS,
    solids: SOLID,
    fixtures: FIXTURES,
    breaches: BREACHES,
    lamps: LAMPS,
    wallHeight: FACILITY_WALL_HALF_HEIGHT * 2,
  }),
);
scene.add(lampHalos());
scene.add(buildYardGuides());

// The reactor's core window glows dim red on standby and blue once live.
const coreMaterial = new THREE.MeshBasicMaterial({ color: REACTOR_STANDBY });
const core = new THREE.Mesh(reactorCore(), coreMaterial);
core.position.set(REACTOR.x, 0, REACTOR.z);
scene.add(core);
const coreHalo = glow(REACTOR_STANDBY, 3.2, 0.5);
coreHalo.position.set(REACTOR.x, 2.1, REACTOR.z);
scene.add(coreHalo);
let objective: ObjectiveState = { active: false };

const visibility = new VisibilityMask(sightBlockers(WALLS, FIXTURES), SOLID, SIGHT_BOUNDS);
post.setMask(visibility.postMask(FACILITY_WALL_HALF_HEIGHT * 2 - 0.05));

// The one-way gate, drawn for this viewer: open (green) until they're
// through, then shut (red) behind them.
const gateGroup = new THREE.Group();
const gateBar = mesh(new THREE.BoxGeometry(GATE.halfX * 2, 0.14, 0.14).toNonIndexed(), "glossy");
const gateBarColour = new THREE.Color(0x8a8f94);
const barColours = new Float32Array(gateBar.geometry.attributes.position.count * 3);
for (let i = 0; i < barColours.length; i += 3) gateBarColour.toArray(barColours, i);
gateBar.geometry.setAttribute("color", new THREE.BufferAttribute(barColours, 3));
gateBar.geometry.computeVertexNormals();
gateGroup.add(gateBar);
const gateLampMaterial = new THREE.MeshBasicMaterial({ color: EMIT_GREEN });
for (const side of [-1, 1]) {
  const l = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), gateLampMaterial);
  l.position.set(side * (GATE.halfX + 0.05), 1.9, 0);
  gateGroup.add(l);
}
gateGroup.position.set(GATE.x, 0, GATE.z);
scene.add(gateGroup);
let gateWasShut = false;
function updateGate(shut: boolean): void {
  // the bar slides down into place once you're through
  const target = shut ? 0.9 : 2.2;
  gateBar.position.y += (target - gateBar.position.y) * 0.15;
  gateLampMaterial.color.setHex(shut ? EMIT_RED : EMIT_GREEN);
  if (shut && !gateWasShut) flash("the gate shuts behind you");
  gateWasShut = shut;
}

// --- Players ---------------------------------------------------------------

interface RemotePlayer {
  mesh: THREE.Object3D;
  target: THREE.Vector3;
  targetRotation: number;
}

let myId: string | undefined;
let localMesh: THREE.Object3D | undefined;
let myRespawnAt = 0;
/** through the gate (as the server sees it); shuts the gate behind us */
let myEntered = false;
const remotes = new Map<string, RemotePlayer>();
const respawnEl = document.getElementById("respawn")!;
const leaderboardEl = document.getElementById("leaderboard")!;
const connectionLostEl = document.getElementById("connection-lost")!;
const controlsEl = document.getElementById("controls")!;
const tipEl = document.getElementById("tip")!;

function isDead(): boolean {
  return Date.now() < myRespawnAt;
}

function makeCharacter(color: string, mine: boolean): THREE.Object3D {
  const mesh = character(color);
  // the shoulder lamp's halo: the one vivid thing on a player, so they're findable in the dark
  const halo = glow(new THREE.Color(color).getHex(), 0.7, 0.8);
  halo.position.set(SHOULDER_LAMP.x, SHOULDER_LAMP.y + 0.05, SHOULDER_LAMP.z + 0.1);
  mesh.add(halo);
  if (mine) {
    // a ring in your own colour at your feet, so you can find yourself
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.62, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    mesh.add(ring);
  }
  scene.add(mesh);
  return mesh;
}

// The leaderboard only ever shows who the server currently has connected:
// it's built straight from each state broadcast's player list, so someone
// who disconnects just stops appearing, and a rejoin starts them at 0 again
// (score is in-memory server-side, never persisted).
function renderLeaderboard(players: PlayerState[]): void {
  const sorted = [...players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  leaderboardEl.innerHTML = sorted
    .map((p) => {
      const mine = p.id === myId;
      return `<div class="row${mine ? " me" : ""}">
        <span class="swatch" style="background:${p.color}"></span>
        <span>${mine ? "you" : "player"}</span>
        <span class="score">${p.score ?? 0}</span>
      </div>`;
    })
    .join("");
}

// --- Aim -------------------------------------------------------------------

const pressed = new Set<string>();
window.addEventListener("keydown", (e) => pressed.add(e.key.toLowerCase()));
window.addEventListener("keyup", (e) => pressed.delete(e.key.toLowerCase()));
// a key released while the window is in the background never sends keyup;
// without this the player keeps walking after alt-tabbing back
window.addEventListener("blur", () => pressed.clear());

// Aim is mouse-driven and independent of movement: the character always
// faces the cursor's position on the ground, WASD only translates it.
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const pointerNDC = new THREE.Vector2(0, 0);
const pointerPx = { x: 0, y: 0 };
let aimRotation = 0;
/** where the cursor currently lands on the ground */
const aimPoint = new THREE.Vector3();

window.addEventListener("pointermove", (e) => {
  pointerNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointerNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
  pointerPx.x = e.clientX;
  pointerPx.y = e.clientY;
});

function updateAim(): void {
  if (!localMesh) return;
  raycaster.setFromCamera(pointerNDC, camera);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(groundPlane, hit)) return;
  aimPoint.copy(hit);
  const dx = hit.x - localMesh.position.x;
  const dz = hit.z - localMesh.position.z;
  if (Math.hypot(dx, dz) < 0.05) return; // cursor right on top of the player: keep the last aim
  aimRotation = Math.atan2(dx, dz);
  localMesh.rotation.y = aimRotation;
}

// --- Items -----------------------------------------------------------------
// Every pickup-able thing shares one representation (ItemState) and one
// set of rules; only the models and what its actions do differ by kind.
// Each item has two models: how it lies in the world, and how it's held.

interface ClientItem {
  state: ItemState;
  lying: THREE.Mesh;
  held: THREE.Mesh;
  outline: THREE.Mesh;
}

const items = new Map<string, ClientItem>();
/** walls, rocks, and boxes on the ground, as of the last state broadcast */
let obstacles: Obstacle[] = OBSTACLES;
/** a box's secondary action toggles this; it stays put between boxes */
let gridSnap = false;

const outlineInReach = new THREE.MeshBasicMaterial({ color: ACCENT, side: THREE.BackSide, transparent: true });
const outlineOutOfReach = new THREE.MeshBasicMaterial({
  color: STENCIL,
  side: THREE.BackSide,
  transparent: true,
  opacity: 0.35,
});

/** a stable angle per item, so loose guns don't all lie parallel */
function restingAngle(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h >>> 0) % 628) / 100;
}

function makeItem(state: ItemState): ClientItem {
  let lying: THREE.Mesh;
  let held: THREE.Mesh;
  if (state.kind === "gun") {
    lying = gun();
    lying.position.y = GUN_REST_HEIGHT;
    lying.rotation.y = restingAngle(state.id);
    held = heldGun();
    held.position.set(HELD_GUN_OFFSET.x, HELD_GUN_OFFSET.y, HELD_GUN_OFFSET.z);
  } else {
    lying = equipmentCase();
    held = equipmentCase();
    // carried in front, in both arms, at a smaller size so it doesn't hide the carrier
    held.scale.setScalar(0.55);
    held.position.set(0, 0.62, 0.5);
  }
  const outline = new THREE.Mesh(lying.geometry, outlineInReach);
  outline.scale.setScalar(state.kind === "gun" ? 1.18 : 1.1);
  if (state.kind === "box") outline.position.y = -0.05;
  outline.visible = false;
  lying.add(outline);
  scene.add(lying);
  return { state, lying, held, outline };
}

function removeItem(item: ClientItem): void {
  scene.remove(item.lying);
  item.held.removeFromParent();
}

function updateItems(incoming: ItemState[]): void {
  const seen = new Set<string>();
  for (const state of incoming) {
    seen.add(state.id);
    const existing = items.get(state.id);
    if (existing) existing.state = state;
    else items.set(state.id, makeItem(state));
  }
  for (const [id, item] of items) {
    if (!seen.has(id)) {
      removeItem(item);
      items.delete(id);
    }
  }
  obstacles = worldObstacles(incoming);
}

function myHeldItem(): ClientItem | undefined {
  if (!myId) return undefined;
  for (const item of items.values()) if (item.state.heldBy === myId) return item;
  return undefined;
}

/**
 * The ground item the cursor is over, and whether it's in reach. Matched
 * by distance from the cursor's ground point rather than by ray-hitting the
 * mesh itself, so a small item doesn't need a pixel-precise click ---
 * which matters on a trackpad. Out-of-reach items still count as hovered,
 * so they can say "move closer" instead of ignoring the player.
 */
const HOVER_RADIUS = 0.9;
function hoveredItem(): { item: ClientItem; inReach: boolean } | undefined {
  if (!localMesh) return undefined;
  let best: ClientItem | undefined;
  let bestDist = HOVER_RADIUS;
  for (const item of items.values()) {
    const { state } = item;
    if (state.heldBy !== undefined) continue;
    const d = Math.hypot(state.x - aimPoint.x, state.z - aimPoint.z);
    if (d < bestDist) {
      best = item;
      bestDist = d;
    }
  }
  if (!best) return undefined;
  const reach = Math.hypot(best.state.x - localMesh.position.x, best.state.z - localMesh.position.z);
  return { item: best, inReach: reach <= PICKUP_RANGE };
}

/**
 * Where a held box would land: the cursor's ground point, pulled in to
 * placement range, then snapped if grid snap is on. Pulled in a bit
 * further when snapping, so rounding to the grid can't push a spot that
 * looked in range back out of it.
 */
function boxTarget(): { x: number; z: number } {
  const origin = localMesh!.position;
  let dx = aimPoint.x - origin.x;
  let dz = aimPoint.z - origin.z;
  const dist = Math.hypot(dx, dz);
  const maxDist = gridSnap ? PLACE_RANGE - 0.75 : PLACE_RANGE - 0.01;
  if (dist > maxDist) {
    dx *= maxDist / dist;
    dz *= maxDist / dist;
  }
  let x = origin.x + dx;
  let z = origin.z + dz;
  if (gridSnap) {
    x = snapToGrid(x);
    z = snapToGrid(z);
  }
  return { x, z };
}

function boxVerdict(target: { x: number; z: number }): PlacementVerdict {
  const bodies: { x: number; z: number }[] = [];
  if (localMesh) bodies.push({ x: localMesh.position.x, z: localMesh.position.z });
  for (const remote of remotes.values()) {
    if (remote.mesh.visible) bodies.push({ x: remote.target.x, z: remote.target.z });
  }
  return placementVerdict(target.x, target.z, localMesh!.position, obstacles, bodies);
}

const previewMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false });
const placementPreview = new THREE.Mesh(
  new THREE.BoxGeometry(BOX_HALF_EXTENT * 2, BOX_HALF_EXTENT * 2, BOX_HALF_EXTENT * 2),
  previewMaterial,
);
placementPreview.visible = false;
scene.add(placementPreview);

// shown around the preview while grid snap is on, so "snap" is visible
// rather than just a word in the hint
const snapGrid = new THREE.GridHelper(7, 7, STENCIL, STENCIL);
(snapGrid.material as THREE.Material).transparent = true;
(snapGrid.material as THREE.Material).opacity = 0.3;
snapGrid.visible = false;
scene.add(snapGrid);

/** when the last refused placement happened, for the preview's shake */
let refusedAt = -Infinity;

const hoverRing = new THREE.Mesh(
  new THREE.RingGeometry(0.75, 0.9, 32),
  new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, depthWrite: false }),
);
hoverRing.rotation.x = -Math.PI / 2;
hoverRing.visible = false;
scene.add(hoverRing);

function holderMesh(playerId: string): THREE.Object3D | undefined {
  if (playerId === myId) return localMesh;
  return remotes.get(playerId)?.mesh;
}

function stepItemVisuals(time: number): void {
  const dead = isDead();
  const hovered = dead || myHeldItem() ? undefined : hoveredItem();
  const pulse = 0.6 + 0.4 * Math.sin(time * 6);
  outlineInReach.opacity = pulse;

  for (const item of items.values()) {
    const { state, lying, held, outline } = item;
    const isHovered = hovered?.item === item;
    outline.visible = isHovered;
    if (isHovered) outline.material = hovered.inReach ? outlineInReach : outlineOutOfReach;

    if (state.heldBy === undefined) {
      held.removeFromParent();
      lying.visible = true;
      lying.position.x = state.x;
      lying.position.z = state.z;
      continue;
    }
    lying.visible = false;
    const holder = holderMesh(state.heldBy);
    if (holder && held.parent !== holder) holder.add(held);
    if (!holder) held.removeFromParent();
  }

  hoverRing.visible = !!hovered?.inReach;
  if (hovered?.inReach) {
    hoverRing.position.set(hovered.item.state.x, 0.03, hovered.item.state.z);
    (hoverRing.material as THREE.MeshBasicMaterial).opacity = pulse;
  }

  const held = myHeldItem();
  const showPreview = !dead && !!localMesh && held?.state.kind === "box";
  placementPreview.visible = showPreview;
  snapGrid.visible = showPreview && gridSnap;
  if (showPreview) {
    const target = boxTarget();
    const sinceRefused = time - refusedAt;
    const shake = sinceRefused < 0.3 ? Math.sin(sinceRefused * 60) * 0.12 : 0;
    placementPreview.position.set(target.x + shake, BOX_HALF_EXTENT, target.z);
    previewMaterial.color.setHex(boxVerdict(target) === "ok" ? OK : DANGER);
    snapGrid.position.set(target.x, 0.02, target.z);
  }
}

// --- Cursor, tooltip and control hint ----------------------------------------

let flashText = "";
let flashUntil = 0;
/** briefly explain why something the player just tried didn't happen */
function flash(text: string): void {
  flashText = text;
  flashUntil = performance.now() + 1400;
}

/** whether the cursor is over the reactor (its footprint, padded a little) */
function hoveringReactor(): boolean {
  return Math.abs(aimPoint.x - REACTOR.x) < REACTOR.halfX + 0.3 && Math.abs(aimPoint.z - REACTOR.z) < REACTOR.halfZ + 0.3;
}

const ACTIVATE_TIPS: Record<string, string> = {
  ok: "click to activate the reactor",
  "too far": "move closer",
  "hands full": "hands full — drop it first (Q)",
  "already active": "already active — defend it",
};

function renderPointerFeedback(): void {
  let cursor = "default";
  let tip = "";
  const held = myHeldItem();
  if (localMesh && !isDead()) {
    if (hoveringReactor()) {
      const verdict = activateVerdict(localMesh.position, !!held, objective);
      tip = ACTIVATE_TIPS[verdict];
      if (verdict === "ok") cursor = "pointer";
    } else if (!held) {
      const hovered = hoveredItem();
      if (hovered?.inReach) {
        cursor = "pointer";
        tip = `click to pick up`;
      } else if (hovered) {
        tip = "move closer";
      } else if (myEntered && Math.hypot(aimPoint.x - GATE.x, aimPoint.z - GATE.z) < 2.5) {
        tip = "one way — the safe room is behind you";
      }
    } else if (held.state.kind === "gun") {
      cursor = "crosshair";
      if (isInYard(localMesh.position.x, localMesh.position.z)) tip = "no firing in the safe room";
    } else if (held.state.kind === "box") {
      const verdict = boxVerdict(boxTarget());
      if (verdict !== "ok") tip = verdict;
    }
  }
  if (performance.now() < flashUntil) tip = flashText;
  renderer.domElement.style.cursor = cursor;
  tipEl.textContent = tip;
  tipEl.style.display = tip ? "block" : "none";
  tipEl.style.transform = `translate(${pointerPx.x + 16}px, ${pointerPx.y + 14}px)`;
}

let lastControlsText = "";
function renderControls(): void {
  const held = myHeldItem();
  let text: string;
  if (!held) {
    text = "WASD to move · click an item next to you to pick it up";
  } else {
    const info = ITEM_KINDS[held.state.kind];
    const parts = [`click: ${info.primaryLabel}`];
    if (info.secondaryLabel) {
      const state = held.state.kind === "box" ? ` (${gridSnap ? "on" : "off"})` : "";
      parts.push(`right-click / Space: ${info.secondaryLabel}${state}`);
    }
    parts.push(held.state.kind === "box" ? "Q: place" : "Q: drop");
    text = `WASD to move · ${parts.join(" · ")}`;
  }
  if (text !== lastControlsText) {
    controlsEl.textContent = text;
    lastControlsText = text;
  }
}

// --- Projectiles -------------------------------------------------------------

const projectileMaterial = new THREE.MeshBasicMaterial({ color: ACCENT, toneMapped: false });
const projectileGeometry = new THREE.IcosahedronGeometry(0.15, 0);

function projectileMesh(): THREE.Mesh {
  const mesh = new THREE.Mesh(projectileGeometry, projectileMaterial);
  mesh.add(glow(ACCENT, 0.9));
  return mesh;
}

interface RemoteProjectile {
  mesh: THREE.Mesh;
  target: THREE.Vector3;
}

const projectiles = new Map<string, RemoteProjectile>();

// Locally-predicted shots: spawned the instant you click, so firing doesn't
// wait a full round-trip to show anything. No bounce/obstacle physics ---
// they're a short-lived visual bridge, swapped out for the server's real
// projectile (or expired) well before they'd travel far enough to matter.
interface PendingShot {
  mesh: THREE.Mesh;
  vx: number;
  vz: number;
  createdAt: number;
}
const pendingShots: PendingShot[] = [];
const PENDING_SHOT_TTL_MS = 500;
let lastFireAt = -Infinity;

function clearSceneState(): void {
  if (localMesh) scene.remove(localMesh);
  for (const remote of remotes.values()) scene.remove(remote.mesh);
  remotes.clear();
  for (const proj of projectiles.values()) scene.remove(proj.mesh);
  projectiles.clear();
  for (const shot of pendingShots) scene.remove(shot.mesh);
  pendingShots.length = 0;
  for (const item of items.values()) removeItem(item);
  items.clear();
  obstacles = OBSTACLES;
}

const net = connect({
  onConnectionChange(connected) {
    connectionLostEl.style.display = connected ? "none" : "block";
  },
  onWelcome(you, players) {
    // also fires on every reconnect, so start from a clean scene rather
    // than piling a new set of meshes on top of the last session's
    clearSceneState();
    myId = you.id;
    myRespawnAt = you.respawnAt ?? 0;
    myEntered = !!you.entered;
    localMesh = makeCharacter(you.color, true);
    localMesh.position.set(you.x, 0, you.z);
    for (const p of players) {
      if (p.id !== myId) addOrUpdateRemote(p);
    }
    renderLeaderboard(players);
  },
  onState(players, incomingProjectiles, incomingItems, incomingObjective) {
    const seenPlayers = new Set<string>();
    const myPrevPos = localMesh ? { x: localMesh.position.x, z: localMesh.position.z } : undefined;
    if (incomingObjective.active && !objective.active) showBanner("reactor active — defend it");
    objective = incomingObjective;
    for (const p of players) {
      if (p.id === myId) {
        myRespawnAt = p.respawnAt ?? 0;
        myEntered = !!p.entered;
        // the server is authoritative for respawns: if it moved us further
        // than a single frame could, snap to match (this is how a death
        // shows up, since there's no separate "you died" message)
        if (myPrevPos && Math.hypot(p.x - myPrevPos.x, p.z - myPrevPos.z) > 2 && localMesh) {
          localMesh.position.x = p.x;
          localMesh.position.z = p.z;
        }
        continue;
      }
      seenPlayers.add(p.id);
      addOrUpdateRemote(p);
    }
    for (const [id, remote] of remotes) {
      if (!seenPlayers.has(id)) {
        scene.remove(remote.mesh);
        remotes.delete(id);
      }
    }
    updateProjectiles(incomingProjectiles);
    updateItems(incomingItems);
    renderLeaderboard(players);
  },
});

// A fixed-duration lerp (assume an update every ~66ms, ease over exactly
// that long) stutters on a real network: a late update leaves the
// projectile frozen at its target, then the next one restarts a fresh
// 66ms ease from there. A continuous, distance-proportional ease --- the
// same style already used for remote players, just at a faster rate ---
// doesn't assume any particular arrival cadence, so jitter just looks like
// slightly more or less catch-up instead of a visible stair-step.
const PROJECTILE_LERP_RATE = 20;

function updateProjectiles(incoming: ProjectileState[]): void {
  const seen = new Set<string>();
  for (const p of incoming) {
    seen.add(p.id);
    let proj = projectiles.get(p.id);
    if (!proj) {
      const mesh = projectileMesh();
      mesh.position.set(p.x, 0.9, p.z);
      scene.add(mesh);
      proj = { mesh, target: new THREE.Vector3(p.x, 0.9, p.z) };
      projectiles.set(p.id, proj);
      // the server's real version of a shot we predicted locally has now
      // shown up: drop the oldest placeholder rather than show both
      if (p.ownerId === myId && pendingShots.length > 0) {
        const oldest = pendingShots.shift()!;
        scene.remove(oldest.mesh);
      }
      continue;
    }
    proj.target.set(p.x, 0.9, p.z);
  }
  for (const [id, proj] of projectiles) {
    if (!seen.has(id)) {
      scene.remove(proj.mesh);
      projectiles.delete(id);
    }
  }
}

function stepProjectileInterpolation(dt: number): void {
  for (const proj of projectiles.values()) {
    proj.mesh.position.lerp(proj.target, Math.min(1, dt * PROJECTILE_LERP_RATE));
  }
}

function stepPendingShots(dt: number): void {
  const now = performance.now();
  for (let i = pendingShots.length - 1; i >= 0; i--) {
    const shot = pendingShots[i];
    if (now - shot.createdAt > PENDING_SHOT_TTL_MS) {
      scene.remove(shot.mesh);
      pendingShots.splice(i, 1);
      continue;
    }
    shot.mesh.position.x += shot.vx * dt;
    shot.mesh.position.z += shot.vz * dt;
  }
}

function firePredictedShot(): void {
  if (!localMesh) return;
  // same spawn math as the server's spawnProjectile, purely for immediate
  // visual feedback --- the server's own projectile is still what actually
  // bounces, hits, and scores
  const dirX = Math.sin(aimRotation);
  const dirZ = Math.cos(aimRotation);
  const mesh = projectileMesh();
  mesh.position.set(localMesh.position.x + dirX * 0.8, 0.9, localMesh.position.z + dirZ * 0.8);
  scene.add(mesh);
  pendingShots.push({
    mesh,
    vx: dirX * PROJECTILE_SPEED,
    vz: dirZ * PROJECTILE_SPEED,
    createdAt: performance.now(),
  });
}

// --- Input --------------------------------------------------------------
// Three verbs, each reachable without a right mouse button and without
// holding anything down, since a lot of players are on a laptop trackpad.
// The left hand stays on WASD: its only other keys are the thumb's Space
// and an occasional Q.
//   primary   --- click (or tap-to-click)
//   secondary --- right-click / two-finger click / ctrl+click, or Space
//   drop      --- Q

function primary(): void {
  if (isDead() || !localMesh) return;
  const held = myHeldItem();
  if (hoveringReactor()) {
    const verdict = activateVerdict(localMesh.position, !!held, objective);
    if (verdict === "ok") net.activate();
    else flash(ACTIVATE_TIPS[verdict]);
    return;
  }
  if (!held) {
    const hovered = hoveredItem();
    if (hovered?.inReach) net.pickup(hovered.item.state.id);
    else if (hovered) flash("move closer");
    return;
  }
  if (held.state.kind === "gun") {
    if (isInYard(localMesh.position.x, localMesh.position.z)) {
      flash("no firing in the safe room");
      return;
    }
    const now = performance.now();
    if (now - lastFireAt < FIRE_COOLDOWN_MS) return;
    lastFireAt = now;
    net.primary(aimPoint.x, aimPoint.z);
    firePredictedShot();
  } else if (held.state.kind === "box") {
    const target = boxTarget();
    const verdict = boxVerdict(target);
    if (verdict === "ok") {
      net.primary(target.x, target.z);
    } else {
      refusedAt = clock.elapsedTime;
      flash(`can't place: ${verdict}`);
    }
  }
}

function secondary(): void {
  if (isDead()) return;
  const held = myHeldItem();
  if (held?.state.kind === "box") gridSnap = !gridSnap;
}

function drop(): void {
  if (isDead()) return;
  const held = myHeldItem();
  if (!held) return;
  // a box can't just be let go of where you stand --- it'd land on you ---
  // so dropping one means putting it down at the preview spot
  if (held.state.kind === "box") primary();
  else net.drop();
}

window.addEventListener("pointerdown", (e) => {
  // a click on the page's own links/UI isn't a game action
  if (e.target !== renderer.domElement) return;
  // On a Mac, ctrl+click is the trackpad's right-click: it arrives as a
  // *left* button press with ctrlKey set (plus a contextmenu event), so it
  // has to be caught here or it would fire the primary action as well.
  if (e.button === 2 || (e.button === 0 && e.ctrlKey)) secondary();
  else if (e.button === 0) primary();
});
// the browser's own right-click menu would steal the secondary action
window.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  // Space would otherwise scroll, or "click" whatever link has focus
  if (key === " ") e.preventDefault();
  if (e.repeat) return;
  if (key === " ") secondary();
  else if (key === "q") drop();
});

function addOrUpdateRemote(p: PlayerState): void {
  let remote = remotes.get(p.id);
  if (!remote) {
    remote = { mesh: makeCharacter(p.color, false), target: new THREE.Vector3(), targetRotation: 0 };
    remote.mesh.position.set(p.x, 0, p.z);
    remotes.set(p.id, remote);
  }
  // a big jump is a respawn, not movement: don't slide across the map
  if (Math.hypot(p.x - remote.mesh.position.x, p.z - remote.mesh.position.z) > 4) {
    remote.mesh.position.set(p.x, 0, p.z);
  }
  remote.target.set(p.x, 0, p.z);
  remote.targetRotation = p.rotation;
  // the server only sends respawnAt while someone's dead
  remote.mesh.visible = p.respawnAt === undefined;
}

const SPEED = 6;
// Decoupled from the render loop so the network doesn't get a message per
// animation frame; matches the server's own broadcast cadence.
const MOVE_SEND_INTERVAL_MS = BROADCAST_INTERVAL_MS;
const clock = new THREE.Clock();
let sinceLastSend = Infinity;

function animate(): void {
  const dt = Math.min(clock.getDelta(), 0.1);
  sinceLastSend += dt * 1000;

  if (localMesh) {
    const dead = isDead();

    if (!dead) {
      let dx = 0;
      let dz = 0;
      if (pressed.has("w") || pressed.has("arrowup")) dz -= 1;
      if (pressed.has("s") || pressed.has("arrowdown")) dz += 1;
      if (pressed.has("a") || pressed.has("arrowleft")) dx -= 1;
      if (pressed.has("d") || pressed.has("arrowright")) dx += 1;

      if (dx !== 0 || dz !== 0) {
        const len = Math.hypot(dx, dz);
        dx /= len;
        dz /= len;
        const next = clampToPlayBounds(
          localMesh.position.x + dx * SPEED * dt,
          localMesh.position.z + dz * SPEED * dt,
        );
        // predict the gate shutting the moment we're through, rather than a round-trip later
        if (!myEntered && hasPassedGate(localMesh.position.z)) myEntered = true;
        const resolved = resolveObstacles(next.x, next.z, obstaclesFor(myEntered, obstacles));
        localMesh.position.x = resolved.x;
        localMesh.position.z = resolved.z;
      }

      updateAim();

      if (sinceLastSend >= MOVE_SEND_INTERVAL_MS) {
        net.sendMove({ x: localMesh.position.x, z: localMesh.position.z, rotation: aimRotation });
        sinceLastSend = 0;
      }
    }

    localMesh.visible = !dead;
    respawnEl.style.display = dead ? "block" : "none";
    if (dead) {
      respawnEl.textContent = `${Math.ceil((myRespawnAt - Date.now()) / 1000)}`;
    }

    camera.position.set(localMesh.position.x, CAMERA_ALTITUDE, localMesh.position.z);
    camera.lookAt(localMesh.position.x, 0, localMesh.position.z);
    torch.aim(localMesh.position.x, localMesh.position.z, aimRotation);
    torch.light.visible = !dead;
    visibility.update(renderer, localMesh.position.x, localMesh.position.z);
  }

  const time = clock.elapsedTime;
  const view = localMesh?.position ?? new THREE.Vector3(0, 0, 24);
  lighting.update(view.x, view.z, time, { reactorActive: objective.active }, (lamp) =>
    // a lamp lights the scene only if its light could reach what we see: in sight, or close
    Math.hypot(lamp.x - view.x, lamp.z - view.z) < LAMP_SPECS[lamp.kind].range * 0.5 || canSee(view.x, view.z, lamp.x, lamp.z, visibility.segs),
  );
  const coreColour = objective.active ? REACTOR_LIVE : REACTOR_STANDBY;
  coreMaterial.color.setHex(coreColour);
  coreHalo.material.color.setHex(coreColour);
  coreHalo.material.opacity = objective.active ? 0.7 + 0.2 * Math.sin(time * 2) : 0.3 + 0.15 * Math.sin(time * 1.3);
  updateGate(myEntered);
  gateGroup.visible = true;

  for (const remote of remotes.values()) {
    remote.mesh.position.lerp(remote.target, Math.min(1, dt * 8));
    remote.mesh.rotation.y += angleDiff(remote.mesh.rotation.y, remote.targetRotation) * Math.min(1, dt * 8);
  }

  stepProjectileInterpolation(dt);
  stepPendingShots(dt);
  stepItemVisuals(time);
  renderPointerFeedback();
  renderControls();
  renderDebug(dt);

  post.render(scene, camera);
  requestAnimationFrame(animate);
}

// The objective banner: a line across the top of the screen when the reactor goes live.
const bannerEl = document.createElement("div");
bannerEl.style.cssText =
  "position:fixed;top:14%;left:50%;transform:translateX(-50%);padding:10px 22px;font:700 20px system-ui,sans-serif;letter-spacing:0.08em;color:#e6f0ff;background:rgba(10,14,20,0.75);border:1px solid rgba(90,168,255,0.6);border-radius:4px;pointer-events:none;opacity:0;transition:opacity 0.6s;text-transform:uppercase";
document.body.appendChild(bannerEl);
function showBanner(text: string): void {
  bannerEl.textContent = text;
  bannerEl.style.opacity = "1";
  setTimeout(() => (bannerEl.style.opacity = "0"), 3500);
}

// ?debug: a frame-time readout, for checking performance on a real laptop.
const debugEl = params.has("debug") ? document.createElement("div") : undefined;
if (debugEl) {
  debugEl.style.cssText = "position:fixed;right:10px;top:10px;font:12px ui-monospace,monospace;color:#9fe0a0;background:rgba(0,0,0,0.6);padding:4px 8px;pointer-events:none";
  document.body.appendChild(debugEl);
}
let debugFrames = 0;
let debugTime = 0;
function renderDebug(dt: number): void {
  if (!debugEl) return;
  debugFrames++;
  debugTime += dt;
  if (debugTime < 0.5) return;
  const ms = (debugTime / debugFrames) * 1000;
  debugEl.textContent = `${(1000 / ms).toFixed(0)} fps · ${ms.toFixed(1)} ms · ${renderer.info.render.calls} draws · ${(renderer.info.render.triangles / 1000).toFixed(0)}k tris`;
  debugFrames = 0;
  debugTime = 0;
}

function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

requestAnimationFrame(animate);
