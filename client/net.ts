import type { MoveMessage, PlayerState, ServerMessage } from "../shared/protocol.ts";

export interface NetHandlers {
  onWelcome: (you: PlayerState, players: PlayerState[]) => void;
  onState: (players: PlayerState[]) => void;
}

export function connect(handlers: NetHandlers): { sendMove: (m: Omit<MoveMessage, "type">) => void } {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${proto}//${location.host}/ws`);

  socket.addEventListener("message", (event) => {
    const msg: ServerMessage = JSON.parse(event.data);
    if (msg.type === "welcome") handlers.onWelcome(msg.you, msg.players);
    else if (msg.type === "state") handlers.onState(msg.players);
  });

  let queued: Omit<MoveMessage, "type"> | undefined;
  socket.addEventListener("open", () => {
    if (queued) socket.send(JSON.stringify({ type: "move", ...queued }));
  });

  return {
    sendMove(m) {
      const payload: MoveMessage = { type: "move", ...m };
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
      else queued = m;
    },
  };
}
