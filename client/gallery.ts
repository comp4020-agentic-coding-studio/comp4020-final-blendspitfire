import * as THREE from "three";
import { CAMERA_ALTITUDE, CAMERA_FOV, configureRenderer, glow, lampHalos, setupLighting } from "./look.ts";
import { character, crawler, floorSlab } from "./models/index.ts";
import { ASSETS } from "./models/registry.ts";
import { REACTOR_LIVE, REACTOR_STANDBY, buildFacility, reactorCore } from "./models/facility.ts";
import { createPostProcess } from "./postprocess.ts";
import { GRADE } from "./assets/grade.ts";
import { VisibilityMask, sightBlockers } from "./visibility.ts";
import { buildYardGuides } from "./floorGuides.ts";
import { LAMPS } from "./world/dressing.ts";
import { AMBIENT_GROUND, AMBIENT_SKY, EMIT_RED, PLAYER_COLORS } from "../shared/palette.ts";
import {
  BREACHES,
  DOORWAYS,
  FACILITY_WALL_HALF_HEIGHT,
  FIXTURES,
  REACTOR,
  SIGHT_BOUNDS,
  SOLID,
  WALLS,
  ZONE_RECTS,
} from "../shared/protocol.ts";

// Not part of the game: the review views.
//   /gallery.html                 the model sheet --- every asset in
//                                 client/models/registry.ts, under neutral
//                                 studio light, from four angles
//   /gallery.html?facility        the whole facility from high overhead,
//                                 lit as in the game, no line of sight
//   /gallery.html?facility&x=&z=  one spot through the game's own camera,
//                                 with line of sight from that spot
//   add &pixel=0 to either facility view to drop the pixelation
//   add &live to light it as if the reactor were on

/** the game camera's view height in world units */
const GAME_UNITS_TALL = 2 * CAMERA_ALTITUDE * Math.tan(((CAMERA_FOV / 2) * Math.PI) / 180);

function facilityView(): void {
  const params = new URLSearchParams(location.search);
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  configureRenderer(renderer);
  document.body.innerHTML = "";
  document.body.style.margin = "0";
  document.body.style.background = "#000";
  document.body.appendChild(renderer.domElement);
  const post = createPostProcess(renderer, params.get("pixel") === "0" ? 1 : 0.42, GRADE);

  const fx = params.get("x");
  const fz = params.get("z");
  const close = fx !== null && fz !== null;
  const scene = new THREE.Scene();
  // a close view lights like the game (a small pool); the overview lights every lamp at once
  const lighting = setupLighting(scene, REACTOR, close ? undefined : LAMPS.length);
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
  const core = new THREE.Mesh(
    reactorCore(),
    new THREE.MeshBasicMaterial({ color: params.has("live") ? REACTOR_LIVE : REACTOR_STANDBY }),
  );
  core.position.set(REACTOR.x, 0, REACTOR.z);
  scene.add(core);
  const people: [number, number, number][] = [
    [0, 24, 0],
    [-1, 12, 1],
    [-9, 9.5, 2],
    [8, 10, 3],
    [-12, -1, 4],
    [3, -8, 5],
  ];
  for (const [x, z, c] of people) {
    const p = character(PLAYER_COLORS[c]);
    p.position.set(x, 0, z);
    p.rotation.y = c;
    scene.add(p);
  }
  // with &live, a wave closing on the reactor, for judging enemies in the scene
  if (params.has("live")) {
    const crawlers: [number, number][] = [
      [4.5, -9],
      [5.5, -7.5],
      [3.8, -14],
      [-4.6, -13],
      [6.5, -15.5],
      [12, -2],
      [5.5, -16.6],
    ];
    for (const [x, z] of crawlers) {
      const c = crawler();
      const eyes = glow(EMIT_RED, 0.55, 0.55);
      eyes.position.set(0, 0.48, 0.66);
      c.add(eyes);
      c.position.set(x, 0, z);
      c.rotation.y = Math.atan2(REACTOR.x - x, REACTOR.z - z);
      scene.add(c);
    }
  }

  const cx = close ? Number(fx) : 0;
  const cz = close ? Number(fz) : 5;
  const cam = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 200);
  cam.up.set(0, 0, -1);
  cam.position.set(cx, close ? CAMERA_ALTITUDE : 60, cz);
  cam.lookAt(cx, 0, cz);

  const visibility = new VisibilityMask(sightBlockers(WALLS, FIXTURES), SOLID, SIGHT_BOUNDS);
  const masked = close && !params.has("nomask");
  if (masked) post.setMask(visibility.postMask(FACILITY_WALL_HALF_HEIGHT * 2 - 0.05));
  const live = params.has("live");
  const clock = new THREE.Clock();
  const render = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    post.setSize(window.innerWidth, window.innerHeight);
    cam.aspect = window.innerWidth / window.innerHeight;
    cam.updateProjectionMatrix();
    if (masked) visibility.update(renderer, cx, cz);
    // the overview is lit everywhere at once, so every lamp gets a light
    lighting.update(cx, cz, clock.getElapsedTime(), { reactorActive: live });
    post.render(scene, cam);
    requestAnimationFrame(render);
  };
  requestAnimationFrame(render);
}

