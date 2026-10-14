# HANDOFF (agent-facing; terse; overwrite stale lines, don't append history)

> **AI-recorded.** Written and kept current automatically by the coding agent (Claude Code) as its session-to-session handoff, not written by hand. Terse on purpose: it's for the next agent session to pick up from. Decision history lives in [adr.md](adr.md).

Updated: 2026-10-14 ~13:00 (after a ~1h autonomous dev round, user away)

## Where we are
- Crit 9 shipped, tag crit-9 = 21b793a. Next: crit 10 (week 11), then final project. Same repo; tag crit-10 via /ship.
- LOCAL ONLY, user decides push (push to main = deploy): 9f9b396 respawn loop fix, 88057ba+dbfca06 torch -> headlamp at brim edge (look.ts HEADLAMP), ebd6978 art-doc rule, 22dd2a7 + cd7a57f CLAUDE.md commits (Committing rule, handoff test), 9fc976a lamps off the ceiling, 2e194f4 handoff/ADR into docs/, 2b440c3 full-auto, b792b08 wounds + enemy targeting, 11ed891 permadeath/spectate/wipe, 4acc9fd box wear visuals, + this handoff/ADR commit.
- Commit finished+verified work without asking (CLAUDE.md). Never push unasked.
- Budget 2026-10-14: $122/$200, resets Thu 2026-10-15 09:00.

## Game (current, all built and deployed except the local commits above)
- Persistent multiplayer PVE in an underground facility: intake room (safe, no fire) -> one-way gate -> facility (corridor, lab, server hall, core). Activate reactor (empty-handed, in range) -> 10s -> waves of crawlers from 3 breaches, flow-field pathing to reactor, boxes act as walls (chewed if fully sealed; wear sent as ItemState.wear -> shudder/slump/dust). Attempt lost (Defence.fail) when reactor HP 0 OR every player who passed the gate is out; reactor goes dark, built boxes kept, out players revived to intake.
- Enemy targeting (server/defence.ts chooseTarget, numbers in shared/enemies.ts): player within AGGRO 6 with clear straight line (walls/fixtures/boxes block) -> chase; leash 10; lost sight -> search last seen 2s -> back to reactor; within REACTOR_COMMIT 2.5 of reactor = stays on reactor; players in intake never targeted.
- Players: MAX_WOUNDS 3, 4th hit kills; WOUND_GRACE_MS 1000 between hits. Wound 1 = 0.75 speed (woundedSpeed, server move clamp too), 2 = daze post effect, 3 = aim spread ±0.12 rad (applied client-side, sent as aim; co-op so trusted). Wounds clear on death. Death while reactor live = out (deadUntil Infinity, wire `out: true`) -> spectate living entered teammates (CRT post effect, click = next); otherwise 3s respawn.
- Items: gun (primary=fire, click = 1 shot, hold = full auto at FIRE_COOLDOWN_MS 150; straight fast shots 45u/s, no bounce), box (primary=place, secondary=grid snap, Q=place/drop). Stations restock.
- Server-authoritative, 20 Hz broadcast with server time; snapshot interpolation client-side; deterministic shots (sent once); items sent only when changed. SQLite persists items, objective, defence (flush on interval + SIGTERM). Hardening: 4KB frames, 60 msg/s, move speed clamp.
- Look: OKLCH greyed surface gamut, only emitters vivid; 8-light pool + torch (only shadow caster); no fixtures drawn on the ceiling: edge/narrow-room lamps are wall-mounted (lampSource() offsets their light off the wall), overhead lamps draw no fixture, halo = faint floor pool (look.ts lampHalos); LOS mask (unseen + wall tops black); pixel post 0.42; camera altitude 16. Rules in docs/art-and-interaction.md.

