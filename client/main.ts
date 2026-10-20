import * as THREE from "three";
import { connect } from "./net.ts";
import { CAMERA_ALTITUDE, CAMERA_FOV, FACILITY_AMBIENT, configureRenderer, createTorch, glow, lampHalos, setupLighting } from "./look.ts";
import { createPostProcess } from "./postprocess.ts";
import { GRADE } from "./assets/grade.ts";
import { VisibilityMask, canSee, sightBlockers } from "./visibility.ts";
import { buildYardGuides } from "./floorGuides.ts";
import { Prompts, type Prompt } from "./ui/prompts.ts";
import { buildSurface, createSunlight, scoreboardScreen } from "./world/surface.ts";
import { LiftDoors, liftPanelAt } from "./world/lift.ts";
import { Gore, Impacts } from "./world/gore.ts";
import {
  GUN_REST_HEIGHT,
  HELD_GUN_OFFSET,
  SHOULDER_LAMP,
  character,
  crawler,
  equipmentCase,
  gun,
  heldGun,
  sentryTurret,
} from "./models/index.ts";
import { REACTOR_LIVE, REACTOR_STANDBY, buildFacility, reactorCore } from "./models/facility.ts";
import { mesh } from "./models/kit.ts";
import { LAMPS, LAMP_SPECS, lampSource } from "./world/dressing.ts";
import { STENCIL, DANGER, OK, EMIT_RED, EMIT_TRACER, AMBIENT_SKY } from "../shared/palette.ts";
import { INTERP_DELAY_MS, ServerClock, SnapshotBuffer, Tracer } from "./netsync.ts";
import { ENEMY_RADIUS, WAVES_TO_WIN, type DefenceState, type EnemyState } from "../shared/enemies.ts";
import {
  BOX_HALF_EXTENT,
  BREACHES,
  DOORWAYS,
  FACILITY_HALF,
  FACILITY_WALL_HALF_HEIGHT,
  FIXTURES,
  REACTOR,
  BUILT_WALLS,
  SURFACE,
  SURFACE_FIXTURES,
  SURFACE_VIEW_MARGIN,
  SCOREBOARD,
  SCOREBOARD_RANGE,
  LIFT_CARS,
  LIFT_DOORS,
  LIFT_RIDE_MS,
  inAnyCar,
  inCar,
  levelOf,
  liftDoorOpen,
  DOOR_HALF_WIDTH,
  liftVerdict,
  noFireAt,
  type LiftState,
  type LiftVerdict,
  SIGHT_BOUNDS,
  SOLID,
  WALLS,
  ZONE_RECTS,
  BROADCAST_INTERVAL_MS,
  FIRE_COOLDOWN_MS,
  ITEM_KINDS,
  BLOCKING_KINDS,
  SUPPLY_TERMINAL,
  SHOP,
  atTerminal,
  buyVerdict,
  type BuyVerdict,
  type ShopItem,
  type ItemKind,
  OBSTACLES,
  PICKUP_RANGE,
  MAX_WOUNDS,
  WOUNDED_AIM_SPREAD,
  AIM_SPREAD,
  WOUNDS,
  woundedSpeed,
  PLACE_RANGE,
  MUZZLE_OFFSET,
  segmentHitsCircle,
  shotRange,
  activateVerdict,
  clampToPlayBounds,
  obstaclesFor,
  placementVerdict,
  resolveObstacles,
  snapToGrid,
  worldObstacles,
  type ItemState,
  type ObjectiveState,
  type Obstacle,
  type PlacementVerdict,
  type BoardMessage,
  type PlayerState,
  type ProjectileState,
  type Report,
  WIPE_HOLD_MS,
  PROJECTILE_SPEED,
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
// (see client/postprocess.ts). At 0.25 the pixels are plainly pixels, and a
// player and a dropped item are still distinct at a glance. ?pixel=0 turns
// it off; ?pixel=0.2 (any fraction) tries another size.
const PIXEL_SCALE = params.get("pixel") === "0" ? 1 : Number(params.get("pixel")) || 0.25;

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
    walls: BUILT_WALLS,
    doorways: DOORWAYS,
    solids: SOLID,
    fixtures: FIXTURES,
    breaches: BREACHES,
    lamps: LAMPS,
    wallHeight: FACILITY_WALL_HALF_HEIGHT * 2,
  }),
);
const halos = lampHalos();
scene.add(halos);
scene.add(buildYardGuides());
scene.add(buildSurface());
const sunlight = createSunlight(scene);
const liftDoors = new LiftDoors();
scene.add(liftDoors.group);
const gore = new Gore();
scene.add(gore.group);
const impacts = new Impacts();
scene.add(impacts.group);
let lift: LiftState = { at: "top", phase: "open" };

// The reactor's core window glows dim red on standby and blue once live.
const coreMaterial = new THREE.MeshBasicMaterial({ color: REACTOR_STANDBY });
const core = new THREE.Mesh(reactorCore(), coreMaterial);
core.position.set(REACTOR.x, 0, REACTOR.z);
scene.add(core);
const coreHalo = glow(REACTOR_STANDBY, 3.2, 0.5);
coreHalo.position.set(REACTOR.x, 2.1, REACTOR.z);
scene.add(coreHalo);
let objective: ObjectiveState = { active: false };

// Line of sight, one mask per level: the facility's walls below; up top the
// lift house and the tall ruins (trees, the scoreboard and the chain-link
// fence are seen through, out to the ruins past it).
const visibility = new VisibilityMask(sightBlockers(WALLS, FIXTURES), SOLID, SIGHT_BOUNDS);
const SURFACE_SIGHT = {
  minX: SURFACE.minX - SURFACE_VIEW_MARGIN,
  maxX: SURFACE.maxX + SURFACE_VIEW_MARGIN,
  minZ: SURFACE.minZ - SURFACE_VIEW_MARGIN,
  maxZ: LIFT_CARS.top.maxZ + 1,
};
const surfaceVisibility = new VisibilityMask(
  sightBlockers(
    BUILT_WALLS.filter((w) => w.z > SURFACE.minZ - 2),
    SURFACE_FIXTURES.filter((f) => f.kind !== "tree" && f.kind !== "scoreboard"),
  ),
  [],
  SURFACE_SIGHT,
);
let activeVisibility = visibility;
let viewLevel: "top" | "bottom" = "bottom";
post.setMask(activeVisibility.postMask(FACILITY_WALL_HALF_HEIGHT * 2 - 0.05));
let lastDoorKey = "";
/**
 * The lift doors block sight leaf by leaf, exactly where they're drawn
 * (client/world/lift.ts): as they slide the gap between them widens or
 * narrows, and so does what you can see through it. Each leaf is clipped to
 * the doorway, and the doorway's edges are padded a little into the wall so
 * sight can't slip round a leaf's outer edge.
 */
function updateSightDoors(): void {
  const now = serverClock.now();
  const leaves: Obstacle[] = [];
  const key: string[] = [];
  const D = DOOR_HALF_WIDTH;
  for (const level of ["top", "bottom"] as const) {
    const door = LIFT_DOORS[level];
    // the open fraction, quantised so the mask is redrawn per few centimetres, not every frame
    const open = Math.round(liftDoorOpen(lift, level, now) * 40) / 40;
    key.push(`${level}${open}`);
    if (open >= 1) continue;
    // a leaf's inner edge sits `gap` from the centre line; its outer edge runs past the doorway into the wall
    const gap = open * D * 0.95;
    const outer = D + 0.4;
    for (const side of [-1, 1]) {
      leaves.push({ x: side * (gap + outer) / 2, z: door.z, halfX: (outer - gap) / 2, halfZ: door.halfZ, halfHeight: door.halfHeight });
    }
  }
  const k = key.join(",");
  if (k === lastDoorKey) return;
  lastDoorKey = k;
  visibility.setExtra(leaves.filter((o) => o.z < SURFACE.minZ));
  surfaceVisibility.setExtra(leaves.filter((o) => o.z > SURFACE.minZ));
}

// The scoreboard in the garden: its little screen, redrawn when the board changes
const scoreboard = scoreboardScreen();
scene.add(scoreboard.mesh);
scoreboard.draw(["waiting for scores…"]);

// --- Players ---------------------------------------------------------------

