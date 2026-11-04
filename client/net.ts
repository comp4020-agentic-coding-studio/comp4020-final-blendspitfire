import type { BoardMessage, MoveMessage, PlayerState, ServerMessage, ShopItem, StateMessage } from "../shared/protocol.ts";

export interface NetHandlers {
  onWelcome: (you: PlayerState, players: PlayerState[], t: number, version: string, room: string) => void;
  onState: (state: StateMessage) => void;
  onBoard: (board: BoardMessage) => void;
  /** the server's answer to a chosen name */
  onNameReply: (ok: boolean, text: string) => void;
  /** the server closed this tab because the same player opened another */
  onReplaced: () => void;
  /** fires on every connect/disconnect transition, including the first connect */
  onConnectionChange: (connected: boolean) => void;
  /** the site wouldn't have us (full, under way, gone: ROOM_CLOSE) or we left it: back to the title */
  onLeft: (code: number) => void;
}

export interface Net {
  sendMove: (m: Omit<MoveMessage, "type">) => void;
  pickup: (itemId: string) => void;
  primary: (x: number, z: number) => void;
  drop: () => void;
  activate: () => void;
  ready: () => void;
  heli: () => void;
  buy: (item: ShopItem) => void;
  buildTurret: (x: number, z: number) => void;
  scrap: (itemId: string) => void;
  lift: () => void;
  name: (name: string) => void;
  freight: () => void;
  /** join a site under a name (the title screen's pick) */
  join: (room: string, name: string) => void;
  /** Esc -> leave site: tell the server, then drop the socket for good */
  leave: () => void;
}

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 5000;

export function connect(handlers: NetHandlers): Net {
  let socket: WebSocket | undefined;
  /** the site (and name) this tab plays in; nothing connects until the title screen picks one */
  let site: { room: string; name: string } | undefined;
  let queuedMove: Omit<MoveMessage, "type"> | undefined;
  let attempt = 0;
  let closedByUs = false;
  /** a newer tab for this player took over: never reconnect, or we'd take it back */
  let replaced = false;

  const send = (payload: unknown): void => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  };

  function open(): void {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    if (!site) return;
    const q = new URLSearchParams({ room: site.room });
    if (site.name) q.set("name", site.name);
    const ws = new WebSocket(`${proto}//${location.host}/ws?${q}`);
    socket = ws;

    ws.addEventListener("open", () => {
      attempt = 0;
      handlers.onConnectionChange(true);
      if (queuedMove) send({ type: "move", ...queuedMove });
    });

    ws.addEventListener("message", (event) => {
      if (ws !== socket) return; // an old site's socket, left behind
      const msg: ServerMessage = JSON.parse(event.data);
      if (msg.type === "welcome") handlers.onWelcome(msg.you, msg.players, msg.t, msg.version, msg.room);
      else if (msg.type === "state") handlers.onState(msg);
      else if (msg.type === "board") handlers.onBoard(msg);
      else if (msg.type === "nameReply") handlers.onNameReply(msg.ok, msg.text);
      else if (msg.type === "replaced") {
        replaced = true;
        handlers.onReplaced();
        ws.close();
      }
    });

    // A Fly machine that scales to zero, a wifi blip, a laptop sleeping ---
    // any of these drop the socket. Without a reconnect loop that's
    // permanent until the tab is reloaded, so always retry unless the page
    // itself is going away.
    ws.addEventListener("close", (event) => {
      if (ws !== socket) return; // an old site's socket, left behind
      // turned away (full, under way, gone), or left on purpose: back to the title, no retry
      if (event.code >= 4004 || event.code === 1000) {
        socket = undefined;
        site = undefined;
        handlers.onLeft(event.code);
        return;
      }
      // reconnecting would just take the session back from the newer tab
      if (event.code === 4000 || replaced) {
        if (!replaced) handlers.onReplaced();
        replaced = true;
        return;
      }
      handlers.onConnectionChange(false);
      if (closedByUs) return;
      const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
      attempt += 1;
      setTimeout(open, delay);
    });
    ws.addEventListener("error", () => ws.close());
  }

  window.addEventListener("beforeunload", () => {
    closedByUs = true;
  });

  return {
    sendMove(m) {
      if (socket?.readyState === WebSocket.OPEN) send({ type: "move", ...m });
      else queuedMove = m;
    },
    pickup(itemId) {
      send({ type: "pickup", itemId });
    },
    primary(x, z) {
      send({ type: "primary", x, z });
    },
    drop() {
      send({ type: "drop" });
    },
    buy(item) {
      send({ type: "buy", item });
    },
    buildTurret(x, z) {
      send({ type: "buildTurret", x, z });
    },
    scrap(itemId) {
      send({ type: "scrap", itemId });
    },
    activate() {
      send({ type: "activate" });
    },
    ready() {
      send({ type: "ready" });
    },
    heli() {
      send({ type: "heli" });
    },
    lift() {
      send({ type: "lift" });
    },
    name(name) {
      send({ type: "name", name });
    },
    freight() {
      send({ type: "freight" });
    },
    join(room, name) {
      site = { room, name };
      replaced = false;
      attempt = 0;
      open();
    },
    leave() {
      send({ type: "leave" });
      const ws = socket;
      socket = undefined;
      site = undefined;
      ws?.close(1000);
      handlers.onLeft(1000);
    },
  };
}
