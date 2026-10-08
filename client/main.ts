import * as THREE from "three";
import { connect } from "./net.ts";
import {
  BOX_HALF_EXTENT,
  BROADCAST_INTERVAL_MS,
  ITEM_KINDS,
  OBSTACLES,
  PICKUP_RANGE,
  PLACE_RANGE,
  PROJECTILE_SPEED,
  WORLD_BOUNDS,
  canPlaceBox,
  resolveObstacles,
  snapToGrid,
  worldObstacles,
  type ItemState,
  type Obstacle,
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
scene.background = new THREE.Color(0x1a1f2b);

// Perspective camera, but positioned directly overhead and looking straight
// down --- no tilt, no angled follow. Perspective (rather than orthographic)
// means distance still reads normally; it's the angle, not the projection,
// that's fixed at "straight down".
const CAMERA_ALTITUDE = 22;
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.up.set(0, 0, -1);

let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch {
  showFatalError(
    "This browser or device can't create a WebGL context, so the 3D scene can't render here. Try enabling hardware acceleration, or a different browser or device.",
  );
  throw new Error("WebGLRenderer construction failed");
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const ambient = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(10, 16, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -WORLD_BOUNDS - 5;
sun.shadow.camera.right = WORLD_BOUNDS + 5;
sun.shadow.camera.top = WORLD_BOUNDS + 5;
sun.shadow.camera.bottom = -WORLD_BOUNDS - 5;
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(WORLD_BOUNDS * 2 + 4, WORLD_BOUNDS * 2 + 4),
  new THREE.MeshStandardMaterial({ color: 0x2d3446 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const obstacleMaterial = new THREE.MeshStandardMaterial({ color: 0x3f4a63 });
for (const obs of OBSTACLES) {
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(obs.halfExtent * 2, obs.halfHeight * 2, obs.halfExtent * 2),
    obstacleMaterial,
  );
  box.position.set(obs.x, obs.halfHeight, obs.z);
  box.castShadow = true;
  box.receiveShadow = true;
  scene.add(box);
}

function makeCharacter(color: string): THREE.Mesh {
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color().setStyle(color) });
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.8, 4, 8), material);
  mesh.position.y = 0.8;
  mesh.castShadow = true;
  scene.add(mesh);
  return mesh;
}

interface RemotePlayer {
  mesh: THREE.Mesh;
  target: THREE.Vector3;
  targetRotation: number;
}

let myId: string | undefined;
let localMesh: THREE.Mesh | undefined;
let myRespawnAt = 0;
const remotes = new Map<string, RemotePlayer>();
const respawnEl = document.getElementById("respawn")!;
const leaderboardEl = document.getElementById("leaderboard")!;
const connectionLostEl = document.getElementById("connection-lost")!;
const controlsEl = document.getElementById("controls")!;

