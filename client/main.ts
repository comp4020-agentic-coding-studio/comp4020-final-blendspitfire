import * as THREE from "three";
import { connect } from "./net.ts";
import {
  CAMERA_ALTITUDE,
  CAMERA_FOV,
  FACILITY_AMBIENT,
  configureRenderer,
  createTorch,
  crawlerEyes,
  glow,
  lampHalos,
  setupLighting,
  type CrawlerEyes,
} from "./look.ts";
import { createPostProcess } from "./postprocess.ts";
import { GRADE } from "./assets/grade.ts";
import { VisibilityMask, canSee, sightBlockers } from "./visibility.ts";
import { buildYardGuides } from "./floorGuides.ts";
import { Prompts, type Prompt } from "./ui/prompts.ts";
import { Markers, type Marker } from "./ui/markers.ts";
import { Minimap } from "./ui/minimap.ts";
import { buildSurface, createSunlight, scoreboardScreen } from "./world/surface.ts";
import { LiftDoors, liftPanelAt } from "./world/lift.ts";
import { Settlement } from "./ui/settlement.ts";
import { EvacView } from "./world/evac.ts";
import { Gore, Impacts } from "./world/gore.ts";
import { buildTutorial, type TutorialView } from "./world/tutorial.ts";
import { helicopter } from "./models/heli.ts";
import {
  CABIN,
  DROP_PAD,
  HELIPADS,
  HELI_RIDE_MS,
  LESSONS,
  MOVE_PAD,
  TUT_BOUNDS,
  TUT_CLUSTER,
  TUT_GUN_AT,
  TUT_TARGETS,
  TUT_WALLS,
  inTutorial,
  padAt,
  roomAt,
  shutTutDoors,
  tutDoor,
} from "../shared/tutorial.ts";
import {
  GUN_REST_HEIGHT,
  HELD_GUN_OFFSET,
  SHOULDER_LAMP,
  character,
  brute,
  crawler,
  runner,
  grenade,
  gun,
  heldGun,
  sentryTurret,
  beaconLamp,
  spitter,
} from "./models/index.ts";
import { REACTOR_LIVE, REACTOR_STANDBY, buildFacility, reactorCore } from "./models/facility.ts";
import { mesh } from "./models/kit.ts";
import { LAMPS, LAMP_SPECS, lampSource } from "./world/dressing.ts";
import { STENCIL, DANGER, OK, EMIT_AMBER, EMIT_GREEN, EMIT_TRACER, EMIT_ACID, EMIT_SPARK, AMBIENT_SKY, codename } from "../shared/palette.ts";
import { INTERP_DELAY_MS, ServerClock, SnapshotBuffer, Tracer } from "./netsync.ts";
import {
  BRUTE_SCALE,
  ENEMY_RADIUS,
  FREIGHT_BOARD_MS,
  SPIT_SPLASH,
  WAVES_TO_WIN,
  blastDoorOpen,
  evacStage,
  waveSize,
  type DefenceState, type EnemyKind, type EnemyState, type SpitState } from "../shared/enemies.ts";
import {
  BREACHES,
  DOORWAYS,
  TOP_DOOR,
  FACILITY_HALF,
  FACILITY_WALL_HALF_HEIGHT,
  FIXTURES,
  REACTOR,
  BUILT_WALLS,
  BLAST_DOOR,
  FREIGHT,
  FREIGHT_PANEL,
  freightVerdict,
  FREIGHT_PANEL_RANGE,
  type FreightVerdict,
  inFreight,
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
  type LiftLevel,
  type LiftState,
  type LiftVerdict,
  SIGHT_BOUNDS,
  SOLID,
  WALLS,
  ZONE_RECTS,
  BROADCAST_INTERVAL_MS,
  FIRE_COOLDOWN_MS,
  ITEM_KINDS,
  cleanName,
  NAME_MAX,
  BLOCKING_KINDS,
  SUPPLY_TERMINAL,
  SHOP,
  TURRET_COST,
  GRENADE_RADIUS,
  GRENADE_FLIGHT_MS,
  grenadeLanding,
  type GrenadeState,
  atTerminal,
  buyVerdict,
  buildTurretVerdict,
  type BuildTurretVerdict,
  scrapVerdict,
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
    // (the blast door is its own moving model: client/world/evac.ts)
    walls: BUILT_WALLS.filter((w) => w !== BLAST_DOOR),
    doorways: DOORWAYS.concat(TOP_DOOR),
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
// hidden underground: its ruins run north over the bottom car's footprint, and nothing else keeps them out of the car
const surface = buildSurface();
scene.add(surface);
const sunlight = createSunlight(scene);
const liftDoors = new LiftDoors();
scene.add(liftDoors.group);
const evacView = new EvacView();
scene.add(evacView.group);
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

// the comms set's green call lamp: lit through a break, dark once a wave is on
const beacon = beaconLamp();
beacon.position.set(SUPPLY_TERMINAL.x + 0.2, SUPPLY_TERMINAL.halfHeight * 2 * 0.62 + 0.03, SUPPLY_TERMINAL.z + 0.05);
scene.add(beacon);
const beaconLens = beacon.getObjectByName("lens") as THREE.Mesh;
const beaconHalo = glow(EMIT_GREEN, 1.6, 0.6);
beaconHalo.position.set(beacon.position.x, beacon.position.y + 0.2, beacon.position.z);
scene.add(beaconHalo);
const beaconLight = new THREE.PointLight(EMIT_GREEN, 0, 4, 2);
beaconLight.position.set(beacon.position.x, beacon.position.y + 0.5, beacon.position.z);
scene.add(beaconLight);
let objective: ObjectiveState = { active: false };

// Line of sight, one mask per level: the facility's walls below; up top the
// lift house and the tall ruins (trees, the scoreboard and the chain-link
// fence are seen through, out to the ruins past it).
// (the blast door comes and goes as it opens: updateSightDoors adds it while it's there)
const visibility = new VisibilityMask(sightBlockers(WALLS.filter((w) => w !== BLAST_DOOR), FIXTURES), SOLID, SIGHT_BOUNDS);
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
// the helicopter in the garden (its twin is part of the tutorial build)
const gardenHeli = helicopter();
gardenHeli.position.set(HELIPADS.garden.x, 0, HELIPADS.garden.z);
gardenHeli.traverse((o) => {
  if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
});
surface.add(gardenHeli);
const gardenRotor = gardenHeli.getObjectByName("rotor")!;
const gardenRoof = gardenHeli.getObjectByName("roof")!;

// The tutorial (client/world/tutorial.ts): built when you walk (or fly, or
// join) into it, thrown away when you leave. Its own sight mask, as its
// rooms have their own walls.
let tutorialView: TutorialView | undefined;
const tutorialVisibility = new VisibilityMask(
  sightBlockers(TUT_WALLS, []),
  [],
  { minX: TUT_BOUNDS.minX - 2, maxX: TUT_BOUNDS.maxX + 2, minZ: TUT_BOUNDS.minZ - 2, maxZ: TUT_BOUNDS.maxZ + 2 },
);
/** this player's tutorial progress, from the server (undefined = not a trainee) */
let myTut: number | undefined;
let myTutHits: number[] | undefined;
let myTutBlasted = false;
/** riding a helicopter: when the ride ends (server time), 0 when not */
let myFlyingUntil = 0;
let lastTutDoorKey = "";

let activeVisibility = visibility;
let viewLevel: "top" | "bottom" | "tutorial" = "bottom";
const minimap = new Minimap();
let myColor = "#ffffff";
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
    // closed, the two leaves overlap here by more than the mask's FACE_INSET trims off each, so sight can't slip down the seam
    const gap = open * D * 0.95 - 0.25;
    const outer = D + 0.4;
    for (const side of [-1, 1]) {
      leaves.push({ x: side * (gap + outer) / 2, z: door.z, halfX: (outer - gap) / 2, halfZ: door.halfZ, halfHeight: door.halfHeight });
    }
  }
  const blast = Math.round(blastDoorOpen(defenceState.evac, now) * 40) / 40;
  key.push(`blast${blast}`);
  const k = key.join(",");
  if (k === lastDoorKey) return;
  lastDoorKey = k;
  visibility.setExtra([...leaves.filter((o) => o.z < SURFACE.minZ), ...evacView.doorOccluders(defenceState.evac, now)]);
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
  /** where they are drawn this frame (also what turret placement keeps clear of) */
  drawn: { x: number; z: number; rotation: number };
  /** alive and down in the facility: someone a spectator can watch */
  watchable: boolean;
  color: string;
  alive: boolean;
  name: string;
}

let myId: string | undefined;
let localMesh: THREE.Object3D | undefined;
let myRespawnAt = 0;
/** out for the rest of this attempt (died while the reactor was live): spectating */
let myOut = false;
/** out only because we joined mid-attempt: watching, not fallen */
let myLate = false;
/** whose view we're watching while out */
let watchingId: string | undefined;
/** wounds taken since we last (re)spawned, as the server sees it */
let myWounds = 0;
/** patched up with this many wounds: the next hit brings them all back */
let myBandaged = 0;
/** the warp count we've caught up with: moves are stamped with it (see PlayerState.warp) */
let myWarp = 0;
/** when we last appeared somewhere new (joined, respawned, rode the lift): markers shout for a few seconds after */
let arrivedAt = 0;
const remotes = new Map<string, RemotePlayer>();
const serverClock = new ServerClock();
const respawnEl = document.getElementById("respawn")!;
const leaderboardEl = document.getElementById("leaderboard")!;
const connectionLostEl = document.getElementById("connection-lost")!;
const controlsEl = document.getElementById("controls")!;
const tipEl = document.getElementById("tip")!;
const versionEl = document.getElementById("version")!;

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



