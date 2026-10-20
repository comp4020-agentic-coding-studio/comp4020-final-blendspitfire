import type { BoardMessage, MoveMessage, PlayerState, ServerMessage, ShopItem, StateMessage } from "../shared/protocol.ts";

export interface NetHandlers {
  onWelcome: (you: PlayerState, players: PlayerState[], t: number) => void;
  onState: (state: StateMessage) => void;
  onBoard: (board: BoardMessage) => void;
  /** the server closed this tab because the same player opened another */
  onReplaced: () => void;
  /** fires on every connect/disconnect transition, including the first connect */
  onConnectionChange: (connected: boolean) => void;
}

export interface Net {
  sendMove: (m: Omit<MoveMessage, "type">) => void;
  pickup: (itemId: string) => void;
  primary: (x: number, z: number) => void;
  drop: () => void;
  activate: () => void;
  buy: (item: ShopItem) => void;
  lift: () => void;
}

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 5000;

export function connect(handlers: NetHandlers): Net {
  let socket: WebSocket | undefined;
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
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    socket = ws;

    ws.addEventListener("open", () => {
      attempt = 0;
      handlers.onConnectionChange(true);
      if (queuedMove) send({ type: "move", ...queuedMove });
    });

    ws.addEventListener("message", (event) => {
      const msg: ServerMessage = JSON.parse(event.data);
      if (msg.type === "welcome") handlers.onWelcome(msg.you, msg.players, msg.t);
      else if (msg.type === "state") handlers.onState(msg);
      else if (msg.type === "board") handlers.onBoard(msg);
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

  open();
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
    activate() {
      send({ type: "activate" });
    },
    lift() {
      send({ type: "lift" });
    },
  };
}
