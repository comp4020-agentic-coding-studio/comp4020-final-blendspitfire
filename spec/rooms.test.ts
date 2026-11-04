import { expect, inject, it } from "vitest";
import WebSocket from "ws";

// Sites (rooms): players make their own from the title screen, each a world
// of its own for up to four, listed for everyone. Checked against the running app.

const baseUrl = inject("baseUrl");
const wsUrl = baseUrl.replace(/^http/, "ws") + "/ws";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Session {
  ws: WebSocket;
  id?: string;
  room?: string;
  name?: string;
  others: string[];
  closedWith?: number;
}

/** join a site (none = quick join) under a name, as a returning player (a fresh cookie lands in the tutorial) */
async function join(room?: string, name?: string): Promise<Session> {
  const q = new URLSearchParams();
  if (room) q.set("room", room);
  if (name) q.set("name", name);
  const s: Session = { ws: new WebSocket(`${wsUrl}?${q}`), others: [] };
  s.ws.on("message", (d) => {
    const m = JSON.parse(String(d));
    if (m.type === "welcome") {
      s.id = m.you.id;
      s.room = m.room;
      s.name = m.you.name;
    } else if (m.type === "state") s.others = m.players.map((p: { id: string }) => p.id).filter((id: string) => id !== s.id);
  });
  s.ws.on("close", (code) => (s.closedWith = code));
  await new Promise<void>((resolve) => {
    s.ws.once("open", () => resolve());
    s.ws.once("error", () => resolve());
  });
  for (let i = 0; i < 40 && !s.room && s.closedWith === undefined; i++) await wait(50);
  return s;
}

const newSite = async (): Promise<string> => ((await (await fetch(`${baseUrl}/api/rooms`, { method: "POST" })).json()) as { id: string }).id;
const list = async () => (await (await fetch(`${baseUrl}/api/rooms`)).json()) as { id: string; players: number; max: number; started: boolean; names: string[] }[];

it("a new site is listed, and players in different sites don't see each other", async () => {
  const one = await newSite();
  const two = await newSite();
  expect(one).toMatch(/^SITE-[0-9A-F]{4}$/);
  const a = await join(one, "ripley");
  const b = await join(two);
  await wait(300);
  expect(a.room).toBe(one);
  expect(b.room).toBe(two);
  expect(a.name).toBe("RIPLEY");
  expect(a.others).not.toContain(b.id);
  expect(b.others).not.toContain(a.id);
  const listed = (await list()).find((r) => r.id === one)!;
  expect(listed.players).toBe(1);
  expect(listed.max).toBe(4);
  expect(listed.names).toContain("RIPLEY");
  a.ws.close();
  b.ws.close();
}, 15000);

it("a site holds four; the fifth is turned away, and a site that's gone says so", async () => {
  const site = await newSite();
  const crew = await Promise.all([1, 2, 3, 4].map(() => join(site)));
  expect(crew.every((s) => s.room === site)).toBe(true);
  const fifth = await join(site);
  for (let i = 0; i < 20 && fifth.closedWith === undefined; i++) await wait(50);
  expect(fifth.closedWith).toBe(4005);
  const lost = await join("SITE-NOPE");
  for (let i = 0; i < 20 && lost.closedWith === undefined; i++) await wait(50);
  expect(lost.closedWith).toBe(4004);
  for (const s of crew) s.ws.close();
}, 15000);
