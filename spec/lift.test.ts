import { describe, expect, it } from "vitest";
import { Lift } from "../server/lift.ts";
import {
  FACILITY_HALF,
  LIFT_CARS,
  LIFT_DOOR_MS,
  LIFT_DZ,
  LIFT_RETURN_MS,
  LIFT_RIDE_MS,
  LIFT_SHORT_WAIT_MS,
  LIFT_WAIT_MS,
  OBSTACLES,
  isSafe,
  isWalkable,
  levelOf,
  liftVerdict,
  obstaclesFor,
  resolveObstacles,
  type LiftLevel,
} from "../shared/protocol.ts";

// The lift between the garden and the facility: a state machine on the
// server (server/lift.ts) and the rules every client shares
// (shared/protocol.ts liftVerdict / obstaclesFor). Run against a fake
// world of players standing at fixed spots.

const carMid = (level: LiftLevel) => ({ x: 0, z: (LIFT_CARS[level].minZ + LIFT_CARS[level].maxZ) / 2 });

function world(players: { x: number; z: number }[], attemptOn = () => false) {
  const rides: string[] = [];
  const inCarAt = (level: LiftLevel, p: { x: number; z: number }) => {
    const r = LIFT_CARS[level];
    return p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ;
  };
  const lift = new Lift({
    aboard: (level) => players.filter((p) => inCarAt(level, p)).map((_, i) => String(i)),
    onLevel: (level) => players.filter((p) => levelOf(p.z) === level).length,
    attemptOn,
    shut() {},
    ride(from, to) {
      rides.push(`${from}->${to}`);
      for (const p of players) if (inCarAt(from, p)) p.z += to === "bottom" ? -LIFT_DZ : LIFT_DZ;
    },
  });
  return { lift, rides, players };
}

function run(lift: Lift, from: number, ms: number): number {
  let now = from;
  for (let t = 0; t < ms; t += 50) lift.step((now += 50));
  return now;
}

describe("the lift", () => {
  it("waits for the others when someone on the level isn't aboard, briefly when everyone is", () => {
    const top = carMid("top");
    const { lift } = world([{ ...top }, { x: 5, z: top.z - 10 }]);
    lift.send(0);
    expect(lift.state.departAt).toBe(LIFT_WAIT_MS);
    const alone = world([{ ...top }]).lift;
    alone.send(0);
    expect(alone.state.departAt).toBe(LIFT_SHORT_WAIT_MS);
  });

  it("cuts the wait short once the last one on the level steps in", () => {
    const top = carMid("top");
    const late = { x: 5, z: top.z - 10 };
    const { lift } = world([{ ...top }, late]);
    lift.send(0);
    late.x = 1;
    late.z = top.z;
    lift.step(100);
    expect(lift.state.departAt).toBe(100 + LIFT_SHORT_WAIT_MS);
  });

  it("takes whoever's inside down, and leaves the rest where they are", () => {
    const top = carMid("top");
    const rider = { ...top };
    const stayer = { x: 6, z: top.z - 8 };
    const { lift, rides } = world([rider, stayer]);
    lift.send(0);
    const now = run(lift, 0, LIFT_WAIT_MS + LIFT_DOOR_MS + LIFT_RIDE_MS + LIFT_DOOR_MS + 100);
    expect(rides).toEqual(["top->bottom"]);
    expect(levelOf(rider.z)).toBe("bottom");
    expect(rider.z).toBeCloseTo(carMid("bottom").z);
    expect(levelOf(stayer.z)).toBe("top");
    expect(lift.state).toMatchObject({ at: "bottom", phase: "open" });
    expect(now).toBeGreaterThan(0);
  });

  it("rides at the level it leaves, and moves its riders only on arrival", () => {
    const rider = { ...carMid("top") };
    const { lift, rides } = world([rider]);
    lift.send(0);
    const midRide = run(lift, 0, LIFT_SHORT_WAIT_MS + LIFT_DOOR_MS + LIFT_RIDE_MS / 2);
    expect(lift.state).toMatchObject({ at: "top", phase: "moving" });
    expect(rides).toEqual([]);
    expect(levelOf(rider.z)).toBe("top");
    run(lift, midRide, LIFT_RIDE_MS / 2 + 100);
    expect(lift.state).toMatchObject({ at: "bottom", phase: "opening" });
    expect(rides).toEqual(["top->bottom"]);
  });

  it("going up, switches as the doors shut and rides up top", () => {
    const rider = { ...carMid("bottom") };
    const { lift, rides } = world([rider]);
    lift.state = { at: "bottom", phase: "open" };
    lift.send(0);
    run(lift, 0, LIFT_SHORT_WAIT_MS + LIFT_DOOR_MS + LIFT_RIDE_MS / 2);
    expect(lift.state).toMatchObject({ at: "top", phase: "moving", going: "top" });
    expect(rides).toEqual(["bottom->top"]);
    expect(levelOf(rider.z)).toBe("top");
  });

  it("goes back up on its own once it's left empty at the bottom", () => {
    const { lift, rides } = world([{ x: 0, z: FACILITY_HALF - 3 }]);
    lift.state = { at: "bottom", phase: "open" };
    run(lift, 0, LIFT_RETURN_MS + LIFT_DOOR_MS + LIFT_RIDE_MS + LIFT_DOOR_MS + 200);
    expect(rides).toEqual(["bottom->top"]);
    expect(lift.state).toMatchObject({ at: "top", phase: "open" });
  });

  it("comes when called to an empty level, but not away from people riding it", () => {
    const empty = world([]).lift;
    empty.call("bottom", 0);
    expect(empty.state.departAt).toBe(0);
    const busy = world([carMid("top")]).lift;
    busy.call("bottom", 0);
    expect(busy.state.departAt).toBeUndefined();
  });
});

