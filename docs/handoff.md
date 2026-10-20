# HANDOFF (agent-facing; terse; overwrite stale lines, don't append history)

> **AI-recorded.** Written and kept current automatically by the coding agent (Claude Code) as its session-to-session handoff, not written by hand. Terse on purpose: it's for the next agent session to pick up from. Decision history lives in [adr.md](adr.md).

Updated: 2026-10-21 (crit-10 shipped: tag pushed to origin, points at de1932b = main; course plugin at 0.14.30)

## Where we are
- Crit 10 "Fly by instruments" cutoff was Wed 2026-10-21 08:30 — DONE: `crit-10` tag exists on origin at de1932b (= main HEAD). Spec: multi-user, server-checked permissions written down with why (ADR-036), server logs of who did what, pod plays from URL alone while user narrates from `mise exec -- flyctl logs -a <repo>`, reflections/crit-10.md + PROCESS.md (both done 2026-10-20). Final project due 2026-11-09 12:00.
- Everything up to de1932b is pushed and deployed (CI check + deploy green; spec passes against the live fly.dev app). Second-tab takeover now sends a "replaced" message before closing (Fly's proxy swallowed the 4000 close frame).
- Branch `surface` is merged (fast-forward) into main; still present locally, not yet deleted (ask before deleting).
- Commit finished+verified work without asking (CLAUDE.md). Never push unasked.

## Game (current)
- Persistent multiplayer PVE. Spawn in a sunlit garden on the surface (tutorial stations, 3 targets, scoreboard screen) -> one lift -> underground facility (corridor, lab, server hall, core). Surface = same coords +40 Z (LIFT_DZ); identical car at both ends.
- Lift (server/lift.ts, rules in shared/protocol.ts liftVerdict/obstaclesFor): E in car = send (wait 15 s if someone on that level isn't aboard, 3 s if all are); E at door outside = call empty car; empty car at bottom returns up after 5 s. Ride shifts everyone/items in the car by LIFT_DZ and bumps their `warp` (client jumps, stale moves dropped). No firing in the car (noFireAt); garden allows firing.
- Attempt membership (ADR-038): being below = in the attempt. Death below = out (spectate) even before the reactor's on; before the reactor's on you may ride up (leaves the attempt, garden respawn works). Reactor on: bottom door shut to anyone outside the car, car won't carry anyone up. Attempt end (win/fail/everyone below dead pre-reactor) -> everyoneUp(): all below revived in garden, lift reset to top.
- Run/attempt loop (ADR-037): activate reactor (empty-handed, in range) -> it charges, full at CHARGE_MS 6 min = run WON (recorded on board, facility reset to starting kit, everyone up to the garden). Waves on the clock: size 4+22c, gap 15s->4s with charge c, overlap allowed, MAX_ENEMIES 40. Attempt FAILS when reactor HP 0 or every crew player is out -> charge back to 0, boxes kept, out players revived. Box cap 60 (was 30).
- Identity (ADR-036): server cookie UUID; codename = colour name + id[0:4] (palette.ts codename), on screen and in logs, stable across reconnects. Second tab with same cookie replaces the first (close code 4000, client shows "open in another tab", no reconnect). Wounds/out carried across reconnect within an attempt (server/index.ts `carried`).
- Logs: `[Codename] verb ...` via act(); refusals via refuse() (1 per kind per 3 s per player); shots summed per 5 s; `[attempt N] failed/WON ... (crew: ...)`.
- Board: SQLite tables stats (per player lifetime kills/boxes/attempts/wins) + runs (won runs) + world key "run" (attempts, best charge). Sent as BoardMessage on join and when dirty (<=1/s). Client: screen in the garden (top-3 preview on its roof); E near it opens centred #board panel (closes on walk-away/E/Esc).
- Interaction: E = nearest usable (lift button > item > reactor > scoreboard), tap only; click on item/reactor still works. Prompts (client/ui/prompts.ts) pinned to world points, white = can, grey = can't + reason. All HUD = white/grey line style (CSS in public/index.html).
- Enemy targeting (server/defence.ts chooseTarget, numbers in shared/enemies.ts): player within AGGRO 6 with clear straight line -> chase; leash 10; search 2s; within REACTOR_COMMIT 2.5 stays on reactor; players in the car/surface (isSafe) never targeted.
- Players: MAX_WOUNDS 3, 4th hit kills; grace 1s. Wound 1 = 0.75 speed, 2 = daze, 3 = aim spread. Death below = out -> spectate on CRT; death in the garden = 3s respawn.
- Items: gun (click = 1 shot, hold = full auto 150ms), box (primary=place, secondary=grid snap, Q=place/drop). Stations restock.
- Server-authoritative 20 Hz, snapshot interpolation; SQLite persists items/objective/defence/run/board. Hardening: 4KB frames, 60 msg/s, move speed clamp.
- Look underground: OKLCH greyed gamut, emitters vivid; 8-light pool + headlamp (only shadow caster); LOS mask; pixel post. Rules in docs/art-and-interaction.md.
- Look on the surface (exempt from the art rules, user's call): client/world/surface.ts (own palette/material, sun + sky light with shadows), "paint" post pass (Kuwahara, warm grade, canvas grain; unseen = cream canvas). main.ts stepLevel() switches LOS mask, sun/ambient/headlamp and paint by level; cross-fades in the car.

## Key files
- shared/protocol.ts (contract, map, shot maths), shared/enemies.ts (balance numbers + FlowField), shared/palette.ts
- server/index.ts (connections, tick, projectiles, respawn), server/defence.ts, server/db.ts
- client/main.ts, client/netsync.ts, client/look.ts, client/visibility.ts, client/postprocess.ts, client/models/*, client/world/dressing.ts
- Surface/lift/UI: server/lift.ts, client/world/surface.ts, client/world/lift.ts (doors, button panel), client/ui/prompts.ts, client/floorGuides.ts (garden decals)
- Tests: spec/*.test.ts (117; spec/lift.test.ts = lift state machine + verdicts + door lockout; spec/multiuser.test.ts = identity/second tab/held item; spec/defence.test.ts = targeting + chewing, unit-level with a fake World). Report of auto-dev: .claude/reports/2026-10-14-auto-dev.md. Decisions: docs/adr.md (synced from local draft .claude/notes/adr-draft.md).

## Next work (ordered)
0. Crit 10 shipped (tag pushed). User still to playtest garden look, prompts, lift (single + two tabs), scoreboard. Rough edges: garden layout placed by eye; scoreboard roof preview tiny; DEV_JOIN/DEV_SPAWN skip the lift (spawning below counts as in the attempt).
- User's improvement notes for the surface/lift (2026-10-20; queued, NOT now; do when user says):
  - a. Lift doors: open/close animation that sight follows: view narrows/widens with the door gap (now: leaves slide, but the LOS door obstacle is all-or-nothing, see main.ts updateSightDoors).
  - b. Garden out-of-sight = black like underground, not cream canvas (postprocess.ts mask mix with `paint`).
  - c. Garden bigger, bounded by a see-through fence instead of LOS occlusion (can see what's beyond it).
  - d. Garden colour/tone stays; dressing should tell the story: an ancient ruined facility being explored by a military-type organisation, so ruins/rust AND recently deployed kit (supply crates etc.).
  - e. (DECIDED direction, not built yet) Replace the 6-min charge bar with a wave count. 30 s break between waves to buy items/buildings (shop/currency doesn't exist yet; it will). A wave ends when it's cleared; per-wave score, faster clear = more. Agent-suggested score parts for the user to pick from (none chosen yet): clear-time bonus vs par time; no-damage bonus (whole team unhurt); no-death bonus (no teammate out); reactor-untouched bonus; streak multiplier for consecutive clean waves; per-kill base points; accuracy. Refs: Halo Firefight (round/set bonuses, no-death), CoD Zombies (per-kill points that double as currency), Killing Floor (trader break between waves), DMC/Hi-Fi Rush style letter rank per wave. Score DOES double as currency (user, 2026-10-20), framed in-fiction: a shady megacorp's supply quota/credit issued to expendable contractors/employees (score = quota earned, spent at a corp supply terminal/drop). Break has a "start next wave now" option (all-ready vote or anyone? undecided). Open: what ends a run/attempt now; win condition (N waves?) and what the board records.
  - f. Reactor E shouldn't require empty hands (user: feels anti-human). The "hands full" verdict dates from click-to-activate, when a click with a gun meant firing; with E there's no conflict. Fix: drop the holding check from activateVerdict (shared/protocol.ts) + ACTIVATE_TIPS, server + client together.
1. Tune difficulty for "~a dozen attempts": DEV_CHARGE_S env shortens the charge for local runs. Unknown: how far an empty map gets now; boxes chewed in 6 hits may make carry-over too weak or strong. Numbers in shared/enemies.ts (waveSize, waveGapMs, ENEMY_REACTOR_DAMAGE, BOX_HIT_POINTS).
2. Still pending playtest from 2026-10-14 autonomous round: wound effects, CRT/daze strength, aggro 6, grace 1s, rate of fire.
3. Lighting option C instead of A (overhead fixtures + air halos back, fading near the player; fixtures need splitting out of the merged facility mesh; fewer, wider lamps).
4. Resource loop (gather -> craft -> place) to replace the raised box cap as the thing that grows between attempts.
5. Garden tutorial could gate on using a mechanic (was "intake prep room").
- Older candidates: no sound; second enemy type; server-side visibility (enemies behind walls are sent to clients); charge bar has no in-world visual on the reactor (HUD only).
- Open user decisions: lift-return rule (now: returns any time; alt: only after the attempt ends); overall grade/brightness (client/assets/grade.ts); hall racks claustrophobic; hide /gallery.html in prod?; slider grade UI.
- Docs: README "good" section unfinished (user writes). Authorship rule: skeleton only unless user dictated.

## Verify recipes / gotchas
- Dev: `DB_PATH=/tmp/blendspitfire-dev.db pnpm dev` (8080). DEV_SPAWN="x,z" / DEV_JOIN="x,z" env = local spawn override. `pnpm check` needs a running server.
- Client edits: rerun `node scripts/build-client.ts` (dev doesn't watch). Server/protocol edits: restart server.
- Node strip-only TS: no parameter properties.
- Screenshots: /tmp/look/shotlog.sh out.png url (headless Chrome, virtual time). For anything time-based (enemies, respawn) use real time via --remote-debugging-port, not --virtual-time-budget.
- Gallery: /gallery.html (model sheet), ?facility, &x=&z= (game view with LOS), &live (crawlers), &pixel=0, &nomask.
- Game URL flags: ?daze=0..1 and ?crt=0..1 force the wound blur / spectator CRT for screenshots.
- Quick attempt lifecycle: DB_PATH=/tmp/x.db DEV_JOIN="0,-7.6" DEV_CHARGE_S=10 node server/index.ts (joins in reactor range; 10 s charge). Scripted ws clients that activate/idle/reconnect then read the server log; see git history of this note for the shape (pickup/activate/move messages in shared/protocol.ts).
- Port 8080 may show a QQ process in lsof (unrelated); the server still binds.
- Driving a real browser: /tmp/drive/cdp.mjs <port> <script.mjs> (Node CDP; script gets send/evalJs/shot/sleep/key/hold/mouse; picks the localhost tab) + /tmp/drive/chrome.sh <port> <profile> <url> (headless=new); kill the Chrome after (pkill -f user-data-dir=/tmp/drive/<profile>) or it stays connected as a ghost player. Multi-client scenarios: plain Node WebSocket clients (see /tmp/drive/wipe.mjs). /tmp is not durable.
- `pnpm check` against a server started WITH DEV_SPAWN fails the teleport test (spawns in the lab): restart without it first. Judge check by exit code, not a grep.
- Lift timing for scripts: short wait 3 s + door 0.9 + ride 2.6 + door 0.9. Corridor barrier at z 15.5 (x -2..0): route via x 1.2. Moves must carry `warp` from the latest state or they're dropped.

## User prefs
- Chinese conversation. Chained doc requests: one step at a time, drafts in Chinese until approved.
- Fix bugs without trading away intended effects (e.g. keep shadows, move the light).
- Cost-conscious: cheap subagents for mechanical work; suggest fresh session over resuming long ones.