interface RemotePlayer {
  mesh: THREE.Object3D;
  /** their recent positions, played back INTERP_DELAY_MS in the past */
  snaps: SnapshotBuffer;
  /** where they are drawn this frame (also what box placement keeps clear of) */
  drawn: { x: number; z: number; rotation: number };
  /** alive and down in the facility: someone a spectator can watch */
  watchable: boolean;
}

let myId: string | undefined;
let localMesh: THREE.Object3D | undefined;
let myRespawnAt = 0;
/** out for the rest of this attempt (died while the reactor was live): spectating */
let myOut = false;
/** whose view we're watching while out */
let watchingId: string | undefined;
/** wounds taken since we last (re)spawned, as the server sees it */
let myWounds = 0;
/** patched up with this many wounds: the next hit brings them all back */
let myBandaged = 0;
/** the warp count we've caught up with: moves are stamped with it (see PlayerState.warp) */
let myWarp = 0;
const remotes = new Map<string, RemotePlayer>();
const serverClock = new ServerClock();
const respawnEl = document.getElementById("respawn")!;
const leaderboardEl = document.getElementById("leaderboard")!;
const connectionLostEl = document.getElementById("connection-lost")!;
const controlsEl = document.getElementById("controls")!;
const tipEl = document.getElementById("tip")!;

/**
 * Dead for as long as the server says so --- not until this machine's own
 * clock passes the respawn time. Deciding locally let the client think it
 * was alive a moment early and send a move from where it died, which put it
 * back among whatever had just killed it.
 */