function isDead(): boolean {
  return Date.now() < myRespawnAt;
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

const pressed = new Set<string>();
window.addEventListener("keydown", (e) => pressed.add(e.key.toLowerCase()));
window.addEventListener("keyup", (e) => pressed.delete(e.key.toLowerCase()));

// Aim is mouse-driven and independent of movement: the character always
// faces the cursor's position on the ground, WASD only translates it.
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const pointerNDC = new THREE.Vector2(0, 0);
let aimRotation = 0;
/** where the cursor currently lands on the ground */
const aimPoint = new THREE.Vector3();

window.addEventListener("pointermove", (e) => {
  pointerNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointerNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
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
// set of rules; only the mesh and what its actions do differ by kind.

interface ClientItem {
  state: ItemState;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
}

const items = new Map<string, ClientItem>();
/** terrain plus boxes on the ground, as of the last state broadcast */
let obstacles: Obstacle[] = OBSTACLES;
/** a box's secondary action toggles this; it stays put between boxes */
let gridSnap = false;

function makeItemMesh(state: ItemState): ClientItem {
  const material = new THREE.MeshStandardMaterial({
    color: state.kind === "gun" ? 0x8a93a6 : 0xb07a45,
  });
  const geometry =
    state.kind === "gun"
      ? new THREE.BoxGeometry(0.18, 0.18, 0.7)
      : new THREE.BoxGeometry(BOX_HALF_EXTENT * 2, BOX_HALF_EXTENT * 2, BOX_HALF_EXTENT * 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return { state, mesh, material };
}

function updateItems(incoming: ItemState[]): void {
  const seen = new Set<string>();
  for (const state of incoming) {
    seen.add(state.id);
    const existing = items.get(state.id);
    if (existing) existing.state = state;
    else items.set(state.id, makeItemMesh(state));
  }
  for (const [id, item] of items) {
    if (!seen.has(id)) {
      scene.remove(item.mesh);
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
 * The ground item the cursor is over, if it's in reach. Matched by
 * distance from the cursor's ground point rather than by ray-hitting the
 * mesh itself, so a small item doesn't need a pixel-precise click ---
 * which matters on a trackpad.
 */
const HOVER_RADIUS = 0.9;
function hoveredItem(): ClientItem | undefined {
  if (!localMesh) return undefined;
  let best: ClientItem | undefined;
  let bestDist = HOVER_RADIUS;
  for (const item of items.values()) {
    const { state } = item;
    if (state.heldBy !== undefined) continue;
    if (Math.hypot(state.x - localMesh.position.x, state.z - localMesh.position.z) > PICKUP_RANGE) continue;
    const d = Math.hypot(state.x - aimPoint.x, state.z - aimPoint.z);
    if (d < bestDist) {
      best = item;
      bestDist = d;
    }
  }
  return best;
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

function boxTargetValid(target: { x: number; z: number }): boolean {
  const bodies: { x: number; z: number }[] = [];
  if (localMesh) bodies.push({ x: localMesh.position.x, z: localMesh.position.z });
  for (const remote of remotes.values()) {
    if (remote.mesh.visible) bodies.push({ x: remote.target.x, z: remote.target.z });
  }
  return canPlaceBox(target.x, target.z, localMesh!.position, obstacles, bodies);
}

const previewMaterial = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.4 });
const placementPreview = new THREE.Mesh(
  new THREE.BoxGeometry(BOX_HALF_EXTENT * 2, BOX_HALF_EXTENT * 2, BOX_HALF_EXTENT * 2),
  previewMaterial,
);
placementPreview.visible = false;
scene.add(placementPreview);

function holderMesh(playerId: string): THREE.Mesh | undefined {
  if (playerId === myId) return localMesh;
  return remotes.get(playerId)?.mesh;
}

function stepItemVisuals(time: number): void {
  const hovered = isDead() || myHeldItem() ? undefined : hoveredItem();
  for (const item of items.values()) {
    const { state, mesh } = item;
    item.material.emissive.setHex(item === hovered ? 0x444444 : 0x000000);
    if (state.heldBy === undefined) {
      mesh.visible = true;
      mesh.scale.setScalar(1);
      if (state.kind === "gun") {
        // a slow spin and bob, so loose guns read as "pick me up"
        mesh.position.set(state.x, 0.35 + Math.sin(time * 2) * 0.08, state.z);
        mesh.rotation.y = time;
      } else {
        mesh.position.set(state.x, BOX_HALF_EXTENT, state.z);
        mesh.rotation.y = 0;
      }
      continue;
    }
    const holder = holderMesh(state.heldBy);
    mesh.visible = !!holder?.visible;
    if (!holder) continue;
    const rot = holder.rotation.y;
    if (state.kind === "gun") {
      // held out in front, along the aim
      mesh.position.set(
        holder.position.x + Math.sin(rot) * 0.55,
        0.9,
        holder.position.z + Math.cos(rot) * 0.55,
      );
      mesh.rotation.y = rot;
      mesh.scale.setScalar(1);
    } else {
      // carried overhead, shrunk a little so it doesn't hide the carrier
      mesh.position.set(holder.position.x, 2.0, holder.position.z);
      mesh.rotation.y = 0;
      mesh.scale.setScalar(0.7);
    }
  }

  const held = myHeldItem();
  const showPreview = !isDead() && !!localMesh && held?.state.kind === "box";
  placementPreview.visible = showPreview;
  if (showPreview) {
    const target = boxTarget();
    placementPreview.position.set(target.x, BOX_HALF_EXTENT, target.z);
    previewMaterial.color.setHex(boxTargetValid(target) ? 0x4ade80 : 0xef4444);
  }
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
      parts.push(`right-click / E: ${info.secondaryLabel}${state}`);
    }
    parts.push(held.state.kind === "box" ? "Q: place" : "Q: drop");
    text = `WASD to move · ${parts.join(" · ")}`;
  }
  if (text !== lastControlsText) {
    controlsEl.textContent = text;
    lastControlsText = text;
  }
}

const projectileMaterial = new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0x332200 });

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

function clearSceneState(): void {
  if (localMesh) scene.remove(localMesh);
  for (const remote of remotes.values()) scene.remove(remote.mesh);
  remotes.clear();
  for (const proj of projectiles.values()) scene.remove(proj.mesh);
  projectiles.clear();
  for (const shot of pendingShots) scene.remove(shot.mesh);
  pendingShots.length = 0;
  for (const item of items.values()) scene.remove(item.mesh);
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
    localMesh = makeCharacter(you.color);
    localMesh.position.set(you.x, 0.8, you.z);
    for (const p of players) {
      if (p.id !== myId) addOrUpdateRemote(p);
    }
    renderLeaderboard(players);
  },
  onState(players, incomingProjectiles, incomingItems) {
    const seenPlayers = new Set<string>();
    const myPrevPos = localMesh ? { x: localMesh.position.x, z: localMesh.position.z } : undefined;
    for (const p of players) {
      if (p.id === myId) {
        myRespawnAt = p.respawnAt ?? 0;
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
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), projectileMaterial);
      mesh.position.set(p.x, 0.5, p.z);
      mesh.castShadow = true;
      scene.add(mesh);
      proj = { mesh, target: new THREE.Vector3(p.x, 0.5, p.z) };
      projectiles.set(p.id, proj);
      // the server's real version of a shot we predicted locally has now
      // shown up: drop the oldest placeholder rather than show both
      if (p.ownerId === myId && pendingShots.length > 0) {
        const oldest = pendingShots.shift()!;
        scene.remove(oldest.mesh);
      }
      continue;
    }
    proj.target.set(p.x, 0.5, p.z);
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
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), projectileMaterial);
  mesh.position.set(localMesh.position.x + dirX * 0.8, 0.5, localMesh.position.z + dirZ * 0.8);
  mesh.castShadow = true;
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
// holding anything down, since a lot of players are on a laptop trackpad:
//   primary   --- click (or tap-to-click)
//   secondary --- right-click / two-finger click / ctrl+click, or E
//   drop      --- Q

