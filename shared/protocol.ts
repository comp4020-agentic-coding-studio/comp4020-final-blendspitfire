export interface PlayerState {
  id: string;
  color: string;
  x: number;
  z: number;
  rotation: number;
}

export interface WelcomeMessage {
  type: "welcome";
  you: PlayerState;
  players: PlayerState[];
}

export interface StateMessage {
  type: "state";
  players: PlayerState[];
}

export interface MoveMessage {
  type: "move";
  x: number;
  z: number;
  rotation: number;
}

export type ServerMessage = WelcomeMessage | StateMessage;
export type ClientMessage = MoveMessage;

export const WORLD_BOUNDS = 18;
export const BROADCAST_INTERVAL_MS = 66;
export const PERSIST_INTERVAL_MS = 1000;
