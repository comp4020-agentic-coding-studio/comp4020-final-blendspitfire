# ADR 0001: one server-authoritative world that everyone sees live

Status: accepted, 2026-10-14

## Context

Several people can be in the facility at once. Someone has to decide where
each player is, who got hit, where a box was put down and whether the
reactor is on, and everyone else has to find out.

This game is designed as a real-time online game, so ordinary online play is
its foundation. By the README's standard of "good", that means it should
behave the way players expect any normal online game to: everyone in the
same world, seeing the same things, live, with no surprises.

## Options considered

1. **The server decides, and broadcasts one shared world to everyone.**
   Clients send what the player is trying to do; the server checks it
   against the rules and sends the result to all.
2. **Each client decides for itself and tells the others.** Feels
   instant, but anyone can claim anything (walk through walls, hit from
   across the map), and two clients that disagree about a box or a hit
   have no one to settle it.
3. **Only some things are live.** For example, positions live but built
   boxes or the reactor's state only on reload. Simpler, but players would
   see different worlds until they refreshed, which no normal online game
   does.

## Decision

Option 1. The server holds the one world and broadcasts it about 15 times a
second. Every rule is checked there: movement against walls, one-way gate
included; where a box can go; who a projectile hits; whether the reactor
can be activated. When two people go for the same thing at once (the same
item, the same spot), whoever's message reaches the server first wins, and
the other sees the result on the next update. Reconnecting puts you back
in the intake room in the current world.

## What it costs

- **Waiting on the server feels laggy.** Your own actions would only show
  after a round trip. To hide that, the client predicts its own movement
  and shots immediately, then corrects to the server's answer; other
  players are smoothly interpolated between updates.
- **Server load.** Everything runs and is checked on one small machine
  (256 MB, one shared vCPU), which caps how many players it can hold.
- **Not everything is server-side yet.** Line of sight is computed on each
  client, so the server still sends every player's position to everyone.
  A modified client could see through walls. Accepted for now, because
  there's no competitive PVP to protect.
- **Not everything persists yet.** Items and the reactor's state live in
  the server's memory, so a restart resets them. Persisting them is part
  of the PVE loop's "keep what you built", still to come.