function isDead(): boolean {
  return myRespawnAt !== 0 || myOut;
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

const escapeText = (t: string): string => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

// The room list only ever shows who the server currently has connected:
// it's built straight from each state broadcast's player list, so someone
// who disconnects just stops appearing. Its score is this session's only;
// what lasts is on the arcade board below it.
function renderLeaderboard(players: PlayerState[]): void {
  const sorted = [...players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  leaderboardEl.innerHTML = sorted
    .map((p) => {
      const mine = p.id === myId;
      return `<div class="row${mine ? " me" : ""}">
        <span class="swatch" style="background:${p.color}"></span>
        <span>${escapeText(p.name ?? "player")}${mine ? " (you)" : ""}</span>
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
window.addEventListener("blur", () => {
  pressed.clear();
  triggerHeld = false;
});

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
  lying: THREE.Object3D;
  held: THREE.Object3D;
  outline: THREE.Mesh;
  /** a box: shudders until this (performance.now()) after a bite */
  bittenUntil: number;
}

const items = new Map<string, ClientItem>();
/** walls, rocks, and boxes on the ground, as of the last state broadcast */
let obstacles: Obstacle[] = OBSTACLES;
/** a box's secondary action toggles this; it stays put between boxes */
let gridSnap = false;

const outlineInReach = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, transparent: true });
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
  let lying: THREE.Object3D;
  let held: THREE.Object3D;
  /** the mesh whose shape the hover outline copies */
  let shape: THREE.Mesh;
  if (state.kind === "gun") {
    lying = shape = gun();
    lying.position.y = GUN_REST_HEIGHT;
    lying.rotation.y = restingAngle(state.id);
    held = heldGun();
    held.position.set(HELD_GUN_OFFSET.x, HELD_GUN_OFFSET.y, HELD_GUN_OFFSET.z);
  } else {
    if (state.kind === "turret") {
      lying = sentryTurret();
      shape = lying.children[0] as THREE.Mesh;
      held = sentryTurret();
    } else {
      lying = shape = equipmentCase();
      held = equipmentCase();
    }
    // carried in front, in both arms, at a smaller size so it doesn't hide the carrier
    held.scale.setScalar(0.55);
    held.position.set(0, 0.62, 0.5);
  }
  const outline = new THREE.Mesh(shape.geometry, outlineInReach);
  outline.scale.setScalar(state.kind === "gun" ? 1.18 : 1.1);
  if (state.kind !== "gun") outline.position.y = -0.05;
  outline.visible = false;
  lying.add(outline);
  scene.add(lying);
  return { state, lying, held, outline, bittenUntil: 0 };
}

function removeItem(item: ClientItem): void {
  scene.remove(item.lying);
  item.held.removeFromParent();
}

// A box that's chewed shows it: it shudders at each bite, and slumps and
// tilts further the closer it is to giving way. When it breaks, a puff of
// dust where it stood, so it doesn't just vanish.
const dustPuffs: { sprite: THREE.Sprite; born: number }[] = [];
function boxBroke(x: number, z: number): void {
  const sprite = glow(STENCIL, 1.2, 0.6);
  sprite.position.set(x, 0.4, z);
  scene.add(sprite);
  dustPuffs.push({ sprite, born: performance.now() });
}
function stepDust(): void {
  const now = performance.now();
  for (let i = dustPuffs.length - 1; i >= 0; i--) {
    const p = dustPuffs[i];
    const k = (now - p.born) / 600;
    if (k >= 1) {
      scene.remove(p.sprite);
      dustPuffs.splice(i, 1);
      continue;
    }
    p.sprite.scale.setScalar(1.2 + k * 1.6);
    p.sprite.material.opacity = 0.6 * (1 - k);
  }
}

function updateItems(incoming: ItemState[]): void {
  const seen = new Set<string>();
  for (const state of incoming) {
    seen.add(state.id);
    const existing = items.get(state.id);
    if (existing) {
      if ((state.wear ?? 0) > (existing.state.wear ?? 0)) existing.bittenUntil = performance.now() + 180;
      existing.state = state;
    } else items.set(state.id, makeItem(state));
  }
  for (const [id, item] of items) {
    if (!seen.has(id)) {
      // a chewed box that's gone from the ground broke (rather than being picked up, which keeps it in the list)
      if (BLOCKING_KINDS.has(item.state.kind) && item.state.heldBy === undefined && item.state.wear) boxBroke(item.state.x, item.state.z);
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
    if (remote.mesh.visible) bodies.push({ x: remote.drawn.x, z: remote.drawn.z });
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
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }),
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
  // what's lit up: the item under the cursor, or failing that the one E would pick up
  let hovered = dead || myHeldItem() ? undefined : hoveredItem();
  if (!hovered && !dead) {
    const t = eTarget();
    if (t?.kind === "item") hovered = { item: t.item, inReach: true };
  }
  const pulse = 0.6 + 0.4 * Math.sin(time * 6);
  outlineInReach.opacity = pulse;

  for (const item of items.values()) {
    const { state, lying, held, outline } = item;
    const isHovered = hovered?.item === item;
    outline.visible = isHovered;
    if (hovered && isHovered) outline.material = hovered.inReach ? outlineInReach : outlineOutOfReach;

    if (state.heldBy === undefined) {
      held.removeFromParent();
      lying.visible = true;
      lying.position.x = state.x;
      lying.position.z = state.z;
      if (BLOCKING_KINDS.has(state.kind)) {
        const wear = state.wear ?? 0;
        const shudder = performance.now() < item.bittenUntil ? Math.sin(time * 90) * 0.08 : 0;
        lying.position.x += shudder;
        lying.rotation.z = wear * 0.12 + shudder;
        lying.rotation.x = wear * -0.07;
        lying.scale.y = 1 - wear * 0.15;
      }
      if (state.kind === "turret" && state.aim !== undefined) {
        // the head swings toward what it last shot at, quickly but not in one snap
        const head = lying.getObjectByName("turretHead")!;
        let d = state.aim - head.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        head.rotation.y += d * Math.min(1, frameDt * 14);
      }
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
  const showPreview = !dead && !!localMesh && (held !== undefined && BLOCKING_KINDS.has(held.state.kind));
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
  ok: "activate the reactor",
  "too far": "move closer",
  "skip break": "send the next wave now",
  "already active": "already active — defend it",
  stable: "reactor stable — get to the lift",
  dead: "the reactor's dead",
};

// --- Interaction: E, and the floating prompts ---------------------------------
// The one key for "use the thing next to me": pick up the nearest item,
// press the lift button, switch the reactor on, read the scoreboard. A tap,
// never a hold, so it's fine while walking. The same things still respond
// to a click (an item or the reactor under the cursor), for anyone who'd
// rather point.
//
// Whatever E would act on right now gets a prompt pinned to it
// (client/ui/prompts.ts): white when it'll work, grey with the reason when
// it won't. Being out of range of everything shows nothing.

type Target =
  | { kind: "item"; item: ClientItem }
  | { kind: "reactor" }
  | { kind: "lift" }
  | { kind: "terminal" }
  | { kind: "board" };

const prompts = new Prompts();
/** the scoreboard overlay is open */
let boardOpen = false;

const LIFT_LABELS: Record<LiftVerdict, string> = {
  send: "send the lift",
  call: "call the lift",
  "too far": "move closer",
  "attempt on": "locked — attempt in progress",
  busy: "lift on its way",
  "already leaving": "leaving soon",
};

function nearestItem(): ClientItem | undefined {
  if (!localMesh) return undefined;
  let best: ClientItem | undefined;
  let bestD = PICKUP_RANGE;
  for (const item of items.values()) {
    if (item.state.heldBy !== undefined) continue;
    const d = Math.hypot(item.state.x - localMesh.position.x, item.state.z - localMesh.position.z);
    if (d < bestD) {
      best = item;
      bestD = d;
    }
  }
  return best;
}

const nearLiftButton = (): boolean => {
  if (!localMesh) return false;
  const level = levelOf(localMesh.position.z);
  const p = localMesh.position;
  if (inCar(level, p.x, p.z)) return true;
  const door = LIFT_DOORS[level];
  return Math.hypot(p.x - door.x, p.z - door.z) < 2.5 && p.z < door.z;
};

/** what E would act on, nearest first: the lift (when in or at it), an item, the reactor, the scoreboard */
function eTarget(): Target | undefined {
  if (!localMesh || isDead()) return undefined;
  const p = localMesh.position;
  if (nearLiftButton()) return { kind: "lift" };
  const held = myHeldItem();
  if (!held) {
    const item = nearestItem();
    if (item) return { kind: "item", item };
  }
  if (atTerminal(p)) return { kind: "terminal" };
  if (Math.hypot(p.x - REACTOR.x, p.z - REACTOR.z) <= REACTOR.halfX + PICKUP_RANGE) return { kind: "reactor" };
  if (Math.hypot(p.x - SCOREBOARD.x, p.z - SCOREBOARD.z) <= SCOREBOARD_RANGE) return { kind: "board" };
  return undefined;
}

function shopVerdict(item: ShopItem): BuyVerdict {
  const turrets = [...items.values()].filter((i) => i.state.kind === "turret").length;
  return buyVerdict(item, localMesh!.position, { holding: !!myHeldItem(), wounds: myWounds }, funds, turrets);
}

const BUY_REASONS: Record<BuyVerdict, string> = {
  ok: "",
  "too far": "move closer",
  "hands full": "hands full: put it down (Q)",
  "can't afford": "not enough quota",
  "sold out": "corp limit reached",
  unhurt: "not hurt",
};

// The shop: E at the comms set opens its panel, a key per line (or click
// the line). Walking away closes it.
let shopOpen = false;
const shopEl = document.createElement("div");
shopEl.id = "shop";
document.body.appendChild(shopEl);
const SHOP_ITEMS = Object.keys(SHOP) as ShopItem[];
function toggleShop(open = !shopOpen): void {
  shopOpen = open;
  shopEl.classList.toggle("open", shopOpen);
  renderShop();
}
let lastShopHtml = "";
function renderShop(): void {
  if (!shopOpen || !localMesh) return;
  const rows = SHOP_ITEMS.map((item) => {
    const v = shopVerdict(item);
    const s = SHOP[item];
    return `<div class="row${v === "ok" ? "" : " dim"}" data-item="${item}"><span class="key">[${s.key}]</span><span>${s.label}</span><span class="score">${s.cost}</span>${v === "ok" ? "" : `<div class="why">${BUY_REASONS[v]}</div>`}</div>`;
  }).join("");
  const html =
    '<div class="board-panel">' +
    '<div class="title">corp supply uplink</div>' +
    `<div class="run">crew quota: ${funds}</div>` +
    rows +
    '<div class="legend">field dressing: patches every wound now; the next hit tears it open</div>' +
    '<div class="legend">1 / 2 to order · E / Esc to close</div></div>';
  if (html === lastShopHtml) return;
  lastShopHtml = html;
  shopEl.innerHTML = html;
}
function order(item: ShopItem): void {
  if (!shopOpen) return;
  if (shopVerdict(item) === "ok") net.buy(item);
  else flash(BUY_REASONS[shopVerdict(item)]);
}
shopEl.addEventListener("pointerdown", (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>("[data-item]");
  if (row) order(row.dataset.item as ShopItem);
});
setInterval(() => {
  if (shopOpen && eTarget()?.kind !== "terminal") toggleShop(false);
  renderShop();
}, 150);

function useTarget(target: Target | undefined): void {
  if (!target || !localMesh) return;
  if (target.kind === "item") net.pickup(target.item.state.id);
  else if (target.kind === "reactor") {
    const verdict = activateVerdict(localMesh.position, objective, defenceState.phase);
    if (verdict === "ok" || verdict === "skip break") net.activate();
    else prompts.nope("reactor");
  } else if (target.kind === "lift") {
    const verdict = liftVerdict(localMesh.position, lift, objective, defenceState.phase);
    if (verdict === "send" || verdict === "call") net.lift();
    else prompts.nope("lift");
  } else if (target.kind === "terminal") toggleShop();
  else if (target.kind === "board") toggleBoard();
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** every prompt to show this frame */
function currentPrompts(): Prompt[] {
  const out: Prompt[] = [];
  if (!localMesh || isDead()) return out;
  const target = eTarget();
  const p = localMesh.position;
  const now = serverClock.now();
  if (target?.kind === "item") {
    const s = target.item.state;
    out.push({ id: `item:${s.id}`, at: v3(s.x, 0.4, s.z), key: "E", label: `pick up ${ITEM_NAMES[s.kind]}` });
  } else if (target?.kind === "reactor") {
    const verdict = activateVerdict(p, objective, defenceState.phase);
    if (verdict !== "already active") out.push({ id: "reactor", at: v3(REACTOR.x - 1.4, 2, REACTOR.z - 1.4), key: verdict === "stable" || verdict === "dead" ? "" : "E", label: ACTIVATE_TIPS[verdict], enabled: verdict === "ok" || verdict === "skip break" });
  } else if (target?.kind === "terminal") {
    const t = SUPPLY_TERMINAL;
    out.push({ id: "terminal", at: v3(t.x - 0.8, 1.9, t.z + 0.3), key: "E", label: shopOpen ? "close supply uplink" : "order supply", detail: `crew quota: ${funds}` });
  } else if (target?.kind === "board") {
    out.push({ id: "board", at: v3(SCOREBOARD.x - 1.2, 2.6, SCOREBOARD.z), key: "E", label: boardOpen ? "close scores" : "read scores" });
  } else if (target?.kind === "lift") {
    const level = levelOf(p.z);
    const verdict = liftVerdict(p, lift, objective, defenceState.phase);
    let detail: string | undefined;
    if (verdict === "already leaving" && lift.departAt) detail = `doors close in ${Math.max(0, Math.ceil((lift.departAt - now) / 1000))}s`;
    if (verdict === "send") detail = level === "top" ? "down to the facility" : defenceState.phase === "won" ? "evacuate to the surface" : "back up — leaves this attempt";
    if (verdict === "attempt on" && defenceState.phase === "blackout") detail = "no power — no way out";
    if (verdict === "busy" && lift.phase === "moving") detail = `${Math.max(0, Math.ceil(((lift.until ?? now) - now) / 1000))}s`;
    out.push({ id: "lift", at: liftPanelAt(level), key: "E", label: LIFT_LABELS[verdict], enabled: verdict === "send" || verdict === "call", detail });
  }
  // the lift's countdown hangs over its door for everyone on that level, button or not
  if (lift.phase === "open" && lift.departAt && levelOf(p.z) === lift.at && target?.kind !== "lift") {
    const d = LIFT_DOORS[lift.at];
    out.push({ id: "lift-count", at: v3(d.x - 1.6, 2.4, d.z), label: `lift leaves in ${Math.max(0, Math.ceil((lift.departAt - now) / 1000))}s` });
  }
  // the held box: where it'll go, or why it can't
  const held = myHeldItem();
  if ((held !== undefined && BLOCKING_KINDS.has(held.state.kind))) {
    const t = boxTarget();
    const verdict = boxVerdict(t);
    if (verdict !== "ok") out.push({ id: "place", at: v3(t.x, 0.9, t.z), key: "", label: verdict, enabled: false });
  }
  return out;
}

function renderPointerFeedback(): void {
  let cursor = "default";
  let tip = "";
  const held = myHeldItem();
  if (localMesh && !isDead()) {
    if (hoveringReactor()) {
      const verdict = activateVerdict(localMesh.position, objective, defenceState.phase);
      if (verdict === "ok" || verdict === "skip break") cursor = "pointer";
    } else if (!held) {
      if (hoveredItem()?.inReach) cursor = "pointer";
    } else if (held.state.kind === "gun") {
      cursor = "crosshair";
      if (noFireAt(localMesh.position.x, localMesh.position.z)) tip = "no firing in the lift";
    }
  }
  if (performance.now() < flashUntil) tip = flashText;
  renderer.domElement.style.cursor = cursor;
  tipEl.textContent = tip;
  tipEl.style.display = tip ? "block" : "none";
  tipEl.style.transform = `translate(${pointerPx.x + 16}px, ${pointerPx.y + 14}px)`;
  prompts.render(currentPrompts(), camera);
}

let lastControlsText = "";
function renderControls(): void {
  const held = myHeldItem();
  let text: string;
  if (myOut) {
    text = "you're out until this attempt ends";
  } else if (!held) {
    text = "WASD move · E use";
  } else {
    const info = ITEM_KINDS[held.state.kind];
    const parts = [held.state.kind === "gun" ? "click / hold: fire" : `click: ${info.primaryLabel}`];
    if (info.secondaryLabel) {
      const state = BLOCKING_KINDS.has(held.state.kind) ? ` (${gridSnap ? "on" : "off"})` : "";
      parts.push(`right-click / Space: ${info.secondaryLabel}${state}`);
    }
    parts.push(BLOCKING_KINDS.has(held.state.kind) ? "Q: place" : "Q: drop");
    text = `WASD move · ${parts.join(" · ")}`;
  }
  if (text !== lastControlsText) {
    controlsEl.textContent = text;
    lastControlsText = text;
  }
}

// --- Projectiles -------------------------------------------------------------
// Shots are tracers (client/netsync.ts): each is drawn from the one message
// that announced it, on the shared server clock, so a fast round looks the
// same on every screen. Your own shot is drawn the instant you click, along
// the same line the server will use, and handed over to the server's copy
// when it arrives.

const tracerMaterial = new THREE.MeshBasicMaterial({ color: EMIT_TRACER });
const tracers = new Map<string, Tracer>();
/** shots whose landing has been drawn (sparks or a splash), so each lands once */
const landed = new Set<string>();

/** shots fired here and not yet confirmed: same line as the server's, drawn straight away */
interface PendingShot {
  tracer: Tracer;
  createdAt: number;
}
const pendingShots: PendingShot[] = [];
const PENDING_SHOT_TTL_MS = 600;
let lastFireAt = -Infinity;
let localShotSeq = 0;

function clearSceneState(): void {
  if (localMesh) scene.remove(localMesh);
  for (const remote of remotes.values()) scene.remove(remote.mesh);
  remotes.clear();
  for (const t of tracers.values()) scene.remove(t.mesh);
  tracers.clear();
  for (const shot of pendingShots) scene.remove(shot.tracer.mesh);
  pendingShots.length = 0;
  for (const item of items.values()) removeItem(item);
  items.clear();
  for (const e of enemies.values()) scene.remove(e.mesh);
  enemies.clear();
  obstacles = OBSTACLES;
}

const net = connect({
  onConnectionChange(connected) {
    connectionLostEl.style.display = connected ? "none" : "block";
  },
  onWelcome(you, players, t) {
    // also fires on every reconnect, so start from a clean scene rather
    // than piling a new set of meshes on top of the last session's
    clearSceneState();
    serverClock.observe(t);
    myId = you.id;
    myRespawnAt = you.respawnAt ?? 0;
    myOut = !!you.out;
    myWounds = you.wounds ?? 0;
    myBandaged = you.bandaged ?? 0;
    myWarp = you.warp ?? 0;
    localMesh = makeCharacter(you.color, true);
    localMesh.position.set(you.x, 0, you.z);
    for (const p of players) {
      if (p.id !== myId) addOrUpdateRemote(p, t);
    }
    renderLeaderboard(players);
  },
  onBoard: renderBoard,
  onReplaced() {
    connectionLostEl.textContent = "open in another tab — this one is paused";
    connectionLostEl.style.display = "block";
  },
  onState(state) {
    const { t, players } = state;
    serverClock.observe(t);
    const seenPlayers = new Set<string>();
    objective = state.objective;
    defenceState = state.defence;
    funds = state.funds;
    if (state.lift) lift = state.lift;
    for (const line of state.announcements ?? []) showBanner(line);
    for (const r of state.reports ?? []) queueReport(r);
    for (const p of players) {
      if (p.id === myId) {
        myRespawnAt = p.respawnAt ?? 0;
        myOut = !!p.out;
        const wounds = p.wounds ?? 0;
        if (wounds > myWounds) onWounded(wounds, myBandaged > 0);
        else if (wounds < myWounds && (p.bandaged ?? 0) > 0) showBanner("patched up — the next hit tears it open");
        myWounds = wounds;
        myBandaged = p.bandaged ?? 0;
        // the server moved us (a respawn, a lift ride): jump there now, and
        // stamp moves from here on with the new count
        if (localMesh && (p.warp ?? 0) !== myWarp) {
          myWarp = p.warp ?? 0;
          localMesh.position.x = p.x;
          localMesh.position.z = p.z;
          continue;
        }
        // the server is authoritative: if it has us somewhere a frame of
        // walking couldn't explain (a move it refused), snap there; small
        // differences are just our own prediction running ahead
        if (localMesh && Math.hypot(p.x - localMesh.position.x, p.z - localMesh.position.z) > 2) {
          localMesh.position.x = p.x;
          localMesh.position.z = p.z;
        }
        continue;
      }
      seenPlayers.add(p.id);
      addOrUpdateRemote(p, t);
    }
    for (const [id, remote] of remotes) {
      if (!seenPlayers.has(id)) {
        scene.remove(remote.mesh);
        remotes.delete(id);
      }
    }
    updateProjectiles(state.projectiles);
    gore.apply(state.gore, !!state.goreReset);
    // items only come when they've changed; otherwise keep what we have
    if (state.items) updateItems(state.items);
    updateEnemies(state.enemies, t);
    renderLeaderboard(players);
  },
});

function updateProjectiles(incoming: ProjectileState[]): void {
  for (const p of incoming) {
    const known = tracers.get(p.id);
    if (known) {
      // the range shrinks once if it hit someone mid-flight
      known.state = p;
      continue;
    }
    // the server's copy of a shot we already drew: take over the local
    // tracer rather than draw a second one
    if (p.ownerId === myId && pendingShots.length > 0) {
      const mine = pendingShots.shift()!;
      scene.remove(mine.tracer.mesh);
    }
    const tracer = new Tracer(p, tracerMaterial);
    tracers.set(p.id, tracer);
    scene.add(tracer.mesh);
  }
}

function stepTracers(): void {
  const t = serverClock.now();
  for (const [id, tracer] of tracers) {
    const s = tracer.state;
    // the head's reached where it stops: sparks off a wall, a splash off a body
    if (!landed.has(id) && s.hit && s.range > 0.05 && ((t - s.firedAt) / 1000) * PROJECTILE_SPEED >= s.range) {
      landed.add(id);
      impacts.hit(s.hit, s.x + s.dirX * s.range, s.z + s.dirZ * s.range, s.dirX, s.dirZ);
    }
    if (!tracer.update(t)) {
      scene.remove(tracer.mesh);
      tracers.delete(id);
      landed.delete(id);
    }
  }
  const now = performance.now();
  for (let i = pendingShots.length - 1; i >= 0; i--) {
    const shot = pendingShots[i];
    const alive = shot.tracer.update(t);
    if (!alive || now - shot.createdAt > PENDING_SHOT_TTL_MS) {
      scene.remove(shot.tracer.mesh);
      pendingShots.splice(i, 1);
    }
  }
}

/**
 * Your own shot, drawn the moment you click: the same muzzle, direction
 * and stopping point the server will compute (towards the aim point,
 * ray-cast against walls and boxes), so when its copy arrives the swap is
 * invisible.
 */
function firePredictedShot(aimX: number, aimZ: number): void {
  if (!localMesh) return;
  let dx = aimX - localMesh.position.x;
  let dz = aimZ - localMesh.position.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.05) {
    dx = Math.sin(aimRotation);
    dz = Math.cos(aimRotation);
  } else {
    dx /= len;
    dz /= len;
  }
  const x = localMesh.position.x + dx * MUZZLE_OFFSET;
  const z = localMesh.position.z + dz * MUZZLE_OFFSET;
  let range = shotRange(x, z, dx, dz, obstacles);
  // stop at the first crawler on the line too, as the server will
  for (const ce of enemies.values()) {
    const t = segmentHitsCircle(x, z, dx, dz, 0, range, ce.drawn.x, ce.drawn.z, ENEMY_RADIUS + 0.05);
    if (t !== undefined) range = t;
  }
  const tracer = new Tracer(
    { id: `local-${localShotSeq++}`, ownerId: myId ?? "", x, z, dirX: dx, dirZ: dz, firedAt: serverClock.now(), range },
    tracerMaterial,
  );
  scene.add(tracer.mesh);
  pendingShots.push({ tracer, createdAt: performance.now() });
  muzzleFlash(x, z);
}

/** a brief flash at the muzzle: a lit point the shot comes out of */
const flashLight = new THREE.PointLight(EMIT_TRACER, 0, 5, 2);
scene.add(flashLight);
let flashUntilT = 0;
function muzzleFlash(x: number, z: number): void {
  flashLight.position.set(x, 1.1, z);
  flashUntilT = performance.now() + 60;
}
function stepMuzzleFlash(): void {
  flashLight.intensity = performance.now() < flashUntilT ? 6 : 0;
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
  if (myOut) {
    watchNext();
    return;
  }
  if (isDead() || !localMesh) return;
  const held = myHeldItem();
  // a click with something in hand is that item's action (firing over the reactor is firing); E still works
  if (hoveringReactor() && !held) {
    const verdict = activateVerdict(localMesh.position, objective, defenceState.phase);
    if (verdict === "ok" || verdict === "skip break") net.activate();
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
    triggerHeld = true;
    fireGun(true);
  } else if (BLOCKING_KINDS.has(held.state.kind)) {
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

// The rifle is automatic: a click fires one shot, and holding the button
// keeps firing at the gun's rate. Holding is only ever a bonus --- tapping
// fires just as well --- so a trackpad loses nothing.
let triggerHeld = false;

/** one shot if the gun's ready; `clicked` is a fresh press, the only time a refusal is worth saying */
function fireGun(clicked: boolean): void {
  if (!localMesh) return;
  if (noFireAt(localMesh.position.x, localMesh.position.z)) {
    if (clicked) flash("no firing in the lift");
    return;
  }
  const now = performance.now();
  if (now - lastFireAt < FIRE_COOLDOWN_MS) return;
  lastFireAt = now;
  // every shot strays a little either side, and a hurt arm far more. The
  // stray is decided here and sent as the aim, so the tracer drawn now is
  // exactly the shot the server fires (co-op, so trusting it costs nothing)
  const spread = AIM_SPREAD + (myWounds >= 3 ? WOUNDED_AIM_SPREAD : 0);
  const dx = aimPoint.x - localMesh.position.x;
  const dz = aimPoint.z - localMesh.position.z;
  const a = Math.atan2(dx, dz) + (Math.random() * 2 - 1) * spread;
  const d = Math.max(1, Math.hypot(dx, dz));
  const aimX = localMesh.position.x + Math.sin(a) * d;
  const aimZ = localMesh.position.z + Math.cos(a) * d;
  net.primary(aimX, aimZ);
  firePredictedShot(aimX, aimZ);
}

/** called every frame: keep firing while the trigger's held on a gun */
function stepTrigger(): void {
  if (!triggerHeld) return;
  if (isDead() || myHeldItem()?.state.kind !== "gun") {
    triggerHeld = false;
    return;
  }
  fireGun(false);
}

function secondary(): void {
  if (isDead()) return;
  const held = myHeldItem();
  if ((held !== undefined && BLOCKING_KINDS.has(held.state.kind))) gridSnap = !gridSnap;
}

function drop(): void {
  if (isDead()) return;
  const held = myHeldItem();
  if (!held) return;
  // a box can't just be let go of where you stand --- it'd land on you ---
  // so dropping one means putting it down at the preview spot
  if (BLOCKING_KINDS.has(held.state.kind)) primary();
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
window.addEventListener("pointerup", (e) => {
  if (e.button === 0) triggerHeld = false;
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
  else if (key === "e") useTarget(eTarget());
  else if (key === "escape" && boardOpen) toggleBoard();
  else if (key === "escape" && shopOpen) toggleShop(false);
  else if (shopOpen) {
    const item = SHOP_ITEMS.find((i) => SHOP[i].key === key);
    if (item) order(item);
  }
});

function addOrUpdateRemote(p: PlayerState, t: number): void {
  let remote = remotes.get(p.id);
  if (!remote) {
    remote = { mesh: makeCharacter(p.color, false), snaps: new SnapshotBuffer(), drawn: { x: p.x, z: p.z, rotation: p.rotation }, watchable: false };
    remote.mesh.position.set(p.x, 0, p.z);
    remotes.set(p.id, remote);
  }
  remote.snaps.push(t, p.x, p.z, p.rotation);
  // the server only sends respawnAt / out while someone's dead
  const alive = p.respawnAt === undefined && !p.out;
  remote.mesh.visible = alive;
  remote.watchable = alive && !!p.entered;
}

// --- Enemies -----------------------------------------------------------------
// Drawn like other players: played back from snapshots, a little in the
// past, so they move smoothly however the updates arrive. A health bar over
// each once it's been hit, and a flash when a shot lands.

interface ClientEnemy {
  mesh: THREE.Object3D;
  snaps: SnapshotBuffer;
  drawn: { x: number; z: number; rotation: number };
  health: number;
  bar: THREE.Mesh;
  hitUntil: number;
}
const enemies = new Map<string, ClientEnemy>();
let defenceState: DefenceState = { reactorHealth: 1, wave: 0, phase: "spawning" };
/** the crew's shared quota, as the server last said */
let funds = 0;
const ITEM_NAMES: Record<ItemKind, string> = { gun: "rifle", box: "box", turret: "turret" };
const enemyBarGeometry = new THREE.PlaneGeometry(0.7, 0.07).rotateX(-Math.PI / 2);

function updateEnemies(incoming: EnemyState[], t: number): void {
  const seen = new Set<string>();
  for (const e of incoming) {
    seen.add(e.id);
    let ce = enemies.get(e.id);
    if (!ce) {
      const mesh = crawler();
      // a faint red glow at the eyes: in the dark, the pack is seen by its eyes first
      const eyes = glow(EMIT_RED, 0.55, 0.55);
      eyes.position.set(0, 0.48, 0.66);
      mesh.add(eyes);
      const bar = new THREE.Mesh(enemyBarGeometry, new THREE.MeshBasicMaterial({ color: DANGER, depthTest: false }));
      bar.position.set(0, 1.0, 0);
      bar.renderOrder = 10;
      bar.visible = false;
      mesh.add(bar);
      mesh.position.set(e.x, 0, e.z);
      scene.add(mesh);
      ce = { mesh, snaps: new SnapshotBuffer(), drawn: { x: e.x, z: e.z, rotation: e.rotation }, health: e.health, bar, hitUntil: 0 };
      enemies.set(e.id, ce);
    }
    if (e.health < ce.health) ce.hitUntil = performance.now() + 120;
    ce.health = e.health;
    ce.snaps.push(t, e.x, e.z, e.rotation);
  }
  for (const [id, ce] of enemies) {
    if (!seen.has(id)) {
      scene.remove(ce.mesh);
      enemies.delete(id);
    }
  }
}

function stepEnemies(time: number): void {
  const t = serverClock.now() - INTERP_DELAY_MS;
  const now = performance.now();
  for (const ce of enemies.values()) {
    ce.snaps.sample(t, ce.drawn);
    // a scuttle: a small bob and sway while they move
    const bob = Math.sin(time * 14 + ce.drawn.x * 3) * 0.03;
    ce.mesh.position.set(ce.drawn.x, bob, ce.drawn.z);
    ce.mesh.rotation.y = ce.drawn.rotation;
    ce.bar.visible = ce.health < 1;
    ce.bar.scale.x = Math.max(0.02, ce.health);
    // flash on a hit: brief scale pop
    const s = now < ce.hitUntil ? 1.15 : 1;
    ce.mesh.scale.setScalar(s);
  }
}

function stepRemotes(): void {
  const t = serverClock.now() - INTERP_DELAY_MS;
  for (const remote of remotes.values()) {
    remote.snaps.sample(t, remote.drawn);
    remote.mesh.position.set(remote.drawn.x, 0, remote.drawn.z);
    remote.mesh.rotation.y = remote.drawn.rotation;
  }
}

// Decoupled from the render loop so the network doesn't get a message per
// animation frame; matches the server's own broadcast cadence.
const MOVE_SEND_INTERVAL_MS = BROADCAST_INTERVAL_MS;
const clock = new THREE.Clock();
let sinceLastSend = Infinity;
/** this frame's seconds, for easing that isn't worth threading through every call */
let frameDt = 0;

function animate(): void {
  const dt = Math.min(clock.getDelta(), 0.1);
  frameDt = dt;
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
          localMesh.position.x + dx * woundedSpeed(myWounds) * dt,
          localMesh.position.z + dz * woundedSpeed(myWounds) * dt,
        );
        const p = localMesh.position;
        const lockedOut = objective.active && levelOf(p.z) === "bottom" && !inCar("bottom", p.x, p.z);
        const resolved = resolveObstacles(next.x, next.z, obstaclesFor(lift, lockedOut, obstacles));
        localMesh.position.x = resolved.x;
        localMesh.position.z = resolved.z;
      }

      updateAim();

      if (sinceLastSend >= MOVE_SEND_INTERVAL_MS) {
        net.sendMove({ x: localMesh.position.x, z: localMesh.position.z, rotation: aimRotation, warp: myWarp });
        sinceLastSend = 0;
      }
    }

    localMesh.visible = !dead;
    respawnEl.style.display = dead && !myOut ? "block" : "none";
    if (dead && !myOut) {
      respawnEl.textContent = `${Math.max(1, Math.ceil((myRespawnAt - serverClock.now()) / 1000))}`;
    }

    // out: watch a teammate (their view, their torch); otherwise our own.
    // In a wipe the view holds still where it was until the cut to black.
    const watched = myOut && !wipeAt ? spectateTarget() : undefined;
    let eye = watched ? { ...watched.drawn } : { x: localMesh.position.x, z: localMesh.position.z, rotation: aimRotation };
    if (wipeAt) {
      wipeEye ??= lastEye;
      // until we've been moved up (behind the black), stay where everyone fell
      if (levelOf(localMesh.position.z) === "bottom" || performance.now() - wipeAt < WIPE_HOLD_MS) eye = wipeEye;
    }
    lastEye = eye;
    camera.position.set(eye.x, CAMERA_ALTITUDE, eye.z);
    camera.lookAt(eye.x, 0, eye.z);
    torch.aim(eye.x, eye.z, eye.rotation);
    torch.light.visible = !dead || !!watched;
    stepLevel(eye.x, eye.z, dt);
    activeVisibility.update(renderer, eye.x, eye.z);
    viewPoint.set(eye.x, 0, eye.z);
  }
  renderSpectating(dt);

  const time = clock.elapsedTime;
  const view = viewPoint;
  const power = powerNow(time);
  halos.visible = power !== "out";
  lighting.update(view.x, view.z, time, { reactorActive: objective.active, power, since: powerSince }, (lamp) => {
    if (power === "full") return true;
    // a lamp lights the scene only if its light could reach what we see: in sight, or close
    const at = lampSource(lamp);
    return Math.hypot(at.x - view.x, at.z - view.z) < LAMP_SPECS[lamp.kind].range * 0.5 || canSee(view.x, view.z, at.x, at.z, visibility.segs);
  });
  const coreColour = objective.active ? REACTOR_LIVE : REACTOR_STANDBY;
  coreMaterial.color.setHex(power === "out" ? 0x080808 : coreColour);
  coreHalo.visible = power !== "out";
  coreHalo.material.color.setHex(coreColour);
  coreHalo.material.opacity = power === "full" ? 0.95 : objective.active ? 0.7 + 0.2 * Math.sin(time * 2) : 0.3 + 0.15 * Math.sin(time * 1.3);
  stepWipe(dt);
  liftDoors.update(lift, serverClock.now());
  updateSightDoors();
  stepRide(dt);

  stepRemotes();
  stepEnemies(time);
  renderDefenceHud();
  stepTrigger();
  stepWounds(dt);
  stepDust();
  stepTracers();
  impacts.step(dt);
  stepMuzzleFlash();
  stepItemVisuals(time);
  renderPointerFeedback();
  renderControls();
  renderDebug(dt);

  post.render(scene, camera);
  requestAnimationFrame(animate);
}

// --- Levels and the ride --------------------------------------------------------
// Which level the viewer is on decides the light (the sun up top, the
// facility's lamps and torch below), the line-of-sight mask, and the grade
// (paint up top). The swap happens while the lift's shut and moving, inside
// the identical car, and the grade cross-fades over the ride, so stepping
// out at the bottom is the first you see of the dark.

let paintLevel = 1;
function stepLevel(x: number, z: number, dt: number): void {
  const level = levelOf(z);
  if (level !== viewLevel) {
    viewLevel = level;
    activeVisibility = level === "top" ? surfaceVisibility : visibility;
    activeVisibility.invalidate();
    // underground the wall tops are out of sight; outdoors there's nothing overhead to hide (tree crowns stand above the walls)
    post.setMask(activeVisibility.postMask(level === "top" ? 50 : FACILITY_WALL_HALF_HEIGHT * 2 - 0.05));
  }
  const up = level === "top";
  // in the car the light is the car's own bulbs whichever end it's at; the
  // sun and the paint only once you step out (or, riding, as you arrive)
  const inside = inAnyCar(x, z);
  sunlight.setOn(up);
  sunlight.follow(x, z);
  const want = up && !inside ? 1 : up && lift.phase === "open" && lift.at === "top" ? 0.6 : 0;
  paintLevel += (want - paintLevel) * Math.min(1, dt * 2.5);
  post.effects.paint = paintLevel < 0.01 ? 0 : paintLevel;
  // powered up after a win the place is bright and white; blacked out there's barely a shape
  const fill = powerLevel === "full" ? 1 + 4 * Math.min(1, (clock.elapsedTime - powerSince) / 2.5) : powerLevel === "out" ? 0.04 : 1;
  lighting.ambient.intensity = FACILITY_AMBIENT * fill * (1 - paintLevel);
  lighting.ambient.color.setHex(powerLevel === "full" ? 0xdfe8f0 : AMBIENT_SKY);
  // no headlamp in the sun
  torch.light.intensity = 18 * (1 - paintLevel);
}

/** while the car's moving with us in it: a gentle sway, so the ride is felt */
let rideShake = 0;
function stepRide(dt: number): void {
  const p = localMesh?.position;
  const riding = !!p && lift.phase === "moving" && inCar(lift.at, p.x, p.z);
  rideShake += ((riding ? 1 : 0) - rideShake) * Math.min(1, dt * 4);
  if (rideShake > 0.01) {
    const t = performance.now() / 1000;
    camera.position.x += Math.sin(t * 23) * 0.025 * rideShake;
    camera.position.z += Math.sin(t * 17 + 1) * 0.02 * rideShake;
    camera.position.y += Math.sin(t * 9) * 0.08 * rideShake;
  }
  rideEl.style.opacity = riding ? "1" : "0";
  if (riding) {
    const left = Math.max(0, (lift.until ?? 0) - serverClock.now()) / LIFT_RIDE_MS;
    const down = lift.at === "bottom";
    rideFill.style.height = `${((down ? 1 - left : left) * 100).toFixed(1)}%`;
    rideLabel.textContent = down ? "descending" : "ascending";
  }
}
// the ride indicator: a thin vertical gauge down the right edge
const rideEl = document.createElement("div");
rideEl.className = "ui-ride";
rideEl.innerHTML = '<div class="ui-ride-track"><div class="ui-ride-fill"></div></div><div class="ui-ride-label"></div>';
document.body.appendChild(rideEl);
const rideFill = rideEl.querySelector<HTMLDivElement>(".ui-ride-fill")!;
const rideLabel = rideEl.querySelector<HTMLDivElement>(".ui-ride-label")!;

// Wounds: a hit doesn't take a bar down, it leaves something you feel. A
// red flash and a line saying what's wrong the moment it lands; after
// that, the effect itself --- slower legs, a swimming view (the post
// process's daze), a shaking aim --- and pips along the bottom-left so
// you know how many more you can take. ?daze=0..1 forces the blur, for
// checking it.
const hurtFlashEl = document.createElement("div");
hurtFlashEl.style.cssText =
  "position:fixed;inset:0;pointer-events:none;background:radial-gradient(ellipse at center, rgba(160,0,0,0) 40%, rgba(170,10,10,0.55) 100%);opacity:0;transition:opacity 0.5s";
document.body.appendChild(hurtFlashEl);
const woundsEl = document.createElement("div");
woundsEl.className = "ui-wounds";
document.body.appendChild(woundsEl);
const forcedDaze = params.has("daze") ? Number(params.get("daze")) || 0 : undefined;
let dazeLevel = 0;
let lastWoundsShown = -1;

function onWounded(wounds: number, torn = false): void {
  hurtFlashEl.style.transition = "none";
  hurtFlashEl.style.opacity = "1";
  requestAnimationFrame(() => {
    hurtFlashEl.style.transition = "opacity 0.6s";
    hurtFlashEl.style.opacity = "0";
  });
  const w = WOUNDS[wounds - 1];
  if (torn) showBanner(`dressing torn open — ${wounds >= MAX_WOUNDS ? "one more hit is fatal" : `${wounds} wound(s) back`}`);
  else if (w) showBanner(wounds >= MAX_WOUNDS ? `${w.label} — one more hit is fatal` : w.label);
}

function stepWounds(dt: number): void {
  const wounds = isDead() ? 0 : myWounds;
  // ease the blur in and out rather than snapping
  const want = forcedDaze ?? (wounds >= 2 ? 1 : 0);
  dazeLevel += (want - dazeLevel) * Math.min(1, dt * 3);
  post.effects.daze = dazeLevel < 0.01 ? 0 : dazeLevel;
  const bandaged = isDead() ? 0 : myBandaged;
  const key = wounds * 10 + bandaged;
  if (key === lastWoundsShown) return;
  lastWoundsShown = key;
  woundsEl.style.display = wounds > 0 || bandaged > 0 ? "block" : "none";
  // a dressed wound is a dashed pip: gone for now, back with the next hit
  const pips = Array.from({ length: MAX_WOUNDS + 1 }, (_, i) => `<span class="pip${i < wounds ? " hit" : i < bandaged ? " dressed" : ""}"></span>`).join("");
  woundsEl.innerHTML =
    `<div style="margin-bottom:4px">${pips}</div>` +
    WOUNDS.slice(0, wounds).map((w) => `<div class="w">${w.label}</div>`).join("") +
    (bandaged > 0 ? `<div class="w">dressed: ${bandaged} wound(s) under it</div>` : "");
}

// Spectating. Out for the rest of an attempt, you watch a teammate who's
// still in it --- through their eyes: their view, their torch, their line
// of sight --- on an old CRT (see client/postprocess.ts). Click for the
// next teammate. With nobody left to watch, the view rests where you fell
// until the attempt ends and everyone's back up in the garden.
// ?crt=0..1 forces the CRT, for checking it.
const viewPoint = new THREE.Vector3(0, 0, 24);
const spectateEl = document.createElement("div");
spectateEl.className = "ui-spectate";
document.body.appendChild(spectateEl);
const forcedCrt = params.has("crt") ? Number(params.get("crt")) || 0 : undefined;
let crtLevel = 0;

function watchableIds(): string[] {
  return [...remotes.entries()].filter(([, r]) => r.watchable).map(([id]) => id);
}

/** who we're watching: the one picked, if still in it, else the first teammate who is */
function spectateTarget(): RemotePlayer | undefined {
  const ids = watchableIds();
  if (!watchingId || !ids.includes(watchingId)) watchingId = ids[0];
  return watchingId ? remotes.get(watchingId) : undefined;
}

function watchNext(): void {
  const ids = watchableIds();
  if (ids.length < 2) return;
  watchingId = ids[(ids.indexOf(watchingId ?? "") + 1) % ids.length];
}

function renderSpectating(dt: number): void {
  const want = forcedCrt ?? (myOut ? 1 : 0);
  crtLevel += (want - crtLevel) * Math.min(1, dt * 4);
  post.effects.crt = crtLevel < 0.01 ? 0 : crtLevel;
  spectateEl.style.display = myOut ? "block" : "none";
  if (!myOut) return;
  const ids = watchableIds();
  spectateEl.textContent =
    ids.length === 0
      ? "you're down · nobody left standing"
      : `you're down · watching ${ids.indexOf(watchingId ?? "") + 1}/${ids.length}${ids.length > 1 ? " · click: next" : ""}`;
}

// The defence HUD: while the reactor is live, its health and the wave
// across the top of the screen --- the one number the whole room is
// fighting over --- and a countdown between waves.
const hudEl = document.createElement("div");
hudEl.className = "ui-hud";
hudEl.innerHTML =
  '<div class="line"><span>waves</span><span id="hud-charge-pct"></span></div>' +
  '<div class="bar"><div id="hud-charge" style="width:0"></div></div>' +
  '<div class="line"><span>reactor</span><span id="hud-wave"></span></div>' +
  '<div class="bar hp"><div id="hud-hp" style="width:100%"></div></div>' +
  '<div id="hud-next" class="next"></div>';
document.body.appendChild(hudEl);
const hudHp = hudEl.querySelector<HTMLDivElement>("#hud-hp")!;
const hudWave = hudEl.querySelector<HTMLSpanElement>("#hud-wave")!;
const hudNext = hudEl.querySelector<HTMLDivElement>("#hud-next")!;
const hudCharge = hudEl.querySelector<HTMLDivElement>("#hud-charge")!;
const hudChargePct = hudEl.querySelector<HTMLSpanElement>("#hud-charge-pct")!;
function renderDefenceHud(): void {
  hudEl.style.display = objective.active ? "block" : "none";
  if (!objective.active) return;
  if (defenceState.phase === "won") {
    hudChargePct.textContent = `${WAVES_TO_WIN} / ${WAVES_TO_WIN} cleared · quota ${funds}`;
    hudCharge.style.width = "calc(100% - 2px)";
    hudWave.textContent = "stable";
    hudHp.style.width = "calc(100% - 2px)";
    hudHp.classList.remove("low");
    hudNext.textContent = "power restored · evacuate: take the lift up";
    return;
  }
  if (defenceState.phase === "blackout") {
    const held = Math.max(0, Math.floor((serverClock.now() - (defenceState.blackoutAt ?? serverClock.now())) / 1000));
    hudChargePct.textContent = `${defenceState.wave} / ${WAVES_TO_WIN} cleared`;
    hudWave.textContent = "dead";
    hudHp.style.width = "0";
    hudNext.textContent = `blackout · held ${held}s · ${enemies.size} hostile · no way out`;
    return;
  }
  const onBreak = defenceState.phase === "break";
  // waves fully cleared: the one being fought doesn't count until it's down
  const cleared = onBreak ? defenceState.wave : Math.max(0, defenceState.wave - 1);
  hudCharge.style.width = `calc(${((cleared / WAVES_TO_WIN) * 100).toFixed(1)}% - 2px)`;
  hudChargePct.textContent = `${cleared} / ${WAVES_TO_WIN} cleared · quota ${funds}`;
  const hp = defenceState.reactorHealth;
  hudHp.style.width = `calc(${Math.round(hp * 100)}% - 2px)`;
  // white until it's in danger, then alarm red
  hudHp.classList.toggle("low", hp <= 0.3);
  hudWave.textContent = !onBreak && defenceState.wave > 0 ? `wave ${defenceState.wave}` : "";
  const next = defenceState.nextWaveAt;
  const nextIn = next ? Math.max(0, Math.ceil((next - serverClock.now()) / 1000)) : 0;
  hudNext.textContent = [
    enemies.size ? `${enemies.size} hostile` : "",
    onBreak && next ? `wave ${defenceState.wave + 1} in ${nextIn}s · E at the reactor: send it now` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

// The scoreboard: a screen in the garden (client/world/surface.ts) that
// opens full-screen when you use it --- how this run is going (attempts so
// far, the most waves any cleared), the all-time top players, and the runs
// that were won. Kept by the server across restarts; sent when it changes.
const boardEl = document.createElement("div");
boardEl.id = "board";
document.body.appendChild(boardEl);
function toggleBoard(): void {
  boardOpen = !boardOpen;
  boardEl.classList.toggle("open", boardOpen);
}
function renderBoard(b: BoardMessage): void {
  scoreboard.draw(b.top.slice(0, 3).map((p, i) => `${i + 1} ${p.name.slice(0, 14).padEnd(14)} ${p.kills}`));
  const runLine = b.run.attempts
    ? `run: attempt ${b.run.attempts}${b.run.best ? ` · best ${b.run.best}/${WAVES_TO_WIN} waves` : ""}`
    : "run: no attempts yet";
  const rows = b.top
    .map((p, i) => `<div class="row"><span class="rank">${i + 1}</span><span>${escapeText(p.name)}</span><span class="score">${p.wins ? `★${p.wins} ` : ""}${p.kills}k ${p.boxes}b</span></div>`)
    .join("");
  const wins = b.wins
    .map((w) => `<div class="row won"><span>#${w.n}</span><span>${w.attempts} attempt(s)</span><span class="score">${escapeText(w.crew.slice(0, 3).join(", "))}${w.crew.length > 3 ? "…" : ""}</span></div>`)
    .join("");
  boardEl.innerHTML =
    '<div class="board-panel">' +
    `<div class="title">high scores</div><div class="run">${runLine}</div>` +
    (rows || '<div class="row dim">nobody yet</div>') +
    (wins ? `<div class="title">reactor stabilised</div>${wins}` : "") +
    '<div class="legend">★ runs won · k kills · b boxes placed</div>' +
    '<div class="legend">E / Esc to close</div></div>';
}
// walking away closes it
setInterval(() => {
  if (boardOpen && eTarget()?.kind !== "board") toggleBoard();
}, 200);

// The facility's power, from the attempt's phase: "full" once the run's
// won (the place lights up as if it's only just been properly switched
// on), "out" once the reactor's dead (only torches), "normal" otherwise.
// `powerSince` is when it last changed, for the lamps' flicker-up.
let powerLevel: "normal" | "full" | "out" = "normal";
let powerSince = 0;
function powerNow(time: number): "normal" | "full" | "out" {
  const want = !objective.active ? "normal" : defenceState.phase === "won" ? "full" : defenceState.phase === "blackout" ? "out" : "normal";
  if (want !== powerLevel) {
    powerLevel = want;
    powerSince = time;
  }
  return powerLevel;
}

// A wipe: everyone's down. The view holds where it is (on your own body,
// or on the last teammate you watched) a few seconds, then fades to black;
// the server moves everyone up behind the black, and it fades back in on
// the garden.
const wipeEl = document.createElement("div");
wipeEl.className = "ui-wipe";
document.body.appendChild(wipeEl);
/** performance.now() the wipe began, or 0 */
let wipeAt = 0;
/** where the camera rests through a wipe */
let wipeEye: { x: number; z: number; rotation: number } | undefined;
/** the last frame's view, so a wipe holds on what was being watched */
let lastEye = { x: 0, z: 0, rotation: 0 };
const FADE_MS = 1300;
function startWipe(): void {
  wipeAt = performance.now();
}
function stepWipe(_dt: number): void {
  if (!wipeAt) {
    wipeEl.style.opacity = "0";
    return;
  }
  const t = performance.now() - wipeAt;
  const fadeOutAt = WIPE_HOLD_MS - FADE_MS;
  let a = 0;
  if (t < fadeOutAt) a = 0;
  else if (t < WIPE_HOLD_MS + 400) a = Math.min(1, (t - fadeOutAt) / FADE_MS);
  else a = Math.max(0, 1 - (t - WIPE_HOLD_MS - 400) / FADE_MS);
  wipeEl.style.opacity = a.toFixed(3);
  if (t > WIPE_HOLD_MS + 400 + FADE_MS) {
    wipeAt = 0;
    wipeEye = undefined;
  }
}

// Reports: what a wave paid, itemised, and how an attempt ended --- a panel
// at the right edge that slides in and stays a few seconds (an attempt's
// end longer, and on top of a wave's).
const reportEl = document.createElement("div");
reportEl.className = "ui-report";
document.body.appendChild(reportEl);
let reportTimer: ReturnType<typeof setTimeout> | undefined;
const secs = (ms: number): string => `${Math.round(ms / 1000)}s`;
/** a wave's report and the attempt's end can land together: the wave gets a few seconds first */
let reportQueue: Report[] = [];
let reportBusyUntil = 0;
function queueReport(r: Report): void {
  // a lost attempt's wipe runs on the server's clock, not the panel's queue
  if (r.type === "attempt" && r.outcome === "lost" && (myOut || (localMesh && levelOf(localMesh.position.z) === "bottom"))) startWipe();
  reportQueue.push(r);
  pumpReports();
}
function pumpReports(): void {
  if (!reportQueue.length) return;
  const wait = reportBusyUntil - performance.now();
  if (wait > 0) {
    setTimeout(pumpReports, wait + 10);
    return;
  }
  const r = reportQueue.shift()!;
  showReport(r);
  // a wave report holds the panel a moment before anything queued behind it
  reportBusyUntil = performance.now() + (r.type === "wave" && reportQueue.length ? 3500 : 0);
  if (reportQueue.length) setTimeout(pumpReports, 3510);
}
function showReport(r: Report): void {
  let html: string;
  let hold = 6000;
  if (r.type === "wave") {
    const rows: [string, string][] = [
      [`wave ${r.wave}`, `${r.size} hostiles`],
      ["time", `${secs(r.clearMs)} / par ${secs(r.parMs)}`],
      ["base pay", `+${r.base}`],
      ["speed bonus", r.bonus > 0 ? `+${r.bonus}` : "—"],
    ];
    html =
      `<div class="title">wave ${r.wave} cleared</div>` +
      rows.map(([k, v]) => `<div class="row"><span>${k}</span><span class="score">${v}</span></div>`).join("") +
      `<div class="row total"><span>quota</span><span class="score">+${r.base + r.bonus} → ${r.total}</span></div>`;
  } else {
    hold = 11000;
    const crew = [...r.crew].sort((a, b) => b.kills - a.kills);
    html =
      `<div class="title">${r.outcome === "won" ? "reactor stabilised" : "attempt failed"}</div>` +
      `<div class="run">attempt ${r.attempt} · ${escapeText(r.reason)}</div>` +
      `<div class="row"><span>waves cleared</span><span class="score">${r.waves} / ${WAVES_TO_WIN}</span></div>` +
      (r.blackoutMs ? `<div class="row"><span>held in the dark</span><span class="score">${secs(r.blackoutMs)}</span></div>` : "") +
      `<div class="title sub">crew</div>` +
      (crew.length
        ? crew.map((c) => `<div class="row${c.out ? " dim" : ""}"><span>${escapeText(c.name)}${c.out ? " †" : ""}</span><span class="score">${c.kills} kills</span></div>`).join("")
        : '<div class="row dim">nobody</div>') +
      (r.outcome === "won" ? '<div class="legend">power restored · take the lift up</div>' : "");
  }
  reportEl.innerHTML = html;
  reportEl.classList.add("open");
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => reportEl.classList.remove("open"), hold);
}

// The objective banner: a line across the top of the screen when the reactor goes live.
const bannerEl = document.createElement("div");
bannerEl.className = "ui-banner";
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


requestAnimationFrame(animate);