function primary(): void {
  if (isDead() || !localMesh) return;
  const held = myHeldItem();
  if (!held) {
    const target = hoveredItem();
    if (target) net.pickup(target.state.id);
    return;
  }
  if (held.state.kind === "gun") {
    net.primary(aimPoint.x, aimPoint.z);
    firePredictedShot();
  } else if (held.state.kind === "box") {
    const target = boxTarget();
    if (boxTargetValid(target)) net.primary(target.x, target.z);
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
  // On a Mac, ctrl+click is the trackpad's right-click: it arrives as a
  // *left* button press with ctrlKey set (plus a contextmenu event), so it
  // has to be caught here or it would fire the primary action as well.
  if (e.button === 2 || (e.button === 0 && e.ctrlKey)) secondary();
  else if (e.button === 0) primary();
});
// the browser's own right-click menu would steal the secondary action
window.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const key = e.key.toLowerCase();
  if (key === "e") secondary();
  else if (key === "q") drop();
});

function addOrUpdateRemote(p: PlayerState): void {
  let remote = remotes.get(p.id);
  if (!remote) {
    remote = { mesh: makeCharacter(p.color), target: new THREE.Vector3(), targetRotation: 0 };
    remote.mesh.position.set(p.x, 0.8, p.z);
    remotes.set(p.id, remote);
  }
  remote.target.set(p.x, 0.8, p.z);
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
        const nextX = clamp(localMesh.position.x + dx * SPEED * dt, -WORLD_BOUNDS, WORLD_BOUNDS);
        const nextZ = clamp(localMesh.position.z + dz * SPEED * dt, -WORLD_BOUNDS, WORLD_BOUNDS);
        const resolved = resolveObstacles(nextX, nextZ, obstacles);
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
  }

  for (const remote of remotes.values()) {
    remote.mesh.position.lerp(remote.target, Math.min(1, dt * 8));
    remote.mesh.rotation.y += angleDiff(remote.mesh.rotation.y, remote.targetRotation) * Math.min(1, dt * 8);
  }

  stepProjectileInterpolation(dt);
  stepPendingShots(dt);
  stepItemVisuals(clock.elapsedTime);
  renderControls();

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

requestAnimationFrame(animate);