/**
 * The model sheet. Each row is one asset: overhead at the game's own pixel
 * scale (what a player actually gets), overhead close up, from the side,
 * and a slowly turning three-quarter view. Lit by a plain studio rig
 * rather than the facility's lamps, so what's judged is the model and its
 * colours, not the lighting.
 */
function sheet(): void {
  const ROW_H = 150;
  const COLS = 4;
  const LABEL_W = 190;

  const container = document.getElementById("sheet")!;
  container.style.height = `${ASSETS.length * ROW_H}px`;
  const canvas = document.createElement("canvas");
  container.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  configureRenderer(renderer);
  renderer.toneMapping = THREE.NeutralToneMapping;

  const prepared = ASSETS.map((asset, i) => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101214);
    scene.add(new THREE.HemisphereLight(AMBIENT_SKY, AMBIENT_GROUND, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(6, 12, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    for (const k of ["left", "bottom"] as const) key.shadow.camera[k] = -6;
    for (const k of ["right", "top"] as const) key.shadow.camera[k] = 6;
    scene.add(key);
    scene.add(floorSlab(30, 30));
    const model = asset.build();
    scene.add(model);
    const label = document.createElement("div");
    label.className = "label";
    label.style.top = `${i * ROW_H}px`;
    label.textContent = `${asset.id} · ${asset.category}`;
    container.appendChild(label);
    return { scene, frame: asset.frame };
  });

  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  function frameCamera(visibleUnits: number, aspect: number, view: "top" | "side" | "three-quarter", t: number): void {
    cam.aspect = aspect;
    const dist = 22;
    cam.fov = (2 * Math.atan(visibleUnits / 2 / dist) * 180) / Math.PI;
    cam.updateProjectionMatrix();
    if (view === "top") {
      cam.up.set(0, 0, -1);
      cam.position.set(0, dist, 0);
      cam.lookAt(0, 0, 0);
    } else if (view === "side") {
      cam.up.set(0, 1, 0);
      cam.position.set(dist, 0.6, 0);
      cam.lookAt(0, 0.6, 0);
    } else {
      cam.up.set(0, 1, 0);
      cam.position.set(Math.sin(t) * dist * 0.7, dist * 0.6, Math.cos(t) * dist * 0.7);
      cam.lookAt(0, 0.5, 0);
    }
  }

  function render(time: number): void {
    const width = container.clientWidth;
    renderer.setSize(width, ASSETS.length * ROW_H, false);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${ASSETS.length * ROW_H}px`;
    const cellW = (width - LABEL_W) / COLS;
    const fullH = ASSETS.length * ROW_H;
    renderer.setScissorTest(true);
    const t = time / 2500;
    prepared.forEach((p, i) => {
      const y = fullH - (i + 1) * ROW_H; // GL viewports count from the bottom
      for (let col = 0; col < COLS; col++) {
        const x = LABEL_W + col * cellW;
        renderer.setViewport(x, y, cellW - 4, ROW_H - 4);
        renderer.setScissor(x, y, cellW - 4, ROW_H - 4);
        const aspect = (cellW - 4) / (ROW_H - 4);
        if (col === 0) frameCamera(((ROW_H - 4) / 1080) * GAME_UNITS_TALL, aspect, "top", t);
        else frameCamera(p.frame, aspect, col === 1 ? "top" : col === 2 ? "side" : "three-quarter", t);
        renderer.render(p.scene, cam);
      }
    });
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}

if (new URLSearchParams(location.search).has("facility")) facilityView();
else sheet();