// --- Your name --------------------------------------------------------------
// Arcade style (ADR-060): type a name on joining and that's who you are on
// screen and on the board; no login. The last one typed is offered again.
// The game waits behind the card until the server takes a name.

/** the name the server has us under (undefined until one's taken) */
let myHandle: string | undefined;
const NAME_KEY = "blendspitfire.name";
const nameEl = document.createElement("div");
nameEl.className = "ui-name";
nameEl.innerHTML =
  '<div class="title">sign in for the shift</div>' +
  '<div class="dim">your name on the board · 2–12 letters</div>' +
  `<input maxlength="${NAME_MAX}" spellcheck="false" autocomplete="off" />` +
  '<div class="why"></div>' +
  '<div class="dim">enter: clock in</div>';
document.body.appendChild(nameEl);
const nameInput = nameEl.querySelector<HTMLInputElement>("input")!;
const nameWhy = nameEl.querySelector<HTMLDivElement>(".why")!;
const naming = (): boolean => nameEl.classList.contains("open");
function askName(): void {
  pressed.clear();
  nameEl.classList.add("open");
  let last = "";
  try {
    last = localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    // storage blocked: just an empty box
  }
  nameInput.value = myHandle ?? last;
  nameWhy.textContent = "";
  setTimeout(() => nameInput.focus(), 0);
}
nameInput.addEventListener("input", () => {
  nameInput.value = nameInput.value.toUpperCase();
});
nameInput.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Enter") {
    const name = cleanName(nameInput.value);
    if (!name) {
      nameWhy.textContent = "2 to 12 letters or digits";
      return;
    }
    nameWhy.textContent = "…";
    net.name(name);
  } else if (e.key === "Escape" && myHandle) nameEl.classList.remove("open");
});
function onNameReply(ok: boolean, text: string): void {
  if (!ok) {
    nameWhy.textContent = text;
    return;
  }
  myHandle = text;
  try {
    localStorage.setItem(NAME_KEY, text);
  } catch {
    // remembered for this tab only
  }
  nameEl.classList.remove("open");
  nameInput.blur();
}

// --- Aim -------------------------------------------------------------------

const pressed = new Set<string>();
window.addEventListener("keydown", (e) => {
  if (!naming()) pressed.add(e.key.toLowerCase());
});
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
  /** a turret: shudders until this (performance.now()) after a bite */
  bittenUntil: number;
  /** a turret: performance.now() it last got a fresh aim --- idles (slow sweep) once this goes stale */
  lastAimAt: number;
}

/** idle, a turret sweeps on its own rather than sitting dead still, like a sentry scanning its lane */
const TURRET_IDLE_AFTER_MS = 1500;
const TURRET_IDLE_SPEED = 0.6;

const items = new Map<string, ClientItem>();
/** walls, rocks, and turrets on the ground, as of the last state broadcast */
let obstacles: Obstacle[] = OBSTACLES;
/** the secondary action toggles this while ordering a turret; it stays put between orders */
let gridSnap = false;

const outlineInReach = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, transparent: true });
const outlineOutOfReach = new THREE.MeshBasicMaterial({
  color: STENCIL,
  side: THREE.BackSide,
  transparent: true,
  opacity: 0.35,
});
/** a loose gun nobody's pointing at: a faint glint now and then, so it can be found on the floor */
const outlineGlint = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, transparent: true, opacity: 0 });

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
  } else if (state.kind === "grenade") {
    lying = grenade();
    shape = lying.children[0] as THREE.Mesh;
    // in the right hand, at the hip
    held = grenade();
    held.position.set(0.32, 0.8, 0.2);
  } else {
    // a turret: the only blocking kind
    lying = sentryTurret();
    shape = lying.children[0] as THREE.Mesh;
    held = sentryTurret();
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
  return { state, lying, held, outline, bittenUntil: 0, lastAimAt: 0 };
}

function removeItem(item: ClientItem): void {
  scene.remove(item.lying);
  item.held.removeFromParent();
}

