import {
  LIFT_DOOR_MS,
  LIFT_RETURN_MS,
  LIFT_RIDE_MS,
  LIFT_SHORT_WAIT_MS,
  LIFT_WAIT_MS,
  type LiftLevel,
  type LiftState,
} from "../shared/protocol.ts";

// The one lift between the garden and the facility, run here and broadcast
// with every tick. It sits open at one end until someone presses its
// button; then it waits for the others (a short wait if everyone on that
// level is already aboard), shuts, rides, and opens at the other end.
// Whoever is inside when it starts moving goes with it: the server moves
// them (and anything lying in the car) by LIFT_DZ in one step, and since
// both cars are built identically nobody sees the jump.

export interface LiftWorld {
  /** ids of the players standing in the car at this level */
  aboard(level: LiftLevel): string[];
  /** how many players are on this level at all (aboard or not) */
  onLevel(level: LiftLevel): number;
  /** an attempt is on: nobody rides up, so the car goes back to the top whoever's standing in it */
  attemptOn(): boolean;
  /** move everyone and everything in the car from one level to the other */
  ride(from: LiftLevel, to: LiftLevel): void;
}

const other = (level: LiftLevel): LiftLevel => (level === "top" ? "bottom" : "top");

export class Lift {
  state: LiftState = { at: "top", phase: "open" };
  /** while it sits open and empty at the bottom: since when */
  private emptySince = 0;

  private readonly world: LiftWorld;

  constructor(world: LiftWorld) {
    this.world = world;
  }

  /**
   * The button inside the car: set it leaving. A full wait if anyone on
   * this level isn't aboard yet (they might be on their way), a short one
   * if everyone is. Pressing again doesn't hurry it.
   */
  send(now: number): void {
    if (this.state.phase !== "open" || this.state.departAt !== undefined) return;
    const level = this.state.at;
    const everyoneAboard = this.world.aboard(level).length >= this.world.onLevel(level);
    this.state.departAt = now + (everyoneAboard ? LIFT_SHORT_WAIT_MS : LIFT_WAIT_MS);
  }

  /** the call button outside a door: an empty car comes straight away; one with people in it comes after their ride */
  call(level: LiftLevel, now: number): void {
    if (this.state.at === level || this.state.phase !== "open") return;
    if (this.world.aboard(this.state.at).length === 0) this.state.departAt = now;
  }

  /** back to the top and open, with nobody moved: a fresh start after a run's won or lost */
  reset(): void {
    this.state = { at: "top", phase: "open" };
    this.emptySince = 0;
  }

  step(now: number): void {
    const s = this.state;
    if (s.phase === "open") {
      // an empty car left at the bottom goes back up on its own, so whoever
      // arrives next on the surface finds it waiting
      if (s.at === "bottom" && s.departAt === undefined && (this.world.attemptOn() || this.world.aboard("bottom").length === 0)) {
        if (this.emptySince === 0) this.emptySince = now;
        if (now - this.emptySince >= LIFT_RETURN_MS) s.departAt = now;
      } else {
        this.emptySince = 0;
      }
      // once everyone on this level is aboard there's nobody left to wait for
      if (s.departAt !== undefined && s.departAt - now > LIFT_SHORT_WAIT_MS && this.world.aboard(s.at).length >= this.world.onLevel(s.at)) {
        s.departAt = now + LIFT_SHORT_WAIT_MS;
      }
      if (s.departAt !== undefined && now >= s.departAt) {
        this.state = { at: s.at, phase: "closing", until: now + LIFT_DOOR_MS };
        this.emptySince = 0;
      }
      return;
    }
    if (s.until === undefined || now < s.until) return;
    if (s.phase === "closing") {
      // the doors are shut: whoever's inside now is going
      const to = other(s.at);
      this.world.ride(s.at, to);
      this.state = { at: to, phase: "moving", until: now + LIFT_RIDE_MS };
    } else if (s.phase === "moving") {
      this.state = { at: s.at, phase: "opening", until: now + LIFT_DOOR_MS };
    } else {
      this.state = { at: s.at, phase: "open" };
    }
  }
}
