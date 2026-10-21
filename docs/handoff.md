# HANDOFF (agent-facing; terse; overwrite stale lines, don't append history)

> **AI-recorded.** Written and kept current automatically by the coding agent (Claude Code) as its session-to-session handoff, not written by hand. Terse on purpose: it's for the next agent session to pick up from. Decision history lives in [adr.md](adr.md).

Updated: 2026-10-21 (third playtest round done: lift, gore, eyes, minimap; committed, NOT pushed; tutorial discussion next)

## Where we are
- Crit 10 shipped (tag `crit-10` on origin at de1932b). Final project due 2026-11-09 12:00.
- Local main is ahead of origin by the overnight commits and this round's (c7cfe69 .. latest). **Not pushed**: a push deploys, so wait for the user.
- Third round (ADR-050 playtest observation, ADR-051 fixes; user's list 2026-10-21): lift pop-in REAL cause fixed = surface group (buildSurface, ruins reach z≈14, a building shell sat inside the bottom car) now hidden underground (`surface.visible = up` in stepLevel). Gore: blood at BLOOD_Y 0.03 (floor tile tops are y=0.02, marks ~0.026), corpses flatten()ed to 4 cm at y 0.045 (gore.ts). Crawler eyes = lens flare (look.ts crawlerEyes: core+bloom+4-point star with independently wobbling arms; halo ring + horizontal streak fade in when near>0.6; tremble amp grows with near²). Judge in /gallery.html?facility&live&x=5&z=-9. Minimap = client/ui/minimap.ts (per-level plan drawn once at 2px/unit, x2 pixelated, bottom right; crew dots, you + facing tick, lift car outline, reactor diamond blinking red until live, supply terminal/stations amber; no enemies). Next: tutorial/guidance discussion with the user.
- Second round (ADR-049): top door gets the same doorFrame as the bottom (main.ts/gallery.ts pass DOORWAYS.concat(TOP_DOOR)); crawler eyes = look.ts crawlerEyes() (HDR core + red bloom, brighter by distance to viewPoint, tremble), stepped in stepEnemies; FRIENDLY_FIRE=false in protocol.ts (server skips players in stepProjectiles).
- First round (user's list, 2026-10-21): endings, bullet impact, shop by the reactor, gore, rifle, difficulty², fallen-town surface, retro screen, spectate (was already built), heal = bandage, more UI text, pixel UI. All in ADR-044..048, marked "awaiting review". The open choice the user left: whether the lift works in the blackout (the agent picked no).
- Branch `surface` is merged into main; still present locally (ask before deleting).
- Commit finished+verified work without asking (CLAUDE.md). Never push unasked.

## Game (current)
- Persistent multiplayer PVE. Spawn in the surface garden -> one lift -> underground facility (corridor, lab, server hall, core). Surface = same coords +40 Z (LIFT_DZ); identical car at both ends.
- Lift (server/lift.ts, rules in shared/protocol.ts liftVerdict(player, lift, objective, phase)/obstaclesFor): E in car = send (15 s wait / 3 s if all aboard); E at door outside = call; empty car at bottom returns after 5 s. No firing in the car. Server `attemptLocked()` = active && phase !== "won".
- Attempt membership (ADR-038): below = in it. Death below = out (spectate teammate, CRT, click = next). Before reactor on you may ride up.
- Objective (ADR-040/044): E at reactor starts -> 10 s break -> waves. waveSize(w) = 6+3w+0.45w² (shared/enemies.ts), spawnInterval(w), enemySpeed(w). Wave cleared -> 30 s break; E at reactor in a break = send now. DefenceState.phase: spawning | break | won | blackout (+blackoutAt).
  - won (last wave cleared): lights full (client powerNow -> look.ts LightState power "full"), fallen revived to garden, rest evacuate by lift; tick calls resetAfterWin() once nobody is below (items/funds/gore/run reset).
  - blackout (reactor HP 0): lights/halos/reactor off, ambient 0.04; endless spawns blackoutSpawnInterval (600 ms -> x0.9 per 5 s -> 150); enemies hunt via Defence.hunt FlowField (goal = a living player, rebuilt 1 s); turrets off; lift locked; ends on wipe.
  - wipe (everyone below dead): ended() report -> bringUpAt = now + WIPE_HOLD_MS (4.5 s) -> everyoneUp(); client freezes view, fades black (.ui-wipe), fades in on garden.
  - Restart mid-ending: boot finishes it (won -> reset, blackout -> fail). db.loadDefence keeps won/blackout.
- Reports (StateMessage.reports, Report type): wave {size, clearMs, parMs, base, bonus, total}; attempt {outcome, reason, waves, blackoutMs, crew[name,kills,out]}. Client queueReport -> .ui-report panel (wave shows 3.5 s before an attempt report behind it).
- Quota/shop (ADR-041/046): shared `funds`. Wave pay = 15 + seconds under par (2.5 s/enemy). Shop = comms desk fixture "supplyTerminal" at (0,-16.8) north of reactor; corridor has the "vending" fixture back. E opens #shop panel; 1 turret 40 (cap 8, hands empty), 2 field dressing 20 (needs a wound). BuyMessage {item}. buyVerdict(item, player, {holding, wounds}, funds, turrets).
- Dressing: conn.bandaged = wounds at heal time, wounds -> 0; next hit sets wounds = bandaged (wire PlayerState.bandaged; dotted pip).
- Turret: BLOCKING_KINDS {box, turret}; fires 450 ms, range 7, real projectiles that skip players.
- Friendly fire: off (FRIENDLY_FIRE). Flip to true to bring back player hits (ShotHit "player" path still there). Verified by bot: off = 0 wounds, on = 3.
- Rifle: FIRE_COOLDOWN_MS 100, AIM_SPREAD 0.05 (+0.12 arm wound), decided client-side and sent as the aim. ENEMY_HIT_POINTS 5. PROJECTILE_SPEED 90. MAX_ENEMIES 50.
- Shots: ProjectileState.hit (wall|enemy|player); client stepTracers -> Impacts (client/world/gore.ts) sparks/splash at landing.
- Gore (ADR-045): GoreMark {n, kind blood|corpse, who player|enemy, x,z,r,size,color}; server leaveGore() on hits/deaths (facility only), saved in world key "gore", capGore (900/300), StateMessage.gore increments + goreReset for new clients/clean. Client Gore class: instanced blood decals, corpses = darkened live models (crawler on back, crew face-down). Colours BLOOD_HUMAN/BLOOD_CRAWLER in palette.ts.
- Identity (ADR-036): cookie UUID; codename = colour + id[0:4]. Second tab replaces first. Wounds/bandage/out carried across reconnect within an attempt.
- Logs: `[Codename] verb` via act(); refuse(); `[attempt N] wave K cleared...`, `... blackout`, `... failed/WON`, `crew evacuated`.
- Players: MAX_WOUNDS 3; grace 1 s. Death in garden = 3 s respawn.
- Look underground: OKLCH greyed gamut (blood exempt), emitters vivid; 8-light pool + headlamp; LOS mask; retro post (PIXEL_SCALE 0.25, grade.levels 12, scanlines, grain; ?pixel=0.x). Rules: docs/art-and-interaction.md.
- Surface (ADR-042/048, exempt from art rules): garden 34×24, chain-link FENCES, SURFACE_VIEW_MARGIN 16. Fallen town: surface.ts outsideRuins (roads, crane jib, cars, containers, pipes, pylon, building shells, rubble), ruinPillar = sheared concrete column, ruinLintel = cracked slab. Keep anything inside the fence under 0.95 half-height.
- UI (ADR-048): public/index.html "company terminal": VT323 (Google Fonts link), --ui #f2ead6, 2 px frames with stepped clip-path corners, segmented bars; client/ui/prompts.ts leader = pixel staircase.

## Key files
- shared/protocol.ts (contract, map, verdicts, Report, GoreMark, SHOP), shared/enemies.ts (waves, blackout, FlowField goal), shared/palette.ts
- server/index.ts (connections, tick, projectiles, shop, gore, endings), server/defence.ts (waves, won/blackout, hunt, turrets), server/db.ts
- client/main.ts, client/look.ts (LightState power), client/postprocess.ts (retro), client/world/gore.ts, client/world/surface.ts, client/models/facility.ts (supplyTerminal = comms desk)
- Tests: spec/*.test.ts (133). defence.test.ts covers won/blackout/hunt; lift.test.ts the won/blackout lift; economy.test.ts shop + dressing + gore caps.

## Next work (ordered)
1. Discuss tutorial + visual guidance with the user (ADR-050: nobody found the lift down, the reactor, or the supply terminal unprompted). Then user reviews in play: ADR-051 (flare look, minimap; crawlers on the minimap?), ADR-049 (eye glow strength: crawlerEyes numbers in look.ts; lift ride looks seamless now?) and ADR-044..048. Likely tuning: difficulty curve past wave 3 (untested by a human), blackout ramp, gore amount, retro strength (grade.ts levels/scanlines/grain; PIXEL_SCALE), VT323 size on small screens.
2. Open user decisions: teammate markers so friendly fire can come back (or leave it off); blackout lift (agent: locked); skip = anyone vs vote; shared vs per-player quota; extra score parts; turret cost/cap; WAVES_TO_WIN.
3. Shop has two lines; more buildables when the user picks them.
4. Still pending playtest from 2026-10-14: wound effects, CRT/daze strength, aggro 6, grace 1 s.
5. Lighting option C (overhead fixtures + halos). Garden tutorial gating. No sound. Second enemy type.
- Open user decisions (older): lift-return rule; overall grade/brightness; hall racks claustrophobic; hide /gallery.html in prod?
- Docs: README "good" section unfinished (user writes). Authorship rule: skeleton only unless user dictated.

## Verify recipes / gotchas
- Dev: `DB_PATH=/tmp/blendspitfire-dev.db pnpm dev` (8080, the user's). Client edits: rerun `node scripts/build-client.ts`. Server edits: restart.
- `pnpm check` against a throwaway server so 8080 is untouched: start `PORT=8090 DB_PATH=/tmp/check.db node server/index.ts` (no DEV_SPAWN), then `APP_URL=http://localhost:8090 pnpm check`.
- Dev env (local only, never in fly.toml): DEV_SPAWN/DEV_JOIN="x,z", DEV_WAVES=N, DEV_ARMED=1 (join with a rifle), DEV_REACTOR=0.02 (reactor HP at activation, reaches blackout fast). Reactor activation range 4.4 from (0,-11.5): DEV_JOIN=1.5,-7.6 is in range. Comms desk: DEV_JOIN=0,-15.2.
- Lift pop-in probe: expose `{scene,camera,THREE}` on window temporarily, raycast screen px via CDP Runtime.evaluate, list scene.children bounds; anything from another level overlapping a car is the culprit.
- Lift-car parity check: build the facility in Node and diff triangle centroids inside LIFT_CARS.bottom vs .top shifted by LIFT_DZ (was a scratch script; both cars must match per material).
- Seed quota: insert world row ("funds","100") before starting. Seed gore: world key "gore" (JSON GoreMark[]).
- Bots: ws client with cookie `playerId=<uuid>`; send {type:"activate"} twice (start + skip break); {type:"primary",x,z} at enemies to fight. Walking core -> corridor: the blast door at z=2 is sealed; go via the west passage (-12, z) and the lab.
- Browser: headless Chrome via CDP (--remote-debugging-port, --use-angle=metal). Kill it after (pkill -f user-data-dir=...) or it stays as a ghost player.
- Gallery: /gallery.html (model sheet), ?facility, &x=&z=, &live, &pixel=0, &nomask. Game URL flags: ?daze=, ?crt=, ?pixel=.
- Port 8080 may show a QQ process in lsof (unrelated). macOS sed has no \b or \|: use perl -pi.
- Node strip-only TS: no parameter properties.

## User prefs
- Chinese conversation. Chained doc requests: one step at a time, drafts in Chinese until approved.
- Fix bugs without trading away intended effects (e.g. keep shadows, move the light).
- Cost-conscious: cheap subagents for mechanical work; suggest fresh session over resuming long ones.
