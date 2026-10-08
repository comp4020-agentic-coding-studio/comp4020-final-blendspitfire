import * as THREE from "three";
import { connect } from "./net.ts";
import {
  BROADCAST_INTERVAL_MS,
  OBSTACLES,
  PROJECTILE_SPEED,
  WORLD_BOUNDS,
  resolveObstacles,
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

window.addEventListener("pointermove", (e) => {
  pointerNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointerNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
});

function updateAim(): void {
  if (!localMesh) return;
  raycaster.setFromCamera(pointerNDC, camera);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(groundPlane, hit)) return;
  const dx = hit.x - localMesh.position.x;
  const dz = hit.z - localMesh.position.z;
  if (Math.hypot(dx, dz) < 0.05) return; // cursor right on top of the player: keep the last aim
  aimRotation = Math.atan2(dx, dz);
  localMesh.rotation.y = aimRotation;
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
  onState(players, incomingProjectiles) {
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

window.addEventListener("pointerdown", () => {
  if (isDead() || !localMesh) return;
  net.shoot();
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
        const resolved = resolveObstacles(nextX, nextZ);
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
