import * as THREE from "three";
import { connect } from "./net.ts";
import { WORLD_BOUNDS, type PlayerState } from "../shared/protocol.ts";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1f2b);
scene.fog = new THREE.Fog(0x1a1f2b, 20, 55);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);
const CAMERA_OFFSET = new THREE.Vector3(0, 9, 11);

const renderer = new THREE.WebGLRenderer({ antialias: true });
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
const obstaclePositions: [number, number, number][] = [
  [6, 1, 4],
  [-7, 1.5, -3],
  [3, 0.8, -8],
  [-4, 1, 7],
];
for (const [x, h, z] of obstaclePositions) {
  const box = new THREE.Mesh(new THREE.BoxGeometry(2, h * 2, 2), obstacleMaterial);
  box.position.set(x, h, z);
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
const remotes = new Map<string, RemotePlayer>();

const pressed = new Set<string>();
window.addEventListener("keydown", (e) => pressed.add(e.key.toLowerCase()));
window.addEventListener("keyup", (e) => pressed.delete(e.key.toLowerCase()));

const net = connect({
  onWelcome(you, players) {
    myId = you.id;
    localMesh = makeCharacter(you.color);
    localMesh.position.set(you.x, 0.8, you.z);
    for (const p of players) {
      if (p.id !== myId) addOrUpdateRemote(p);
    }
  },
  onState(players) {
    const seen = new Set<string>();
    for (const p of players) {
      if (p.id === myId) continue;
      seen.add(p.id);
      addOrUpdateRemote(p);
    }
    for (const [id, remote] of remotes) {
      if (!seen.has(id)) {
        scene.remove(remote.mesh);
        remotes.delete(id);
      }
    }
  },
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
}

const SPEED = 6;
const clock = new THREE.Clock();

function animate(): void {
  const dt = Math.min(clock.getDelta(), 0.1);

  if (localMesh) {
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
      localMesh.position.x = clamp(localMesh.position.x + dx * SPEED * dt, -WORLD_BOUNDS, WORLD_BOUNDS);
      localMesh.position.z = clamp(localMesh.position.z + dz * SPEED * dt, -WORLD_BOUNDS, WORLD_BOUNDS);
      localMesh.rotation.y = Math.atan2(dx, dz);
      net.sendMove({ x: localMesh.position.x, z: localMesh.position.z, rotation: localMesh.rotation.y });
    }

    camera.position.set(
      localMesh.position.x + CAMERA_OFFSET.x,
      CAMERA_OFFSET.y,
      localMesh.position.z + CAMERA_OFFSET.z,
    );
    camera.lookAt(localMesh.position.x, 1, localMesh.position.z);
  }

  for (const remote of remotes.values()) {
    remote.mesh.position.lerp(remote.target, Math.min(1, dt * 8));
    remote.mesh.rotation.y += angleDiff(remote.mesh.rotation.y, remote.targetRotation) * Math.min(1, dt * 8);
  }

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
