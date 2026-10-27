import { expect, inject, it } from "vitest";
import WebSocket from "ws";

// The world is shared: one client that sends garbage, floods, or tries to
// cheat must not take it down for everyone, or move itself somewhere it
// couldn't walk. Checked against the running app, like everything in spec/.

const baseUrl = inject("baseUrl");
const wsUrl = baseUrl.replace(/^http/, "ws") + "/ws";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Session {
  ws: WebSocket;
  id?: string;
  last?: { players: { id: string; x: number; z: number }[] };
  closedWith?: number;
}

async function join(): Promise<Session> {
  const s: Session = { ws: new WebSocket(wsUrl) };
  s.ws.on("message", (d) => {
    const m = JSON.parse(String(d));
    if (m.type === "welcome") s.id = m.you.id;
    else if (m.type === "state") s.last = m;
  });
  s.ws.on("close", (code) => (s.closedWith = code));
  await new Promise<void>((resolve, reject) => {
    s.ws.once("open", () => resolve());
    s.ws.once("error", reject);
  });
  for (let i = 0; i < 50 && !s.last; i++) await wait(50);
  return s;
}

const me = (s: Session) => s.last!.players.find((p) => p.id === s.id)!;
const alive = async () => (await fetch(baseUrl)).status === 200;

it("survives malformed messages, floods and oversized frames", async () => {
  const s = await join();
  for (const junk of ["null", "42", '"x"', "[]", "{}", '{"type":5}', '{"type":"pickup","itemId":{}}', "not json"]) {
    s.ws.send(junk);
  }
  for (let i = 0; i < 300; i++) s.ws.send(JSON.stringify({ type: "move", x: 0, z: 0, rotation: 0 }));
  await wait(300);
  expect(await alive()).toBe(true);

  s.ws.send("x".repeat(64 * 1024));
  await wait(300);
  expect(s.closedWith).toBe(1009); // "message too big": that one connection is dropped
  expect(await alive()).toBe(true);
}, 15000);

it("sends the item list to someone joining late, then only when it changes", async () => {
  const first = await join();
  await wait(300);
  const late = new WebSocket(wsUrl);
  const items: (number | null)[] = [];
  late.on("message", (d) => {
    const m = JSON.parse(String(d));
    if (m.type === "state") items.push(Array.isArray(m.items) ? m.items.length : null);
  });
  await new Promise<void>((resolve) => late.once("open", () => resolve()));
  await wait(500);
  expect(items[0]).not.toBeNull();
  expect(items[0]).toBeGreaterThan(0);
  // with nothing moving, later ticks leave the list out
  expect(items.slice(1).filter((n) => n === null).length).toBeGreaterThan(0);
  late.close();
  first.ws.close();
}, 15000);

it("won't let a client teleport, but lets an honest one walk", async () => {
  const s = await join();
  const start = { ...me(s) };
  s.ws.send(JSON.stringify({ type: "move", x: start.x, z: start.z - 15, rotation: 0 }));
  await wait(200);
  expect(Math.hypot(me(s).x - start.x, me(s).z - start.z)).toBeLessThan(1);

  // walking straight ahead at a normal pace, 20 steps in one second (east:
  // open floor whether they joined in the garden or, new, in the tutorial)
  const from = { ...me(s) };
  for (let i = 1; i <= 20; i++) {
    s.ws.send(JSON.stringify({ type: "move", x: from.x + i * 0.15, z: from.z, rotation: 0 }));
    await wait(50);
  }
  await wait(200);
  expect(Math.hypot(me(s).x - from.x, me(s).z - from.z)).toBeGreaterThan(2.5);
  s.ws.close();
}, 15000);