describe("the lift's rules", () => {
  const off = { active: false };
  const on = { active: true };

  it("sends from inside the car, calls from outside its door, and does nothing from afar", () => {
    const open = { at: "top" as const, phase: "open" as const };
    expect(liftVerdict(carMid("top"), open, off, "spawning")).toBe("send");
    expect(liftVerdict({ x: 0, z: LIFT_CARS.top.minZ - 1.5 }, { at: "bottom", phase: "open" }, off, "spawning")).toBe("call");
    expect(liftVerdict({ x: 8, z: LIFT_CARS.top.minZ - 8 }, open, off, "spawning")).toBe("too far");
  });

  it("won't take anyone back up once an attempt is on, but anyone can still come down", () => {
    const atBottom = { at: "bottom" as const, phase: "open" as const };
    expect(liftVerdict(carMid("bottom"), atBottom, off, "spawning")).toBe("send");
    expect(liftVerdict(carMid("bottom"), atBottom, on, "spawning")).toBe("attempt on");
    expect(liftVerdict(carMid("top"), { at: "top", phase: "open" }, on, "spawning")).toBe("send");
  });

  it("takes the crew up once the run's won, and not in a blackout", () => {
    const atBottom = { at: "bottom" as const, phase: "open" as const };
    expect(liftVerdict(carMid("bottom"), atBottom, on, "won")).toBe("send");
    expect(liftVerdict(carMid("bottom"), atBottom, on, "blackout")).toBe("attempt on");
  });

  it("shuts the bottom door to someone locked out, and every door the car isn't open at", () => {
    const atBottom = { at: "bottom" as const, phase: "open" as const };
    // walking south from the corridor into the car
    const from = { x: 0, z: FACILITY_HALF - 1 };
    const step = (lockedOut: boolean) => {
      let p = { ...from };
      for (let i = 0; i < 40; i++) p = resolveObstacles(p.x, p.z + 0.1, obstaclesFor(atBottom, lockedOut, OBSTACLES));
      return p;
    };
    expect(isSafe(step(false).x, step(false).z)).toBe(true);
    expect(isSafe(step(true).x, step(true).z)).toBe(false);
    // the car's away at the top: the bottom door is shut to everyone
    let p = { ...from };
    for (let i = 0; i < 40; i++) p = resolveObstacles(p.x, p.z + 0.1, obstaclesFor({ at: "top", phase: "open" }, false, OBSTACLES));
    expect(isSafe(p.x, p.z)).toBe(false);
  });

  it("joins the two cars into one walkable shape, with nothing walkable between the levels", () => {
    expect(isWalkable(carMid("top").x, carMid("top").z)).toBe(true);
    expect(isWalkable(carMid("bottom").x, carMid("bottom").z)).toBe(true);
    expect(isWalkable(0, (LIFT_CARS.bottom.maxZ + LIFT_CARS.top.minZ) / 2 - 8)).toBe(false);
  });
});