## Key files
- shared/protocol.ts (contract, map, shot maths), shared/enemies.ts (balance numbers + FlowField), shared/palette.ts
- server/index.ts (connections, tick, projectiles, respawn), server/defence.ts, server/db.ts
- client/main.ts, client/netsync.ts, client/look.ts, client/visibility.ts, client/postprocess.ts, client/models/*, client/world/dressing.ts
- Tests: spec/*.test.ts (102; spec/defence.test.ts = targeting + chewing, unit-level with a fake World). Report of auto-dev: .claude/reports/2026-10-14-auto-dev.md. Decisions: docs/adr.md (synced from local draft .claude/notes/adr-draft.md).

## Next work (none urgent, none chosen yet — ask which before starting; user's ordering rule: finish existing mechanics before the intake rework)
User's future directions (2026-10-14, dictated). Items 2-5 BUILT in the autonomous round (commits above) with agent-chosen numbers/effects; user hasn't played them yet -> first thing: ask user to playtest and react (wound effects, CRT strength, daze strength, aggro range, grace 1s, rate of fire).
1. Lighting: try option C INSTEAD of A (C replaces A; B wall lamps stay): overhead lamps get their fixtures + air halos back, and fade out near/over the player, cutaway-style. Undoes the 'no fixture, floor-pool halo' part of 9fc976a (lampModel ceiling branch, lampHalos floor pool) and the matching art-doc rule. Fixtures are currently merged into the facility mesh -> need splitting out for per-lamp opacity. Also fewer lamps with larger range -> hazier, murkier scene.
2. [built] Rifle full-auto.
3. [built] Enemy AI chooses player vs reactor (straight-line chase only: no pathing around corners to a player; could use a per-player flow field later).
4. [built] Wounds with escalating debuffs (slow / daze / aim shake). Debuff list was agent's pick from user's examples; open to change.
5. [built] Permadeath per attempt + spectate + CRT. Agent choices to confirm: only while reactor live (free-roam deaths still respawn); 'all dead' counts only players who passed the gate. Known gap: out player reconnecting comes back fresh.
6. Persistent map needs a resource loop: gather in-map -> craft -> place (currently boxes only from stations).
7. LAST (after mechanics are complete): intake becomes a separate prep room that tutorialises every mechanic safely; exit gated on using one (e.g. repair a generator to open the door). Form waits on what mechanics exist.
- User noted gameplay itself still needs lots more; not listed yet.
Older candidates still open: difficulty tuning by play (shared/enemies.ts; debug overlay) — more needed now wounds/aggro exist; no sound at all; second enemy type; server-side visibility (enemies behind walls sent to clients).
- Open user decisions: overall grade/brightness (client/assets/grade.ts); hall racks very claustrophobic; intake form -> see next-work 7; hide /gallery.html in prod?; slider grade UI (noted, not built).
- Docs: README "good" section unfinished (user writes); PROCESS.md for crit 10 later. Authorship rule: skeleton only unless user dictated.

## Verify recipes / gotchas
- Dev: `DB_PATH=/tmp/blendspitfire-dev.db pnpm dev` (8080). DEV_SPAWN="x,z" / DEV_JOIN="x,z" env = local spawn override. `pnpm check` needs a running server.
- Client edits: rerun `node scripts/build-client.ts` (dev doesn't watch). Server/protocol edits: restart server.
- Node strip-only TS: no parameter properties.
- Screenshots: /tmp/look/shotlog.sh out.png url (headless Chrome, virtual time). For anything time-based (enemies, respawn) use real time via --remote-debugging-port, not --virtual-time-budget.
- Gallery: /gallery.html (model sheet), ?facility, &x=&z= (game view with LOS), &live (crawlers), &pixel=0, &nomask.
- Game URL flags: ?daze=0..1 and ?crt=0..1 force the wound blur / spectator CRT for screenshots.
- Driving a real browser: /tmp/drive/cdp.mjs <port> <script.mjs> (Node CDP; script gets send/evalJs/shot/sleep) + /tmp/drive/chrome.sh <port> <profile> <url>; kill the Chrome after (pkill -f user-data-dir=/tmp/drive/<profile>) or it stays connected as a ghost player. Multi-client scenarios: plain Node WebSocket clients (see /tmp/drive/wipe.mjs). /tmp is not durable.
- `pnpm check` against a server started WITH DEV_SPAWN fails the teleport test (spawns in the lab): restart without it first. Judge check by exit code, not a grep.

## User prefs
- Chinese conversation. Chained doc requests: one step at a time, drafts in Chinese until approved.
- Fix bugs without trading away intended effects (e.g. keep shadows, move the light).
- Cost-conscious: cheap subagents for mechanical work; suggest fresh session over resuming long ones.
