import { expect, inject, it } from "vitest";
import WebSocket from "ws";

// Who's who is decided on the server: each browser gets its own id from a
// cookie the server sets, everyone sees everyone else under a name, and one
// player can't act on what's another's. Checked against the running app.

const baseUrl = inject("baseUrl");
const wsUrl = baseUrl.replace(/^http/, "ws") + "/ws";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Session {
  ws: WebSocket;
  cookie?: string;
  id?: string;
  name?: string;
  last?: {
    players: { id: string; name?: string; x: number; z: number }[];
    items?: { id: string; kind: string; x: number; z: number; heldBy?: string }[];
  };
  items?: { id: string; kind: string; x: number; z: number; heldBy?: string }[];
  board?: { top: { name: string }[] };
  closedWith?: number;
  /** told by the server that a newer tab took over */
  replaced?: boolean;
}

/** join as a fresh browser, or as the one that holds `cookie` */
async function join(cookie?: string): Promise<Session> {
  const s: Session = { ws: new WebSocket(wsUrl, cookie ? { headers: { cookie } } : {}) };
  s.ws.on("upgrade", (res) => {
    const set = res.headers["set-cookie"]?.[0];
    s.cookie = set ? set.split(";")[0] : cookie;
  });
  s.ws.on("message", (d) => {
    const m = JSON.parse(String(d));
    if (m.type === "welcome") {
      s.id = m.you.id;
      s.name = m.you.name;
    } else if (m.type === "state") {
      s.last = m;
      if (m.items) s.items = m.items;
    } else if (m.type === "board") s.board = m;
    else if (m.type === "replaced") s.replaced = true;
  });
  s.ws.on("close", (code) => (s.closedWith = code));
  await new Promise<void>((resolve, reject) => {
    s.ws.once("open", () => resolve());
    s.ws.once("error", reject);
  });
  for (let i = 0; i < 50 && !(s.last && s.items); i++) await wait(50);
  return s;
}

it("tells two browsers apart, by name, to each other", async () => {
  const a = await join();
  const b = await join();
  await wait(200);
  expect(a.id).toBeTruthy();
  expect(b.id).not.toBe(a.id);
  expect(a.name).toMatch(/^[A-Z][a-z]+-[0-9a-f]{4}$/);
  expect(b.name).not.toBe(a.name);
  // each sees the other under the same name the other was given
  expect(a.last!.players.find((p) => p.id === b.id)?.name).toBe(b.name);
  expect(b.last!.players.find((p) => p.id === a.id)?.name).toBe(a.name);
  // and the arcade board arrives on joining
  expect(a.board).toBeTruthy();
  a.ws.close();
  b.ws.close();
});

it("the same browser coming back is the same person; a second tab replaces the first", async () => {
  const a = await join();
  const again = await join(a.cookie);
  await wait(300);
  expect(again.id).toBe(a.id);
  expect(again.name).toBe(a.name);
  // the old tab is told, whether or not the close itself gets through a proxy
  for (let i = 0; i < 40 && !a.replaced; i++) await wait(50);
  expect(a.replaced).toBe(true);
  // one body, not two
  expect(again.last!.players.filter((p) => p.id === a.id)).toHaveLength(1);
  again.ws.close();
});

it("won't let one player take what another is holding", async () => {
  const a = await join();
  const b = await join();
  await wait(200);
  // both start in the intake, next to the stations
  const me = a.last!.players.find((p) => p.id === a.id)!;
  const near = a.items!.filter((i) => !i.heldBy).sort((i, j) => Math.hypot(i.x - me.x, i.z - me.z) - Math.hypot(j.x - me.x, j.z - me.z))[0];
  // walk a over to it, a step a tick
  for (let i = 0; i < 80; i++) {
    const p = a.last!.players.find((q) => q.id === a.id)!;
    const d = Math.hypot(near.x - p.x, near.z - p.z);
    if (d < 0.6) break;
    const step = Math.min(0.15, d);
    a.ws.send(JSON.stringify({ type: "move", x: p.x + ((near.x - p.x) / d) * step, z: p.z + ((near.z - p.z) / d) * step, rotation: 0 }));
    await wait(55);
  }
  a.ws.send(JSON.stringify({ type: "pickup", itemId: near.id }));
  for (let i = 0; i < 20 && a.items!.find((it) => it.id === near.id)?.heldBy !== a.id; i++) await wait(50);
  expect(a.items!.find((it) => it.id === near.id)?.heldBy).toBe(a.id);

  // b asks for the same item: refused, a keeps it
  b.ws.send(JSON.stringify({ type: "pickup", itemId: near.id }));
  await wait(300);
  expect(b.items!.find((it) => it.id === near.id)?.heldBy).toBe(a.id);
  a.ws.close();
  b.ws.close();
}, 15000);
