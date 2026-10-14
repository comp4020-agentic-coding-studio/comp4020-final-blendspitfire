# HANDOFF (agent-facing; terse; overwrite stale lines, don't append history)

> **AI-recorded.** Written and kept current automatically by the coding agent (Claude Code) as its session-to-session handoff, not written by hand. Terse on purpose: it's for the next agent session to pick up from. Decision history lives in [adr.md](adr.md).

Updated: 2026-10-14 ~11:45

## Where we are
- Crit 9 shipped, tag crit-9 = 21b793a. Next: crit 10 (week 11), then final project. Same repo; tag crit-10 via /ship.
- LOCAL ONLY, user decides push (push to main = deploy): 9f9b396 respawn loop fix, 88057ba+dbfca06 torch -> headlamp at brim edge (look.ts HEADLAMP), ebd6978 art-doc rule, 22dd2a7 + cd7a57f CLAUDE.md commits (Committing rule, handoff test), 9fc976a lamps off the ceiling, + docs commit moving handoff/ADR into docs/.
- Commit finished+verified work without asking (CLAUDE.md). Never push unasked.
- Budget 2026-10-14: $122/$200, resets Thu 2026-10-15 09:00.

## Game (current, all built and deployed except the local commits above)
- Persistent multiplayer PVE in an underground facility: intake room (safe, no fire) -> one-way gate -> facility (corridor, lab, server hall, core). Activate reactor (empty-handed, in range) -> 10s -> waves of crawlers from 3 breaches, flow-field pathing to reactor, boxes act as walls (chewed if fully sealed). Reactor HP 0 = round lost, reactor goes dark, built boxes kept.
- Items: gun (primary=fire, straight fast shots 45u/s, no bounce), box (primary=place, secondary=grid snap, Q=place/drop). Stations restock.
- Server-authoritative, 20 Hz broadcast with server time; snapshot interpolation client-side; deterministic shots (sent once); items sent only when changed. SQLite persists items, objective, defence (flush on interval + SIGTERM). Hardening: 4KB frames, 60 msg/s, move speed clamp.
- Look: OKLCH greyed surface gamut, only emitters vivid; 8-light pool + torch (only shadow caster); no fixtures drawn on the ceiling: edge/narrow-room lamps are wall-mounted (lampSource() offsets their light off the wall), overhead lamps draw no fixture, halo = faint floor pool (look.ts lampHalos); LOS mask (unseen + wall tops black); pixel post 0.42; camera altitude 16. Rules in docs/art-and-interaction.md.

## Key files
- shared/protocol.ts (contract, map, shot maths), shared/enemies.ts (balance numbers + FlowField), shared/palette.ts
- server/index.ts (connections, tick, projectiles, respawn), server/defence.ts, server/db.ts
- client/main.ts, client/netsync.ts, client/look.ts, client/visibility.ts, client/postprocess.ts, client/models/*, client/world/dressing.ts
- Tests: spec/*.test.ts (97). Report of auto-dev: .claude/reports/2026-10-14-auto-dev.md. Decisions: docs/adr.md (synced from local draft .claude/notes/adr-draft.md).

## Next work (none urgent, none chosen yet — ask which before starting; user's ordering rule: finish existing mechanics before the intake rework)
User's future directions (2026-10-14, dictated):
1. Lighting: try option C INSTEAD of A (C replaces A; B wall lamps stay): overhead lamps get their fixtures + air halos back, and fade out near/over the player, cutaway-style. Undoes the 'no fixture, floor-pool halo' part of 9fc976a (lampModel ceiling branch, lampHalos floor pool) and the matching art-doc rule. Fixtures are currently merged into the facility mesh -> need splitting out for per-lamp opacity. Also fewer lamps with larger range -> hazier, murkier scene.
2. Rifle: full-auto fire (hold primary).
3. Enemy AI: choose target actively — attack players or the reactor (currently flow-field to reactor only).
4. Player health, "simple" = a few hits, NOT a bar: each hit adds an escalating debuff (e.g. hit 1 slows move, hit 2 blurs vision, ...). Exact debuff list open.
5. Death is permanent for the wave: no respawn; all players dead = wave lost. Dead players spectate living teammates through a fun post filter (e.g. old CRT TV look).
6. Persistent map needs a resource loop: gather in-map -> craft -> place (currently boxes only from stations).
7. LAST (after mechanics are complete): intake becomes a separate prep room that tutorialises every mechanic safely; exit gated on using one (e.g. repair a generator to open the door). Form waits on what mechanics exist.
- User noted gameplay itself still needs lots more; not listed yet.
Older candidates still open: difficulty tuning by play (shared/enemies.ts; debug overlay); box-chewed visual + no sound at all; second enemy type; server-side visibility (enemies behind walls sent to clients).
- Open user decisions: overall grade/brightness (client/assets/grade.ts); hall racks very claustrophobic; intake form -> see next-work 7; hide /gallery.html in prod?; slider grade UI (noted, not built).
- Docs: README "good" section unfinished (user writes); PROCESS.md for crit 10 later. Authorship rule: skeleton only unless user dictated.

## Verify recipes / gotchas
- Dev: `DB_PATH=/tmp/blendspitfire-dev.db pnpm dev` (8080). DEV_SPAWN="x,z" / DEV_JOIN="x,z" env = local spawn override. `pnpm check` needs a running server.
- Client edits: rerun `node scripts/build-client.ts` (dev doesn't watch). Server/protocol edits: restart server.
- Node strip-only TS: no parameter properties.
- Screenshots: /tmp/look/shotlog.sh out.png url (headless Chrome, virtual time). For anything time-based (enemies, respawn) use real time via --remote-debugging-port, not --virtual-time-budget.
- Gallery: /gallery.html (model sheet), ?facility, &x=&z= (game view with LOS), &live (crawlers), &pixel=0, &nomask.

## User prefs
- Chinese conversation. Chained doc requests: one step at a time, drafts in Chinese until approved.
- Fix bugs without trading away intended effects (e.g. keep shadows, move the light).
- Cost-conscious: cheap subagents for mechanical work; suggest fresh session over resuming long ones.