// A turret that's chewed shows it: it shudders at each bite, and slumps and
// tilts further the closer it is to giving way. When it breaks, a puff of
// dust where it stood, so it doesn't just vanish.
const dustPuffs: { sprite: THREE.Sprite; born: number }[] = [];
function turretBroke(x: number, z: number): void {
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

function updateItems(all: ItemState[]): void {
  const seen = new Set<string>();
  // someone else's tutorial props are theirs alone: not drawn, not offered (unless they're carrying it)
  const incoming = all.filter((i) => i.owner === undefined || i.owner === myId || i.heldBy !== undefined);
  for (const state of incoming) {
    seen.add(state.id);
    const existing = items.get(state.id);
    if (existing) {
      if ((state.wear ?? 0) > (existing.state.wear ?? 0)) existing.bittenUntil = performance.now() + 180;
      if (state.aim !== undefined && state.aim !== existing.state.aim) existing.lastAimAt = performance.now();
      existing.state = state;
    } else items.set(state.id, makeItem(state));
  }
  for (const [id, item] of items) {
    if (!seen.has(id)) {
      // a chewed turret that's gone from the ground was torn down (rather than scrapped, which keeps it in the list)
      if (BLOCKING_KINDS.has(item.state.kind) && item.state.heldBy === undefined && item.state.wear) turretBroke(item.state.x, item.state.z);
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
 * Where a turret being ordered would land: the cursor's ground point, pulled in to
 * placement range, then snapped if grid snap is on. Pulled in a bit
 * further when snapping, so rounding to the grid can't push a spot that
 * looked in range back out of it.
 */
function placeTarget(): { x: number; z: number } {
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

function livingBodies(): { x: number; z: number }[] {
  const bodies: { x: number; z: number }[] = [];
  if (localMesh) bodies.push({ x: localMesh.position.x, z: localMesh.position.z });
  for (const remote of remotes.values()) {
    if (remote.mesh.visible) bodies.push({ x: remote.drawn.x, z: remote.drawn.z });
  }
  return bodies;
}

function turretCount(): number {
  return [...items.values()].filter((i) => i.state.kind === "turret").length;
}

/** where a turret being ordered would go, and whether it can: same spot and footprint as any placed blocker, plus the quota and the corp's cap */
function turretVerdict(target: { x: number; z: number }): BuildTurretVerdict {
  return buildTurretVerdict(target.x, target.z, localMesh!.position, obstacles, livingBodies(), funds, turretCount());
}

/** true while a turret's been ordered and is waiting for a spot: click to build it there, Q/Esc to cancel */
let placingTurret = false;

const throwRing = new THREE.Mesh(
  new THREE.RingGeometry(GRENADE_RADIUS - 0.12, GRENADE_RADIUS, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: STENCIL, transparent: true, depthWrite: false }),
);
throwRing.visible = false;
scene.add(throwRing);

// the turret's own shape, tinted OK/DANGER, so what's about to be built is
// unmistakable rather than a stand-in block
const turretPreviewMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false });
const turretPreview = sentryTurret();
turretPreview.traverse((o) => {
  const m = o as THREE.Mesh;
  if (m.isMesh) m.material = turretPreviewMaterial;
});
turretPreview.visible = false;
scene.add(turretPreview);

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
  // a short swell every 2.5 s, dark between: noticed from across the room, not a lit-up floor
  const glint = Math.max(0, Math.sin((time * Math.PI * 2) / 2.5));
  outlineGlint.opacity = 0.35 * glint ** 6;

  for (const item of items.values()) {
    const { state, lying, held, outline } = item;
    const isHovered = hovered?.item === item;
    const glints = !isHovered && state.kind === "gun" && state.heldBy === undefined;
    outline.visible = isHovered || glints;
    if (glints) outline.material = outlineGlint;
    else if (hovered && isHovered) outline.material = hovered.inReach ? outlineInReach : outlineOutOfReach;

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
      if (state.kind === "turret") {
        const head = lying.getObjectByName("turretHead")!;
        if (state.aim !== undefined && performance.now() - item.lastAimAt < TURRET_IDLE_AFTER_MS) {
          // the head swings toward what it last shot at, quickly but not in one snap
          let d = state.aim - head.rotation.y;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          head.rotation.y += d * Math.min(1, frameDt * 14);
        } else {
          // nothing to shoot at for a while: it sweeps its lane on its own, like a sentry scanning
          head.rotation.y += TURRET_IDLE_SPEED * frameDt;
        }
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
  // holding a grenade: a ring on the floor where it'll land, the blast's size
  const showThrow = !dead && !!localMesh && held?.state.kind === "grenade";
  throwRing.visible = showThrow;
  if (showThrow) {
    const land = grenadeLanding(localMesh!.position, aimPoint.x, aimPoint.z, obstacles);
    throwRing.position.set(land.x, 0.04, land.z);
    (throwRing.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.15 * pulse;
  }
  const showTurretPreview = !dead && !!localMesh && placingTurret;
  turretPreview.visible = showTurretPreview;
  snapGrid.visible = showTurretPreview && gridSnap;
  if (showTurretPreview) {
    const target = placeTarget();
    const sinceRefused = time - refusedAt;
    const shake = sinceRefused < 0.3 ? Math.sin(sinceRefused * 60) * 0.12 : 0;
    turretPreview.position.set(target.x + shake, 0, target.z);
    turretPreviewMaterial.color.setHex(turretVerdict(target) === "ok" ? OK : DANGER);
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
  ready: "ready for the next wave",
  "already active": "already active — defend it",
  stable: "reactor stable — out by the freight lift, north",
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
  | { kind: "scrap"; item: ClientItem }
  | { kind: "reactor" }
  | { kind: "lift" }
  | { kind: "terminal" }
  | { kind: "board" }
  | { kind: "heli" }
  | { kind: "freight" };

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
  if (padAt(p.x, p.z)) return { kind: "heli" };
  if (nearLiftButton()) return { kind: "lift" };
  if (Math.hypot(p.x - FREIGHT_PANEL.x, p.z - FREIGHT_PANEL.z) <= FREIGHT_PANEL_RANGE) return { kind: "freight" };
  const held = myHeldItem();
  if (!held) {
    const item = nearestItem();
    // a built turret never leaves the floor by picking it up --- E on one tears it down instead
    if (item?.state.kind === "turret") return { kind: "scrap", item };
    if (item) return { kind: "item", item };
  }
  if (atTerminal(p)) return { kind: "terminal" };
  if (Math.hypot(p.x - REACTOR.x, p.z - REACTOR.z) <= REACTOR.halfX + PICKUP_RANGE) return { kind: "reactor" };
  if (Math.hypot(p.x - SCOREBOARD.x, p.z - SCOREBOARD.z) <= SCOREBOARD_RANGE) return { kind: "board" };
  return undefined;
}

const FREIGHT_LABELS: Record<FreightVerdict, string> = {
  start: "start the freight lift",
  "too far": "move closer",
  "not yet": "freight lift: no power",
  "already going": "freight lift going up",
};
function freightNow(): FreightVerdict {
  return freightVerdict(localMesh!.position, defenceState.phase, blastDoorOpen(defenceState.evac, serverClock.now()), defenceState.evac?.boardBy !== undefined);
}

function shopVerdict(item: ShopItem): BuyVerdict {
  return buyVerdict(item, localMesh!.position, { wounds: myWounds, holding: !!myHeldItem() }, funds, turretCount());
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
    '<div class="legend">turret: pick its spot, pay when it\'s built · scrap with E</div>' +
    '<div class="legend">field dressing: patches every wound now; the next hit tears it open</div>' +
    '<div class="legend">grenade: one throw, blasts a crowd · kills a spitter outright</div>' +
    '<div class="legend">1 / 2 / 3 to order · E / Esc to close</div></div>';
  if (html === lastShopHtml) return;
  lastShopHtml = html;
  shopEl.innerHTML = html;
}
function order(item: ShopItem): void {
  if (!shopOpen) return;
  if (shopVerdict(item) !== "ok") {
    flash(BUY_REASONS[shopVerdict(item)]);
    return;
  }
  if (item === "turret") {
    // ordering a turret doesn't hand it over: it opens its placement
    // preview, and only paying for a spot that actually passes builds it
    placingTurret = true;
    toggleShop(false);
    return;
  }
  net.buy(item);
}
shopEl.addEventListener("pointerdown", (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>("[data-item]");
  if (row) order(row.dataset.item as ShopItem);
});
setInterval(() => {
  if (shopOpen && eTarget()?.kind !== "terminal") toggleShop(false);
  renderShop();
}, 150);

// --- The ready vote ------------------------------------------------------------
// In a break, X (a tap, anywhere below) says you're ready for the next wave;
// pressed again it takes it back. Once everyone alive below is ready the
// wave comes 3 s later; otherwise the break runs its course. E at the
// reactor is the same vote.

const amReady = (): boolean => !!myId && (defenceState.ready ?? []).includes(myId);
const readyCount = (): string => `${defenceState.ready?.length ?? 0}/${defenceState.voters ?? 0} ready`;
function canVote(): boolean {
  return !!localMesh && !isDead() && objective.active && defenceState.phase === "break" && levelOf(localMesh.position.z) === "bottom";
}
function toggleReady(): void {
  if (!canVote()) {
    if (localMesh && !isDead()) flash(objective.active && defenceState.phase !== "break" ? "ready vote: only between waves" : "ready vote: only below, between waves");
    return;
  }
  net.ready();
}

function useTarget(target: Target | undefined): void {
  if (!target || !localMesh) return;
  if (target.kind === "item") net.pickup(target.item.state.id);
  else if (target.kind === "scrap") net.scrap(target.item.state.id);
  else if (target.kind === "reactor") {
    const verdict = activateVerdict(localMesh.position, objective, defenceState.phase);
    if (verdict === "ok" || verdict === "ready") net.activate();
    else prompts.nope("reactor");
  } else if (target.kind === "freight") {
    if (freightNow() === "start") net.freight();
    else prompts.nope("freight");
  } else if (target.kind === "lift") {
    const verdict = liftVerdict(localMesh.position, lift, objective, defenceState.phase);
    if (verdict === "send" || verdict === "call") net.lift();
    else prompts.nope("lift");
  } else if (target.kind === "heli") {
    const v = heliVerdict();
    if (v === "ok") net.heli();
    else prompts.nope("heli");
  } else if (target.kind === "terminal") toggleShop();
  else if (target.kind === "board") toggleBoard();
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** mirrors the server's takeOff(): what E in a cabin would do */
function heliVerdict(): "ok" | "flying" | "lessons" | "hands full" {
  const p = localMesh!.position;
  if (myFlyingUntil) return "flying";
  const from = padAt(p.x, p.z);
  if (from === "tutorial" && myTut !== undefined && myTut < LESSONS.length - 1) return "lessons";
  if (from === "garden" && myHeldItem()) return "hands full";
  return "ok";
}
const HELI_LABELS = { ok: "take off", flying: "in the air", lessons: "finish the lessons first", "hands full": "hands full: put it down (Q)" } as const;

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
  } else if (target?.kind === "scrap") {
    const s = target.item.state;
    out.push({ id: `scrap:${s.id}`, at: v3(s.x, 0.9, s.z), key: "E", label: "scrap turret", detail: "no refund" });
  } else if (target?.kind === "reactor") {
    const verdict = activateVerdict(p, objective, defenceState.phase);
    const label = verdict === "ready" && amReady() ? "not ready after all" : ACTIVATE_TIPS[verdict];
    const detail = verdict === "ready" ? readyCount() : undefined;
    if (verdict !== "already active") out.push({ id: "reactor", at: v3(REACTOR.x - 0.6, 1.9, REACTOR.z + 0.4), key: verdict === "stable" || verdict === "dead" ? "" : "E", label, detail, enabled: verdict === "ok" || verdict === "ready" });
  } else if (target?.kind === "terminal") {
    const t = SUPPLY_TERMINAL;
    out.push({ id: "terminal", at: v3(t.x - 0.8, 1.9, t.z + 0.3), key: "E", label: shopOpen ? "close supply uplink" : "order supply", detail: `crew quota: ${funds}` });
  } else if (target?.kind === "board") {
    out.push({ id: "board", at: v3(SCOREBOARD.x - 1.2, 2.6, SCOREBOARD.z), key: "E", label: boardOpen ? "close scores" : "read scores" });
  } else if (target?.kind === "heli") {
    const from = padAt(p.x, p.z)!;
    const pad = HELIPADS[from];
    const v = heliVerdict();
    out.push({ id: "heli", at: v3(pad.x - CABIN.halfX, 1.6, pad.z - 0.6), key: v === "flying" ? "" : "E", label: HELI_LABELS[v], enabled: v === "ok", detail: from === "tutorial" ? "to the dig site" : "back to the training shed" });
  } else if (target?.kind === "lift") {
    const level = levelOf(p.z);
    const verdict = liftVerdict(p, lift, objective, defenceState.phase);
    let detail: string | undefined;
    if (verdict === "already leaving" && lift.departAt) detail = `doors close in ${Math.max(0, Math.ceil((lift.departAt - now) / 1000))}s`;
    if (verdict === "send") detail = level === "top" ? "down to the facility" : "back up — leaves this attempt";
    if (verdict === "attempt on" && defenceState.phase === "won") detail = "the way out's the freight lift, north";
    if (verdict === "attempt on" && defenceState.phase === "blackout") detail = "no power — no way out";
    if (verdict === "busy" && lift.phase === "moving") detail = `${Math.max(0, Math.ceil(((lift.until ?? now) - now) / 1000))}s`;
    out.push({ id: "lift", at: liftPanelAt(level), key: "E", label: LIFT_LABELS[verdict], enabled: verdict === "send" || verdict === "call", detail });
  } else if (target?.kind === "freight") {
    const v = freightNow();
    const e = defenceState.evac;
    const detail = v === "already going" && e?.boardBy ? `leaving in ${Math.max(0, Math.ceil((e.boardBy - now) / 1000))}s` : v === "start" ? `the rest get ${FREIGHT_BOARD_MS / 1000}s to board` : undefined;
    out.push({ id: "freight", at: v3(FREIGHT_PANEL.x - 0.8, 1.9, FREIGHT_PANEL.z), key: v === "start" ? "E" : "", label: FREIGHT_LABELS[v], enabled: v === "start", detail });
  }
  // the lift's countdown hangs over its door for everyone on that level, button or not
  if (lift.phase === "open" && lift.departAt && levelOf(p.z) === lift.at && target?.kind !== "lift") {
    const d = LIFT_DOORS[lift.at];
    out.push({ id: "lift-count", at: v3(d.x - 1.6, 2.4, d.z), label: `lift leaves in ${Math.max(0, Math.ceil((lift.departAt - now) / 1000))}s` });
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
      if (verdict === "ok" || verdict === "ready") cursor = "pointer";
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

// --- Markers: where to go next ------------------------------------------------
// Snap markers (client/ui/markers.ts) point at what matters on this level:
// faint when it's just there to be found, loud when it's what to do now.
// One gives way to the E prompt once you're standing at the thing.

const markers = new Markers();
/** how long after arriving somewhere the way on stays loud */
const ARRIVAL_LOUD_MS = 8000;
const MARKER_NEAR = 2.6;

function currentMarkers(): Marker[] {
  const out: Marker[] = [];
  if (!localMesh || isDead() || myOut) return out;
  const p = localMesh.position;
  const from = { x: p.x, z: p.z };
  const level = levelOf(p.z);
  if (inAnyCar(p.x, p.z) || padAt(p.x, p.z)) return out;
  const now = serverClock.now();
  const fresh = performance.now() - arrivedAt < ARRIVAL_LOUD_MS;
  // standing at the thing, its E prompt says it all
  const using = eTarget()?.kind;
  const add = (m: Marker & { near?: { x: number; z: number } }): void => {
    const near = m.near ?? m.at;
    if (Math.hypot(near.x - p.x, near.z - p.z) < MARKER_NEAR) return;
    if ((m.id === "m-reactor" && using === "reactor") || (m.id === "m-comms" && using === "terminal") || (m.id === "m-board" && using === "board")) return;
    out.push({ ...m, from });
  };
  if (inTutorial(p.x, p.z)) return tutorialMarkers(p, from);
  const door = LIFT_DOORS[level];
  const leaving = lift.phase === "open" && lift.at === level && lift.departAt !== undefined;
  const leavesIn = leaving ? Math.max(0, Math.ceil((lift.departAt! - now) / 1000)) : 0;
  if (level === "top") {
    const locked = attemptLocked();
    add({ id: "m-lift", at: v3(door.x, 2.4, door.z), near: door, label: locked ? "lift · locked" : "lift · to the facility", detail: leaving ? `leaves in ${leavesIn}s` : undefined, loud: !locked && (leaving || fresh) });
    add({ id: "m-board", at: v3(SCOREBOARD.x, 2.8, SCOREBOARD.z), label: "scores" });
    add({ id: "m-heli", at: v3(HELIPADS.garden.x, 2.6, HELIPADS.garden.z), label: "helicopter · training" });
    return out;
  }
  const phase = defenceState.phase;
  if (!objective.active) {
    add({ id: "m-reactor", at: v3(REACTOR.x, 2.4, REACTOR.z), near: REACTOR, label: "activate the reactor", loud: true });
  } else if (phase === "break" && breakPrompts()) {
    add({ id: "m-comms", at: v3(SUPPLY_TERMINAL.x, 2.2, SUPPLY_TERMINAL.z), near: SUPPLY_TERMINAL, label: "comms · order supply", detail: `quota ${funds}`, loud: true });
  } else if (phase === "won") {
    // the way out: the blast door, then the freight lift's panel behind it
    const e = defenceState.evac;
    const st = e ? evacStage(e, now) : undefined;
    const panel = { x: FREIGHT_PANEL.x, z: FREIGHT_PANEL.z };
    if (st?.stage === "lights" || st?.stage === "opening") add({ id: "m-evac", at: v3(BLAST_DOOR.x, 2.8, BLAST_DOOR.z), near: { x: BLAST_DOOR.x, z: BLAST_DOOR.z + 2 }, label: "blast door opening", loud: true });
    else if (st?.stage === "open") add({ id: "m-evac", at: v3(panel.x, 2.2, panel.z), near: panel, label: "freight lift · start it", loud: true });
    else if (st?.stage === "boarding" && !inFreight(p.x, p.z)) add({ id: "m-evac", at: v3(FREIGHT_PANEL.x, 2.2, (FREIGHT.minZ + FREIGHT.maxZ) / 2), near: { x: FREIGHT_PANEL.x, z: FREIGHT.maxZ }, label: "get on the freight lift", detail: `${Math.ceil(st.left / 1000)}s`, loud: true });
  }
  // underground the lift is always findable before the attempt locks it in
  if (!objective.active) {
    add({ id: "m-lift", at: v3(door.x, 2.4, door.z), near: door, label: "lift · back up", detail: leaving ? `leaves in ${leavesIn}s` : undefined, loud: leaving });
  }
  return out;
}

/**
 * In the tutorial: one loud marker on what this lesson wants (the pad, the
 * rifle, the targets still standing, the mat, the grenade then the huddle,
 * the helicopter), and once it's done, the door that's just opened.
 */
function tutorialMarkers(p: THREE.Vector3, from: { x: number; z: number }): Marker[] {
  const stage = myTut ?? LESSONS.length - 1;
  const lesson = LESSONS[Math.min(stage, LESSONS.length - 1)];
  const here = roomAt(p.x, p.z);
  const out: Marker[] = [];
  const mark = (id: string, x: number, z: number, label: string, y = 1.6) => {
    if (Math.hypot(x - p.x, z - p.z) < 1.2) return;
    out.push({ id, at: v3(x, y, z), label, loud: true, from });
  };
  // behind on the lessons (respawned, wandered back): the way on
  if (here >= 0 && here < stage && stage < LESSONS.length) {
    const d = tutDoor(here);
    mark("t-door", d.x, d.z, "this way");
    return out;
  }
  const held = myHeldItem();
  const mine = (kind: string) => [...items.values()].find((i) => i.state.owner === myId && i.state.kind === kind && i.state.heldBy === undefined);
  if (lesson === "move") mark("t-goal", MOVE_PAD.x, MOVE_PAD.z, "walk here · WASD", 0.6);
  else if (lesson === "pickup") {
    const gun = mine("gun");
    const g = gun?.state ?? TUT_GUN_AT;
    mark("t-goal", g.x, g.z, "rifle · E to pick up", 0.8);
  } else if (lesson === "shoot") {
    TUT_TARGETS.forEach((t, i) => {
      if ((myTutHits?.[i] ?? 0) < 3) out.push({ id: `t-target${i}`, at: v3(t.x, 1.6, t.z), label: held ? "shoot" : "pick the rifle back up", loud: true, from });
    });
  } else if (lesson === "drop") mark("t-goal", DROP_PAD.x, DROP_PAD.z, held ? "put it down here · Q" : "rifle · E, then Q on the mat", 0.6);
  else if (lesson === "grenade") {
    const g = mine("grenade");
    if (held?.state.kind === "grenade") {
      const c = TUT_CLUSTER[0];
      mark("t-goal", c.x, c.z, "throw it here · click", 1.8);
    } else if (g) mark("t-goal", g.state.x, g.state.z, "grenade · E to pick up", 0.8);
  } else if (lesson === "fly") mark("t-goal", HELIPADS.tutorial.x, HELIPADS.tutorial.z, "helicopter · step in, E", 2.4);
  return out;
}

/** mirrors the server's attemptLocked(): an attempt is on (a won one leaves by the freight lift) */
function attemptLocked(): boolean {
  return objective.active;
}

// The lift's prep countdown, big and top-centre on every screen whatever
// level you're on: whoever wants to come has these seconds to get in.
const countdownEl = document.createElement("div");
countdownEl.className = "ui-countdown";
countdownEl.innerHTML = '<div class="cd-num"></div><div class="cd-text"></div>';
document.body.appendChild(countdownEl);
const countdownNum = countdownEl.querySelector<HTMLDivElement>(".cd-num")!;
const countdownText = countdownEl.querySelector<HTMLDivElement>(".cd-text")!;
let lastCountdown = "";
function renderCountdown(): void {
  const on = lift.phase === "open" && lift.departAt !== undefined && !!localMesh && !inTutorial(localMesh.position.x, localMesh.position.z);
  countdownEl.classList.toggle("open", on);
  if (!on) return;
  const left = Math.max(0, Math.ceil((lift.departAt! - serverClock.now()) / 1000));
  const p = localMesh!.position;
  const aboard = inCar(lift.at, p.x, p.z);
  const here = levelOf(p.z) === lift.at;
  const dir = lift.at === "top" ? "down to the facility" : "up to the surface";
  const text = aboard ? `you're aboard · ${dir}` : here ? `get in the lift to come · ${dir}` : `lift leaving the ${lift.at === "top" ? "surface" : "facility"}`;
  const key = `${left}|${text}`;
  if (key === lastCountdown) return;
  lastCountdown = key;
  countdownNum.textContent = `${left}`;
  countdownText.textContent = text;
}

function stepBeacon(time: number): void {
  const lit = objective.active && defenceState.phase === "break" && powerLevel !== "out";
  const pulse = 0.75 + 0.25 * Math.sin(time * 4);
  (beaconLens.material as THREE.MeshBasicMaterial).color.setScalar(lit ? 1 : 0.12);
  beaconHalo.visible = lit;
  beaconHalo.material.opacity = 0.55 * pulse;
  beaconLight.intensity = lit ? 2.2 * pulse : 0;
}

let lastControlsText = "";
function renderControls(): void {
  const held = myHeldItem();
  let text: string;
  if (myOut) {
    text = myLate ? "watching the crew until this attempt ends" : "you're out until this attempt ends";
  } else if (placingTurret) {
    text = `WASD move · click: build turret (${TURRET_COST} quota) · right-click / Space: grid snap (${gridSnap ? "on" : "off"}) · Q / Esc: cancel`;
  } else if (!held) {
    text = "WASD move · E use";
  } else {
    const info = ITEM_KINDS[held.state.kind];
    const parts = [held.state.kind === "gun" ? "click / hold: fire" : `click: ${info.primaryLabel}`];
    if (info.secondaryLabel) {
      parts.push(`right-click / Space: ${info.secondaryLabel}`);
    }
    parts.push("Q: drop");
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
  for (const s of spits.values()) scene.remove(s.blob, s.ring);
  spits.clear();
  for (const g of thrown.values()) scene.remove(g.mesh, g.ring);
  thrown.clear();
  obstacles = OBSTACLES;
}

const net = connect({
  onConnectionChange(connected) {
    connectionLostEl.style.display = connected ? "none" : "block";
  },
  onWelcome(you, players, t, version) {
    // also fires on every reconnect, so start from a clean scene rather
    // than piling a new set of meshes on top of the last session's
    clearSceneState();
    serverClock.observe(t);
    versionEl.textContent = version;
    myId = you.id;
    myHandle = you.handle;
    if (!myHandle) askName();
    myRespawnAt = you.respawnAt ?? 0;
    myOut = !!you.out;
    myLate = !!you.late;
    myWounds = you.wounds ?? 0;
    myBandaged = you.bandaged ?? 0;
    myWarp = you.warp ?? 0;
    myTut = you.tut;
    arrivedAt = performance.now();
    myColor = you.color;
    localMesh = makeCharacter(you.color, true);
    localMesh.position.set(you.x, 0, you.z);
    for (const p of players) {
      if (p.id !== myId) addOrUpdateRemote(p, t);
    }
    renderLeaderboard(players);
  },
  onBoard(b) {
    lastBoard = b;
    renderBoard(b);
  },
  onNameReply,
  onReplaced() {
    connectionLostEl.textContent = "open in another tab — this one is paused";
    connectionLostEl.style.display = "block";
  },
  onState(state) {
    const { t, players } = state;
    serverClock.observe(t);
    const seenPlayers = new Set<string>();
    objective = state.objective;
    if (state.defence.phase === "break" && defenceState.phase !== "break") breakSince = defenceState.phase === "spawning" && defenceState.wave > 0 ? performance.now() : -Infinity;
    defenceState = state.defence;
    funds = state.funds;
    if (state.lift) lift = state.lift;
    for (const line of state.announcements ?? []) showBanner(line);
    for (const r of state.reports ?? []) queueReport(r);
    for (const p of players) {
      if (p.id === myId) {
        myRespawnAt = p.respawnAt ?? 0;
        myOut = !!p.out;
        myLate = !!p.late;
        const wounds = p.wounds ?? 0;
        if (wounds > myWounds) onWounded(wounds, myBandaged > 0);
        else if (wounds < myWounds && (p.bandaged ?? 0) > 0) showBanner("patched up — the next hit tears it open");
        myWounds = wounds;
        myBandaged = p.bandaged ?? 0;
        myTut = p.tut;
        myTutHits = p.tutHits;
        myTutBlasted = !!p.tutBlasted;
        myFlyingUntil = p.flyingUntil ?? 0;
        // the server moved us (a respawn, a lift ride): jump there now, and
        // stamp moves from here on with the new count
        if (localMesh && (p.warp ?? 0) !== myWarp) {
          myWarp = p.warp ?? 0;
          arrivedAt = performance.now();
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
    updateSpits(state.spits);
    updateGrenades(state.grenades, state.blasts);
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
    // someone else's round (a teammate, a turret): its muzzle shimmers here; ours did on the click
    if (p.ownerId !== myId) impacts.muzzle(p.x, p.z);
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
 * ray-cast against walls and turrets), so when its copy arrives the swap is
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
  impacts.muzzle(x, z);
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
  if (placingTurret) {
    const target = placeTarget();
    const verdict = turretVerdict(target);
    if (verdict === "ok") {
      net.buildTurret(target.x, target.z);
      placingTurret = false;
    } else {
      refusedAt = clock.elapsedTime;
      flash(`can't build: ${verdict}`);
    }
    return;
  }
  const held = myHeldItem();
  // a click with something in hand is that item's action (firing over the reactor is firing); E still works
  if (hoveringReactor() && !held) {
    const verdict = activateVerdict(localMesh.position, objective, defenceState.phase);
    if (verdict === "ok" || verdict === "ready") net.activate();
    else flash(ACTIVATE_TIPS[verdict]);
    return;
  }
  if (!held) {
    const hovered = hoveredItem();
    if (hovered?.inReach && hovered.item.state.kind === "turret") net.scrap(hovered.item.state.id);
    else if (hovered?.inReach) net.pickup(hovered.item.state.id);
    else if (hovered) flash("move closer");
    return;
  }
  if (held.state.kind === "gun") {
    triggerHeld = true;
    fireGun(true);
  } else if (held.state.kind === "grenade") {
    if (noFireAt(localMesh.position.x, localMesh.position.z)) {
      flash("no throwing in the lift");
      return;
    }
    net.primary(aimPoint.x, aimPoint.z);
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
  if (placingTurret) gridSnap = !gridSnap;
}

function drop(): void {
  if (isDead()) return;
  if (placingTurret) {
    placingTurret = false;
    return;
  }
  const held = myHeldItem();
  if (!held) return;
  net.drop();
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
  if (naming()) return;
  const key = e.key.toLowerCase();
  // Space would otherwise scroll, or "click" whatever link has focus
  if (key === " ") e.preventDefault();
  if (e.repeat) return;
  if (key === " ") secondary();
  else if (key === "q") drop();
  else if (key === "e") useTarget(eTarget());
  else if (key === "x") toggleReady();
  else if (key === "n" && boardOpen) {
    toggleBoard();
    askName();
  } else if (key === "escape" && boardOpen) toggleBoard();
  else if (key === "escape" && shopOpen) toggleShop(false);
  else if (key === "escape" && placingTurret) placingTurret = false;
  else if (shopOpen) {
    const item = SHOP_ITEMS.find((i) => SHOP[i].key === key);
    if (item) order(item);
  }
});

function addOrUpdateRemote(p: PlayerState, t: number): void {
  let remote = remotes.get(p.id);
  if (!remote) {
    remote = { mesh: makeCharacter(p.color, false), snaps: new SnapshotBuffer(), drawn: { x: p.x, z: p.z, rotation: p.rotation }, watchable: false, color: p.color, alive: true, name: p.name ?? "crew" };
    remote.mesh.position.set(p.x, 0, p.z);
    remotes.set(p.id, remote);
  }
  remote.snaps.push(t, p.x, p.z, p.rotation);
  // the server only sends respawnAt / out while someone's dead
  const alive = p.respawnAt === undefined && !p.out;
  remote.mesh.visible = alive;
  remote.alive = alive;
  remote.watchable = alive && !!p.entered;
}

// --- Enemies -----------------------------------------------------------------
// Drawn like other players: played back from snapshots, a little in the
// past, so they move smoothly however the updates arrive. A health bar over
// each once it's been hit, and a flash when a shot lands.

interface ClientEnemy {
  mesh: THREE.Object3D;
  eyes: CrawlerEyes;
  snaps: SnapshotBuffer;
  drawn: { x: number; z: number; rotation: number };
  health: number;
  bar: THREE.Mesh;
  hitUntil: number;
  /** drawn scale: a brute is bigger */
  size: number;
  /** a runner's amber spine, pulsed as it runs */
  spine?: THREE.Object3D;
}
const enemies = new Map<string, ClientEnemy>();
let defenceState: DefenceState = { reactorHealth: 1, wave: 0, phase: "spawning" };
/**
 * When this break began (performance.now()), so a wave's end arrives in
 * steps rather than all at once (ADR-060): the banner first, the report
 * BREAK_REPORT_MS later, then the ready card and the comms marker once
 * it's been read. A break you joined part-way through counts as long begun.
 */
let breakSince = -Infinity;
const BREAK_REPORT_MS = 1500;
const BREAK_PROMPTS_MS = 5000;
const breakPrompts = (): boolean => defenceState.phase === "break" && performance.now() - breakSince >= BREAK_PROMPTS_MS;
/** the crew's shared quota, as the server last said */
let funds = 0;
const ITEM_NAMES: Record<ItemKind, string> = { gun: "rifle", turret: "turret", grenade: "grenade" };
const enemyBarGeometry = new THREE.PlaneGeometry(0.7, 0.07).rotateX(-Math.PI / 2);
const ENEMY_MODELS: Record<EnemyKind, () => THREE.Group> = { crawler, spitter, brute, runner };
/** where each kind's eye flare sits (height, forward), in its own model's space */
const EYE_SPOT: Record<EnemyKind, [number, number]> = { crawler: [0.48, 0.66], spitter: [0.66, 0.6], brute: [0.48, 0.74], runner: [0.42, 0.66] };

function updateEnemies(incoming: EnemyState[], t: number): void {
  const seen = new Set<string>();
  for (const e of incoming) {
    seen.add(e.id);
    let ce = enemies.get(e.id);
    if (!ce) {
      const mesh = ENEMY_MODELS[e.kind]();
      const eyes = crawlerEyes(restingAngle(e.id));
      // a runner trails a warm smear of light down its back: the thing you track across a dark room
      if (e.kind === "runner") {
        const trail = glow(EMIT_AMBER, 1.1, 0.5);
        trail.position.set(0, 0.55, -0.25);
        trail.name = "spine-glow";
        mesh.getObjectByName("spine")?.add(trail);
      }
      const [eyeY, eyeZ] = EYE_SPOT[e.kind];
      eyes.group.position.set(0, eyeY, eyeZ);
      mesh.add(eyes.group);
      const bar = new THREE.Mesh(enemyBarGeometry, new THREE.MeshBasicMaterial({ color: DANGER, depthTest: false }));
      bar.position.set(0, 1.0, 0);
      bar.renderOrder = 10;
      bar.visible = false;
      mesh.add(bar);
      mesh.position.set(e.x, 0, e.z);
      scene.add(mesh);
      ce = { mesh, eyes, snaps: new SnapshotBuffer(), drawn: { x: e.x, z: e.z, rotation: e.rotation }, health: e.health, bar, hitUntil: 0, size: e.kind === "brute" ? BRUTE_SCALE : 1, spine: mesh.getObjectByName("spine") };
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

// A spitter's glob: a glowing blob lobbed on an arc from thrower to where
// its target stood, with a ring on the floor where it'll come down --- it's
// slow enough to step out of, so the landing spot is shown. A splash of
// acid where it lands.
interface ClientSpit {
  state: SpitState;
  blob: THREE.Sprite;
  ring: THREE.Mesh;
}
const spits = new Map<string, ClientSpit>();
const spitRingGeometry = new THREE.RingGeometry(SPIT_SPLASH * 0.8, SPIT_SPLASH, 20).rotateX(-Math.PI / 2);

function updateSpits(incoming: SpitState[]): void {
  const seen = new Set<string>();
  for (const s of incoming) {
    seen.add(s.id);
    if (spits.has(s.id)) continue;
    const blob = glow(EMIT_ACID, 0.45, 1);
    const ring = new THREE.Mesh(spitRingGeometry, new THREE.MeshBasicMaterial({ color: EMIT_ACID, transparent: true, opacity: 0.5, depthWrite: false }));
    ring.position.set(s.tx, 0.04, s.tz);
    scene.add(blob, ring);
    spits.set(s.id, { state: s, blob, ring });
  }
  for (const [id, cs] of spits) {
    if (seen.has(id)) continue;
    // gone from the server: it landed
    impacts.hit("enemy", cs.state.tx, cs.state.tz, cs.state.tx - cs.state.x, cs.state.tz - cs.state.z);
    scene.remove(cs.blob, cs.ring);
    spits.delete(id);
  }
}

function stepSpits(time: number): void {
  const now = serverClock.now();
  for (const cs of spits.values()) {
    const s = cs.state;
    const k = Math.min(1, Math.max(0, (now - s.firedAt) / (s.arriveAt - s.firedAt)));
    cs.blob.position.set(s.x + (s.tx - s.x) * k, 0.6 + Math.sin(k * Math.PI) * 1.4, s.z + (s.tz - s.z) * k);
    // the ring tightens and brightens as it comes down
    (cs.ring.material as THREE.MeshBasicMaterial).opacity = 0.3 + 0.5 * k + 0.1 * Math.sin(time * 20);
    cs.ring.scale.setScalar(1.4 - 0.4 * k);
  }
}

// Grenades: arcing to their spot, then sitting there with the fuse lamp
// blinking faster and the blast's reach drawn round them, until they go.
interface ClientGrenade {
  state: GrenadeState;
  mesh: THREE.Object3D;
  ring: THREE.Mesh;
}
const thrown = new Map<string, ClientGrenade>();
const blastRingGeometry = new THREE.RingGeometry(GRENADE_RADIUS - 0.15, GRENADE_RADIUS, 32).rotateX(-Math.PI / 2);

function updateGrenades(incoming: GrenadeState[], blasts: { x: number; z: number }[] | undefined): void {
  const seen = new Set<string>();
  for (const g of incoming) {
    seen.add(g.id);
    if (thrown.has(g.id)) continue;
    const mesh = grenade();
    const ring = new THREE.Mesh(blastRingGeometry, new THREE.MeshBasicMaterial({ color: DANGER, transparent: true, opacity: 0, depthWrite: false }));
    ring.position.set(g.tx, 0.04, g.tz);
    scene.add(mesh, ring);
    thrown.set(g.id, { state: g, mesh, ring });
  }
  for (const [id, cg] of thrown) {
    if (seen.has(id)) continue;
    scene.remove(cg.mesh, cg.ring);
    thrown.delete(id);
  }
  for (const b of blasts ?? []) blastAt(b.x, b.z);
}

const blastLight = new THREE.PointLight(EMIT_SPARK, 0, GRENADE_RADIUS * 4, 2);
scene.add(blastLight);
const blastFlashes: { ring: THREE.Mesh; born: number }[] = [];
let blastUntil = 0;

function blastAt(x: number, z: number): void {
  blastLight.position.set(x, 1.2, z);
  blastUntil = performance.now() + 140;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    impacts.hit("wall", x, z, Math.sin(a), Math.cos(a));
  }
  const ring = new THREE.Mesh(blastRingGeometry, new THREE.MeshBasicMaterial({ color: EMIT_SPARK, transparent: true, depthWrite: false }));
  ring.position.set(x, 0.05, z);
  scene.add(ring);
  blastFlashes.push({ ring, born: performance.now() });
}

function stepGrenadeVisuals(time: number): void {
  const now = serverClock.now();
  for (const cg of thrown.values()) {
    const g = cg.state;
    const k = Math.min(1, Math.max(0, (now - g.thrownAt) / GRENADE_FLIGHT_MS));
    cg.mesh.position.set(g.x + (g.tx - g.x) * k, Math.sin(k * Math.PI) * 1.6, g.z + (g.tz - g.z) * k);
    cg.mesh.rotation.x = k < 1 ? time * 14 : 0;
    // on the floor: the reach shows, pulsing quicker as the fuse runs down
    const left = Math.max(0, (g.blowsAt - now) / (g.blowsAt - g.thrownAt - GRENADE_FLIGHT_MS));
    const rate = 6 + 24 * (1 - left);
    (cg.ring.material as THREE.MeshBasicMaterial).opacity = k < 1 ? 0 : 0.35 + 0.35 * Math.max(0, Math.sin(time * rate));
  }
  blastLight.intensity = performance.now() < blastUntil ? 40 : 0;
  for (let i = blastFlashes.length - 1; i >= 0; i--) {
    const f = blastFlashes[i];
    const k = (performance.now() - f.born) / 350;
    if (k >= 1) {
      scene.remove(f.ring);
      blastFlashes.splice(i, 1);
      continue;
    }
    f.ring.scale.setScalar(0.3 + 0.8 * k);
    (f.ring.material as THREE.MeshBasicMaterial).opacity = 1 - k;
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
    ce.eyes.step(Math.hypot(ce.drawn.x - viewPoint.x, ce.drawn.z - viewPoint.z), time);
    ce.bar.visible = ce.health < 1;
    ce.bar.scale.x = Math.max(0.02, ce.health);
    // flash on a hit: brief scale pop
    const s = now < ce.hitUntil ? 1.15 : 1;
    ce.mesh.scale.setScalar(s * ce.size);
    if (ce.spine) ce.spine.visible = Math.sin(time * 18 + ce.drawn.z * 2) > -0.4;
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

      // aboard a helicopter that's taken off: sit tight till it lands
      if (myFlyingUntil) dx = dz = 0;
      if (dx !== 0 || dz !== 0) {
        const len = Math.hypot(dx, dz);
        dx /= len;
        dz /= len;
        const next = clampToPlayBounds(
          localMesh.position.x + dx * woundedSpeed(myWounds) * dt,
          localMesh.position.z + dz * woundedSpeed(myWounds) * dt,
        );
        const p = localMesh.position;
        // (as the server's attemptLocked(): a live attempt, won ones too, leaves by the freight lift)
        const lockedOut = objective.active && levelOf(p.z) === "bottom" && !inCar("bottom", p.x, p.z);
        const solid = obstaclesFor(lift, lockedOut, obstacles, blastDoorOpen(defenceState.evac, serverClock.now()) > 0.6);
        const resolved = resolveObstacles(next.x, next.z, inTutorial(p.x, p.z) ? [...solid, ...shutTutDoors(myTut ?? LESSONS.length)] : solid);
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
    const crew = [...remotes.values()].filter((r) => r.alive && levelOf(r.drawn.z) === viewLevel).map((r) => ({ x: r.drawn.x, z: r.drawn.z, color: r.color }));
    const me = dead ? undefined : { x: localMesh.position.x, z: localMesh.position.z, rotation: localMesh.rotation.y, color: myColor };
    if (viewLevel === "tutorial") minimap.hide();
    else minimap.render({ level: viewLevel, self: me, crew, reactorActive: objective.active, time: clock.elapsedTime });
  }
  renderSpectating(dt);

  const time = clock.elapsedTime;
  const view = viewPoint;
  const power = powerNow(time);
  halos.visible = power !== "out";
  const shutCar = carShutAround(view.x, view.z);
  lighting.update(view.x, view.z, time, { reactorActive: objective.active, power, since: powerSince }, (lamp) => {
    const at = lampSource(lamp);
    // a shut car is sealed both ways: inside it only its own bulbs, outside none of them
    if (!carLightPasses(shutCar, at.x, at.z)) return false;
    if (power === "full") return true;
    // a lamp lights the scene only if its light could reach what we see: in sight, or close
    return Math.hypot(at.x - view.x, at.z - view.z) < LAMP_SPECS[lamp.kind].range * 0.5 || canSee(view.x, view.z, at.x, at.z, visibility.segs);
  });
  const coreColour = objective.active ? REACTOR_LIVE : REACTOR_STANDBY;
  coreMaterial.color.setHex(power === "out" ? 0x080808 : coreColour);
  coreHalo.visible = power !== "out";
  coreHalo.material.color.setHex(coreColour);
  coreHalo.material.opacity = power === "full" ? 0.95 : objective.active ? 0.7 + 0.2 * Math.sin(time * 2) : 0.3 + 0.15 * Math.sin(time * 1.3);
  stepWipe(dt);
  liftDoors.update(lift, serverClock.now());
  stepEvac(time);
  updateSightDoors();
  stepRide();
  stepHeliRide();

  stepRemotes();
  stepEnemies(time);
  stepSpits(time);
  stepGrenadeVisuals(time);
  renderDefenceHud();
  stepTrigger();
  stepWounds(dt);
  stepDust();
  stepTracers();
  impacts.step(dt);
  stepMuzzleFlash();
  stepItemVisuals(time);
  renderPointerFeedback();
  markers.render(currentMarkers(), camera, hudEl.style.display === "block" ? hudEl.getBoundingClientRect().bottom + 40 : undefined);
  renderCountdown();
  stepBeacon(time);
  renderControls();
  renderDebug(dt);

  post.render(scene, camera);
  requestAnimationFrame(animate);
}

// --- Levels and the ride --------------------------------------------------------
// Which level the viewer is on decides the light (the sun up top, the
// facility's lamps and torch below), the line-of-sight mask, and the grade
// (paint up top). The swap happens at the end of the ride, doors still
// shut, inside the identical car, so stepping out at the bottom is the
// first you see of the dark.

/**
 * The point lights have no shadows, so a shut car's walls and door don't
 * stop them: left alone, the corridor's tubes light the car through its
 * door and the car's bulbs spill out over the floor outside. Which lamps
 * count is decided here instead, per car whose door is shut: the viewer
 * inside gets only that car's lamps, outside none of them. Open (or
 * opening), the light runs through the doorway as before.
 */
type ShutCar = { level: LiftLevel; inside: boolean };
function carShutAround(x: number, z: number): ShutCar[] {
  const now = serverClock.now();
  return (["top", "bottom"] as const)
    .filter((level) => liftDoorOpen(lift, level, now) < 0.05)
    .map((level) => ({ level, inside: inCar(level, x, z) }));
}
function carLightPasses(shut: ShutCar[], x: number, z: number): boolean {
  return shut.every((c) => inCar(c.level, x, z) === c.inside);
}

let paintLevel = 1;
function stepLevel(x: number, z: number, dt: number): void {
  const level = inTutorial(x, z) ? "tutorial" : levelOf(z);
  if (level !== viewLevel) {
    viewLevel = level;
    activeVisibility = level === "top" ? surfaceVisibility : level === "tutorial" ? tutorialVisibility : visibility;
    activeVisibility.invalidate();
    // underground (and in the shed) the wall tops are out of sight; outdoors there's nothing overhead to hide (tree crowns stand above the walls)
    post.setMask(activeVisibility.postMask(level === "top" ? 50 : FACILITY_WALL_HALF_HEIGHT * 2 - 0.05));
    // the tutorial's built only while someone's looking at it
    if (level === "tutorial" && !tutorialView) {
      tutorialView = buildTutorial();
      scene.add(tutorialView.group);
    } else if (level !== "tutorial" && tutorialView) {
      scene.remove(tutorialView.group);
      tutorialView.dispose();
      tutorialView = undefined;
    }
  }
  if (tutorialView) {
    tutorialView.update(myTut ?? LESSONS.length, myTutHits, myTutBlasted, clock.elapsedTime);
    updateTutorialSight();
  }
  gardenRotor.rotation.y = clock.elapsedTime * 0.6 + rotorSpin;
  // the camera's overhead: in a cabin, its roof and rotor are lifted off so you can see yourself
  const aboard = padAt(x, z);
  gardenRoof.visible = gardenRotor.visible = aboard !== "garden";
  if (tutorialView) {
    const heli = tutorialView.group;
    heli.getObjectByName("roof")!.visible = heli.getObjectByName("rotor")!.visible = aboard !== "tutorial";
  }
  const up = level === "top";
  surface.visible = up;
  // in the car the light is the car's own bulbs whichever end it's at; the
  // sun and the paint only once you step out (or, riding, as you arrive)
  const inside = inAnyCar(x, z);
  sunlight.setOn(up || level === "tutorial");
  sunlight.setOverhead(level === "tutorial");
  sunlight.follow(x, z);
  // in the top car the sky only gets in through the doorway, as far as the door's open
  sunlight.setLevel(inCar("top", x, z) ? liftDoorOpen(lift, "top", serverClock.now()) : 1);
  // in the shed it's daylight but the facility's plain look, not the garden's paint
  const want = up && !inside ? 1 : up && lift.phase === "open" && lift.at === "top" ? 0.6 : 0;
  paintLevel += (want - paintLevel) * Math.min(1, dt * 2.5);
  post.effects.paint = paintLevel < 0.01 ? 0 : paintLevel;
  // powered up after a win the place is bright and white; blacked out there's barely a shape
  const fill = powerLevel === "full" ? 1 + 4 * Math.min(1, (clock.elapsedTime - powerSince) / 2.5) : powerLevel === "out" ? 0.04 : 1;
  lighting.ambient.intensity = FACILITY_AMBIENT * fill * (1 - paintLevel);
  lighting.ambient.color.setHex(powerLevel === "full" ? 0xdfe8f0 : AMBIENT_SKY);
  // no headlamp in the sun
  torch.light.intensity = level === "tutorial" ? 0 : 18 * (1 - paintLevel);
  if (level === "tutorial") lighting.ambient.intensity = FACILITY_AMBIENT * 2;
}

/** the tutorial doors still shut to us block sight, like a wall */
function updateTutorialSight(): void {
  const key = `${myTut ?? -1}`;
  if (key === lastTutDoorKey) return;
  lastTutDoorKey = key;
  tutorialVisibility.setExtra(shutTutDoors(myTut ?? LESSONS.length));
}

// --- The helicopter ride ------------------------------------------------------
// E in a cabin (either one): the rotor winds up, the cabin shakes, the screen
// fades to black, and you come up in the other one. Each rider flies alone
// (unlike the lift, there's nothing to wait for), so it's per player.

let rotorSpin = 0;
const heliFadeEl = document.createElement("div");
heliFadeEl.className = "ui-wipe";
document.body.appendChild(heliFadeEl);
// The way out after a win (client/world/evac.ts draws it; ADR-060): the
// door and the shaft move on the server's clock, the camera rumbles with
// them, and the settlement plays over the climb, then black and the thanks
// card until the server brings everyone up.
const settlement = new Settlement();
const evacFadeEl = document.createElement("div");
evacFadeEl.className = "ui-wipe";
document.body.appendChild(evacFadeEl);
/** the last won attempt's report, for the settlement's pages */
let wonReport: Extract<Report, { type: "attempt" }> | undefined;
let lastBoard: BoardMessage | undefined;
function stepEvac(time: number): void {
  const now = serverClock.now();
  const e = objective.active && defenceState.phase === "won" ? defenceState.evac : undefined;
  const fx = evacView.update(e, now, time);
  const st = e ? evacStage(e, now) : undefined;
  settlement.set(wonReport, lastBoard, myHandle ?? (myId ? codename({ id: myId, color: myColor, handle: myHandle }) : ""));
  const black = settlement.update(st);
  evacFadeEl.style.opacity = `${black}`;
  // the rumble: only felt down there (and by whoever's watching from down there)
  if (fx.shake > 0 && levelOf(viewPoint.z) === "bottom") {
    const t = performance.now() / 1000;
    camera.position.x += Math.sin(t * 29) * 0.03 * fx.shake;
    camera.position.z += Math.sin(t * 23 + 2) * 0.025 * fx.shake;
    camera.position.y += Math.sin(t * 11) * 0.1 * fx.shake;
  }
}

function stepHeliRide(): void {
  const left = myFlyingUntil ? Math.max(0, myFlyingUntil - serverClock.now()) : 0;
  const k = myFlyingUntil ? 1 - left / HELI_RIDE_MS : 0;
  rotorSpin += myFlyingUntil ? 0.6 + k * 1.5 : 0;
  if (tutorialView) tutorialView.group.getObjectByName("rotor")!.rotation.y += myFlyingUntil ? 0.6 + k * 1.5 : 0;
  // black over the last 40% of the ride, back in over the first moments after landing
  const fade = myFlyingUntil ? Math.max(0, (k - 0.6) / 0.4) : 0;
  heliFadeEl.style.opacity = `${Math.min(1, fade)}`;
  if (myFlyingUntil && k > 0.1) {
    const t = performance.now() / 1000;
    camera.position.x += Math.sin(t * 31) * 0.03 * k;
    camera.position.z += Math.cos(t * 27) * 0.03 * k;
  }
}

/**
 * While the car's moving with us in it: a gentle sway, so the ride is felt.
 * Timed off the ride itself, swelling in as it starts and dying away before
 * it ends, so it's over by the time the level switches (both ways).
 */
function stepRide(): void {
  const p = localMesh?.position;
  const riding = !!p && lift.phase === "moving" && inCar(lift.at, p.x, p.z);
  const msLeft = Math.max(0, (lift.until ?? 0) - serverClock.now());
  const rideShake = riding ? Math.min(1, (LIFT_RIDE_MS - msLeft) / 300, msLeft / 400) : 0;
  if (rideShake > 0.01) {
    const t = performance.now() / 1000;
    camera.position.x += Math.sin(t * 23) * 0.025 * rideShake;
    camera.position.z += Math.sin(t * 17 + 1) * 0.02 * rideShake;
    camera.position.y += Math.sin(t * 9) * 0.08 * rideShake;
  }
  rideEl.style.opacity = riding ? "1" : "0";
  if (riding) {
    const left = msLeft / LIFT_RIDE_MS;
    const down = lift.going === "bottom";
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
  const who = myLate ? "an attempt's on below · you're in for the next one" : "you're down";
  spectateEl.textContent =
    ids.length === 0
      ? `${who} · nobody left standing`
      : `${who} · watching ${ids.indexOf(watchingId ?? "") + 1}/${ids.length}${ids.length > 1 ? " · click: next" : ""}`;
}

// The defence HUD: while the reactor is live, one slim strip across the
// top --- the wave, the reactor's health as a thin bar, what's left to
// fight --- and nothing that needs reading twice (ADR-060: it was too big).
// Between waves, the ready vote gets a card of its own at the bottom.
const hudEl = document.createElement("div");
hudEl.className = "ui-hud";
hudEl.innerHTML =
  '<div class="line"><span id="hud-wave"></span><span class="bar hp"><span id="hud-hp" style="width:100%"></span></span><span id="hud-next" class="next"></span></div>';
document.body.appendChild(hudEl);
const hudHp = hudEl.querySelector<HTMLSpanElement>("#hud-hp")!;
const hudWave = hudEl.querySelector<HTMLSpanElement>("#hud-wave")!;
const hudNext = hudEl.querySelector<HTMLSpanElement>("#hud-next")!;
function renderDefenceHud(): void {
  hudEl.style.display = objective.active ? "block" : "none";
  renderReadyCard();
  if (!objective.active) return;
  if (defenceState.phase === "won") {
    hudWave.textContent = `${WAVES_TO_WIN}/${WAVES_TO_WIN} · stable`;
    hudHp.style.width = "100%";
    hudHp.classList.remove("low");
    const e = defenceState.evac;
    const st = e ? evacStage(e, serverClock.now()) : undefined;
    hudNext.textContent =
      st?.stage === "boarding" ? `freight lift leaves in ${Math.ceil(st.left / 1000)}s` : st?.stage === "open" ? "evacuate · freight lift, north" : st?.stage === "rising" ? "ascending" : "evacuate";
    return;
  }
  if (defenceState.phase === "blackout") {
    const held = Math.max(0, Math.floor((serverClock.now() - (defenceState.blackoutAt ?? serverClock.now())) / 1000));
    hudWave.textContent = "blackout";
    hudHp.style.width = "0";
    hudNext.textContent = `${held}s · ${enemies.size} hostile`;
    return;
  }
  const onBreak = defenceState.phase === "break";
  const hp = defenceState.reactorHealth;
  hudHp.style.width = `${Math.round(hp * 100)}%`;
  // white until it's in danger, then alarm red
  hudHp.classList.toggle("low", hp <= 0.3);
  const next = defenceState.nextWaveAt;
  const nextIn = next ? Math.max(0, Math.ceil((next - serverClock.now()) / 1000)) : 0;
  if (onBreak) {
    hudWave.textContent = `wave ${defenceState.wave}/${WAVES_TO_WIN} clear`;
    hudNext.textContent = next ? `next in ${nextIn}s` : "";
  } else {
    hudWave.textContent = defenceState.wave > 0 ? `wave ${defenceState.wave}/${WAVES_TO_WIN}` : "reactor live";
    hudNext.textContent = enemies.size ? `${enemies.size} hostile` : "";
  }
  hudNext.textContent += funds ? `${hudNext.textContent ? " · " : ""}quota ${funds}` : "";
}

// The ready vote's own card, bottom centre, in a break once the wave's
// report has had its moment: a key cap to press, who's in, and how long
// until it comes anyway. One of two players never found X when it was a
// line in the HUD and the controls (ADR-060).
const readyEl = document.createElement("div");
readyEl.className = "ui-ready";
readyEl.innerHTML = '<span class="key">X</span><span class="what"></span><span class="who"></span>';
document.body.appendChild(readyEl);
const readyWhat = readyEl.querySelector<HTMLSpanElement>(".what")!;
const readyWho = readyEl.querySelector<HTMLSpanElement>(".who")!;
let lastReady = "";
function renderReadyCard(): void {
  const on = canVote() && breakPrompts();
  readyEl.classList.toggle("open", on);
  if (!on) return;
  const mine = amReady();
  readyEl.classList.toggle("done", mine);
  const nextWave = defenceState.wave + 1;
  const what = mine ? "you're ready · X: take it back" : `ready for wave ${nextWave} · ${waveSize(nextWave)} hostiles`;
  const who = `${readyCount()} · ${readyNames()}`;
  const key = `${what}|${who}`;
  if (key === lastReady) return;
  lastReady = key;
  readyWhat.textContent = what;
  readyWho.textContent = who;
}

/** who's ready, by codename, the ones still to vote dimmed out of the list */
function readyNames(): string {
  const ready = new Set(defenceState.ready ?? []);
  const names: string[] = [];
  if (myId && ready.has(myId)) names.push("you");
  for (const [id, r] of remotes) if (ready.has(id)) names.push(r.name);
  const waiting = (defenceState.voters ?? 0) - ready.size;
  return [names.length ? names.join(", ") : "", waiting > 0 ? `waiting on ${waiting}` : "all set"].filter(Boolean).join(" · ");
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
  scoreboard.draw(b.top.slice(0, 3).map((p, i) => `${i + 1} ${p.name.slice(0, 12).padEnd(12)} ${p.score}`));
  const runLine = b.run.attempts
    ? `run: attempt ${b.run.attempts}${b.run.best ? ` · best ${b.run.best}/${WAVES_TO_WIN} waves` : ""}`
    : "run: no attempts yet";
  const rows = b.top
    .map(
      (p, i) =>
        `<div class="row${p.name === myHandle ? " me" : ""}"><span class="rank">${i + 1}</span><span>${escapeText(p.name)}${p.won ? " ★" : ""}</span><span class="score">${p.score} · ${p.kills}k · ${p.waves}w</span></div>`,
    )
    .join("");
  const wins = b.wins
    .map((w) => `<div class="row won"><span>#${w.n}</span><span>${w.attempts} attempt(s)</span><span class="score">${escapeText(w.crew.slice(0, 3).join(", "))}${w.crew.length > 3 ? "…" : ""}</span></div>`)
    .join("");
  boardEl.innerHTML =
    '<div class="board-panel">' +
    `<div class="title">high scores</div><div class="run">${runLine}</div>` +
    '<div class="row head dim"><span class="rank">#</span><span>name</span><span class="score">best · kills · waves</span></div>' +
    (rows || '<div class="row dim">nobody yet</div>') +
    (wins ? `<div class="title">reactor stabilised</div>${wins}` : "") +
    '<div class="legend">each name\'s best attempt · ★ the reactor held</div>' +
    '<div class="legend">N: change name · E / Esc to close</div></div>';
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
  // a win's report is the settlement's, played on the way up
  if (r.type === "attempt" && r.outcome === "won") {
    wonReport = r;
    return;
  }
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
  // a wave's report lets the banner have the screen first
  const early = BREAK_REPORT_MS - (performance.now() - breakSince);
  if (reportQueue[0].type === "wave" && early > 0) {
    setTimeout(pumpReports, early + 10);
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
    const crew = [...r.crew].sort((a, b) => b.score - a.score);
    html =
      `<div class="title">${r.outcome === "won" ? "reactor stabilised" : "attempt failed"}</div>` +
      `<div class="run">attempt ${r.attempt} · ${escapeText(r.reason)}</div>` +
      `<div class="row"><span>waves cleared</span><span class="score">${r.waves} / ${WAVES_TO_WIN}</span></div>` +
      (r.blackoutMs ? `<div class="row"><span>held in the dark</span><span class="score">${secs(r.blackoutMs)}</span></div>` : "") +
      `<div class="title sub">crew</div>` +
      (crew.length
        ? crew
            .map(
              (c) =>
                `<div class="row${c.out ? " dim" : ""}"><span>${escapeText(c.name)}${c.out ? " †" : ""}</span><span class="score">${c.kills}k · ${c.score}${c.rank ? ` · #${c.rank}${c.best ? " new best" : ""}` : ""}</span></div>`,
            )
            .join("")
        : '<div class="row dim">nobody</div>') +
      "";
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
  const at = localMesh ? ` · ${localMesh.position.x.toFixed(1)},${localMesh.position.z.toFixed(1)}` : "";
  debugEl.textContent = `${(1000 / ms).toFixed(0)} fps · ${ms.toFixed(1)} ms · ${renderer.info.render.calls} draws · ${(renderer.info.render.triangles / 1000).toFixed(0)}k tris${at}`;
  debugFrames = 0;
  debugTime = 0;
}


requestAnimationFrame(animate);
