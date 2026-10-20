# HANDOFF (agent-facing; terse; overwrite stale lines, don't append history)

> **AI-recorded.** Written and kept current automatically by the coding agent (Claude Code) as its session-to-session handoff, not written by hand. Terse on purpose: it's for the next agent session to pick up from. Decision history lives in [adr.md](adr.md).

Updated: 2026-10-21 (overnight autonomous round: waves, turret + quota, garden rework, door sight; all committed, NOT pushed)

## Where we are
- Crit 10 shipped (tag `crit-10` on origin at de1932b). Final project due 2026-11-09 12:00.
- Local main is ahead of origin by the overnight commits (7636137 waves, 982db86 turret/quota, 4fa2c53 garden, c7f3848 door sight, + docs). **Not pushed** — push deploys; wait for the user.
- The user asked (2026-10-21, then went to sleep) for: waves (e) -> turret + economy -> queued a/b/c/d/f, options listed but agent picks and builds the best, user reviews later. All done. Every agent default is in docs/adr.md ADR-040..043, marked "awaiting review".
- Branch `surface` is merged into main; still present locally (ask before deleting).
- Commit finished+verified work without asking (CLAUDE.md). Never push unasked.

## Game (current)
- Persistent multiplayer PVE. Spawn in the surface garden -> one lift -> underground facility (corridor, lab, server hall, core). Surface = same coords +40 Z (LIFT_DZ); identical car at both ends.
- Lift (server/lift.ts, rules in shared/protocol.ts liftVerdict/obstaclesFor): E in car = send (wait 15 s if someone on that level isn't aboard, 3 s if all are); E at door outside = call empty car; empty car at bottom returns up after 5 s. Ride shifts everyone/items in the car by LIFT_DZ and bumps `warp`. No firing in the car. Sight through the doors follows each leaf (main.ts updateSightDoors, ADR-043).
- Attempt membership (ADR-038): being below = in the attempt. Death below = out (spectate). Before the reactor's on you may ride up (leaves the attempt). Reactor on: bottom door shut to anyone outside the car, car won't carry anyone up. Attempt end -> everyoneUp().
- Objective (ADR-040): E at reactor (any hands) starts the attempt -> 10 s break -> waves. Wave n = 4+22·n/10 enemies; cleared when all spawned and none alive -> 30 s break (WAVE_BREAK_MS) -> next. E at reactor during a break = send the next wave now (anyone). Clear wave WAVES_TO_WIN=10 = run WON (board, facility reset, quota reset). Fail (reactor HP 0 / all crew out) -> wave count to 0, boxes/turrets/quota kept. DefenceState {reactorHealth, wave, phase "spawning"|"break", nextWaveAt}. MAX_ENEMIES 40.
- Quota (ADR-041): shared crew balance `funds` (world key "funds", in StateMessage.funds). Wave clear pays waveReward = 15 + seconds under par (2.5 s/enemy). Spent at the supply terminal (corridor x1.55 z6.5, fixture "supplyTerminal", where the vending machine was): E = buy turret, 40 quota, cap 8 (buyVerdict).
- Turret item (ADR-041): ItemKind "turret", BLOCKING_KINDS {box, turret} — placed/snapped/blocking/chewed like a box (10 hits vs box 6). Placed turrets (Defence.fireTurrets) fire every 0.6 s at nearest visible enemy ≤7 via World.turretFire -> real projectile owned by the turret id; turret shots skip players; kills credit nobody. `aim` field on ItemState swings the model's head.
- Identity (ADR-036): cookie UUID; codename = colour + id[0:4]. Second tab replaces the first. Wounds/out carried across reconnect within an attempt.
- Logs: `[Codename] verb ...` via act(); refusals via refuse() (1/kind/3 s/player); `[attempt N] wave K cleared in Ns: quota +X -> Y`; `[attempt N] failed/WON ...`.
- Board: SQLite stats + runs + world key "run" {attempts, best = most waves cleared}. Garden screen; E opens #board panel.
- Interaction: E = nearest usable (lift button > item > supply terminal > reactor > scoreboard), tap only. Click on reactor activates only empty-handed (with an item, click = the item's action). Prompts pinned to world points, white/grey.
- Enemy targeting (defence.ts chooseTarget): AGGRO 6 with clear line, leash 10, search 2 s, REACTOR_COMMIT 2.5; isSafe players never targeted.
- Players: MAX_WOUNDS 3; grace 1 s. Death below = out -> CRT spectate; death in the garden = 3 s respawn.
- Items: gun (click/hold full auto 150 ms), box + turret (primary = place, secondary = grid snap, Q = place). Stations restock gun/box.
- Server-authoritative 20 Hz; SQLite persists items/objective/defence/run/board/funds.
- Look underground: OKLCH greyed gamut, emitters vivid; 8-light pool + headlamp; LOS mask; pixel post. Rules in docs/art-and-interaction.md.
- Surface (ADR-042, exempt from art rules): garden 34×24 (SURFACE), chain-link FENCES (collide, don't block sight), sight reaches SURFACE_VIEW_MARGIN=6 past the fence onto outside ruins (surface.ts outsideRuins, visual only). Inside: ruin pillars/lintel + corp supply crates/field tent (SURFACE_FIXTURES); keep anything inside under 0.95 half-height or it casts black wedges on the lawn. Paint post pass; out of sight = black.

## Key files
- shared/protocol.ts (contract, map, verdicts incl. buyVerdict/waveReward, shot maths), shared/enemies.ts (balance + FlowField + turret numbers), shared/palette.ts
- server/index.ts (connections, tick, projectiles, buy, funds), server/defence.ts (waves, turrets), server/db.ts
- client/main.ts, client/net.ts, client/postprocess.ts, client/visibility.ts, client/models/index.ts (sentryTurret), client/models/facility.ts (supplyTerminal), client/world/surface.ts
- Tests: spec/*.test.ts (129). defence.test.ts = targeting, chewing, waves/breaks/skip/win/fail, turrets, payout (fake World). economy.test.ts = waveReward + buyVerdict. Decisions: docs/adr.md (synced to 2026-10-21 from .claude/notes/adr-draft.md).

## Next work (ordered)
1. User reviews the overnight round (ADR-040..043): play a full attempt; judge turret model (small/dark from overhead, only its amber light reads — likely needs a brighter top or a range ring), supply terminal, garden ruins/kit layout, door sight. Open choices listed in those ADRs: skip = anyone vs all-ready vote; shared vs per-player quota; which extra score parts (no-damage/no-death/streak/per-kill); turret cost/cap/rate; WAVES_TO_WIN.
2. Tune: one turret alone doesn't clear wave 1 (by design?); reward/cost pace untested past wave 1. DEV_WAVES=N shortens a run. Numbers: shared/enemies.ts (waveSize, TURRET_*), shared/protocol.ts (TURRET_COST, WAVE_BASE_REWARD, PAR_MS_PER_ENEMY).
3. Shop has one item; more buildables/items when the user picks them.
4. Still pending playtest from 2026-10-14: wound effects, CRT/daze strength, aggro 6, grace 1 s, rate of fire.
5. Lighting option C (overhead fixtures + halos; fewer, wider lamps).
6. Garden tutorial could gate on using a mechanic.
- Older candidates: no sound; second enemy type; server-side visibility; no in-world wave/break indicator on the reactor (HUD only).
- Open user decisions: lift-return rule; overall grade/brightness; hall racks claustrophobic; hide /gallery.html in prod?; slider grade UI.
- Docs: README "good" section unfinished (user writes). Authorship rule: skeleton only unless user dictated.

## Verify recipes / gotchas
- Dev: `DB_PATH=/tmp/blendspitfire-dev.db pnpm dev` (8080). DEV_SPAWN / DEV_JOIN="x,z" = local spawn override. `pnpm check` needs a running server started WITHOUT DEV_SPAWN.
- Client edits: rerun `node scripts/build-client.ts` (dev doesn't watch). Server/protocol edits: restart server.
- Node strip-only TS: no parameter properties.
- Quick attempt: DB_PATH=/tmp/x.db DEV_JOIN="0,-7.6" DEV_WAVES=2 node server/index.ts (joins in reactor range). Seed quota: insert world row ("funds","100") into the db before starting. Join at the terminal: DEV_JOIN="0.2,6.2".
- Scripted ws clients: /tmp/wavecheck/{live,econ,fire}.mjs (activate/skip, buy+place, turret fire). /tmp is not durable; shapes are in shared/protocol.ts ClientMessage.
- Driving a real browser: /tmp/drive/cdp.mjs <port> <script.mjs> + /tmp/drive/chrome.sh <port> <profile> <url>; kill the Chrome after (pkill -f user-data-dir=/tmp/drive/<profile>) or it stays as a ghost player.
- Gallery: /gallery.html (model sheet incl. sentry turret + supply terminal), ?facility, &x=&z=, &live, &pixel=0, &nomask. Game URL flags: ?daze=, ?crt=.
- Port 8080 may show a QQ process in lsof (unrelated). macOS sed has no \b: use perl -pi.
- Lift timing for scripts: short wait 3 s + door 0.9 + ride 2.6 + door 0.9. Moves must carry `warp` from the latest state.

## User prefs
- Chinese conversation. Chained doc requests: one step at a time, drafts in Chinese until approved.
- Fix bugs without trading away intended effects (e.g. keep shadows, move the light).
- Cost-conscious: cheap subagents for mechanical work; suggest fresh session over resuming long ones.
