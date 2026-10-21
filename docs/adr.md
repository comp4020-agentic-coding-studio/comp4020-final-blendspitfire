# Architecture decisions

> **AI-recorded.** This log is entered automatically by the coding agent (Claude Code), not written by hand. Decisions are discussed in conversation; the agent logs each one to a local draft (`.claude/notes/adr-draft.md`, not in git) and periodically translates and condenses the draft into this file. Rationale attributed to "the developer" is the developer's own stated reason, paraphrased.

Synced from the draft up to: 2026-10-21, second playtest: lift door frame, crawler eyes, friendly fire off

---

## ADR-001: Game or tool as the overall direction
*2026-10-06 · Status: Accepted*

**Context.** The final project requires multi-user, real-time and persistent behaviour, but leaves the application itself open.

**Options.**
- Game: multi-user and real-time come naturally. Edge cases (quitting mid-game, conflicting concurrent actions, repeated clicks) are harder to defend, and the marking criteria expect the app to withstand uses it was not designed for, so a pure game carries more risk there.
- Tool: multi-user and real-time have to be designed deliberately, which leaves more room to argue why a given sync mechanism was chosen. It can easily turn into a demo with no real use case.
**Decision.** Game (initial leaning).

**Why.** The developer chose it because games are more fun and have a higher ceiling than tools.

**Consequences.** Which game is still open. Defences against edge cases and misuse must be designed later; this is the known risk of the game route.

## ADR-002: No architectural cap on players per game
*2026-10-06 · Status: Accepted*

**Context.** The server (256MB, shared single core, one machine, one process) already limits how many can connect. The question was whether to also cap players per game in the architecture.

**Decision.** The architecture sets no per-game player limit (nothing like a hard-coded "max 4"). In principle 100 players in one game is allowed.

**Why.** The developer said game size is not a design focus at this stage. The server's physical limit already exists, so there is no need to add a stricter artificial cap as prevention. The two are separate things.

**Consequences.** The 256MB / 1 core limit remains the real ceiling; it just isn't expressed as a product decision. If large games are ever supported, state broadcast frequency and per-room memory use will hit that ceiling first.

## ADR-003: Game type is a light RPG
*2026-10-06 · Status: Accepted*

**Context.** After discussing candidates ordered from low to high technical risk, a concrete game type had to be chosen.

**Options.**
- Party quiz: lowest technical risk, naturally supports unlimited room size.
- Turn-based card/board game: low risk, but player count is naturally limited.
- Real-time drawing board: fun, but heavy real-time sync pressure.
- Light RPG.

**Decision.** Light RPG.

**Why.** Purely personal interest of the developer, not a technical-risk or marking trade-off.

**Consequences.** Open: which multiplayer real-time form (a shared world where players see each other move in real time, versus turn-based party combat with synced state) and how to cut the minimal scope for crit 8. The developer clarified that this is not a traditional system-heavy RPG (equipment, levelling, quest lines). The point is having a controllable character, which narrows the scope to "a player controls a character moving in a space": a shared space with a real-time controllable character, not an RPG stat system.

## ADR-004: 3D rather than 2D rendering
*2026-10-06 · Status: Accepted*

**Context.** With "shared space + controllable character" fixed, 2D versus 3D had to be decided.

**Options.**
- 2D: the agent initially suggested it because it has fewer technical hurdles.
- 3D.

**Decision.** 3D.

**Why.** The developer objected that the main problem with 2D is art assets: neither the developer nor the AI draws well, and AI-generated 2D assets are painful to adjust later (from past experience). In 3D, with a suitable engine and lighting, even the simplest geometry can look good. The agent agreed after reassessing: plain 2D shapes without lighting look like placeholders, while simple 3D shapes with light and shadow gain volume immediately. Rendering is purely client-side so it costs no server resources, and multiplayer position sync is about equally complex in 2D and 3D.

**Consequences.** The real risks (agreed) are camera control (free/orbit view costs far more than fixed top-down or fixed follow) and character collision/controller (complex terrain or physical bounce costs far more than flat ground with AABB collision). Scope for crit 8: simple-geometry character, one flat ground area, fixed top-down or fixed follow camera, basic lighting; no free camera, no complex physics.

## ADR-005: Tech stack: native TypeScript on Node, ws, node:sqlite, Three.js
*2026-10-06 · Status: Accepted*

**Context.** The developer left the framework choice entirely to the agent, with the only requirement that development stay consistent.

**Decision.**
- Runtime: Node 24 running TypeScript directly (no compile step), the same pattern `scripts/check-evidence.ts` in the template already uses. `mise.toml` already pins node and pnpm.
- Server: bare `node:http` plus `ws`, no framework. The surface is tiny (static files, one WS upgrade, one `/readme/` route), so a framework is not worth it and it saves memory.
- Persistence: `node:sqlite` (built into Node 24, no native addon to compile, simpler Docker build).
- Client: Three.js bundled with esbuild (esbuild is already an indirect dependency of vitest, so both share it).

**Why.** The developer had no particular preference and asked only for consistency: reuse the toolchain the template already set, and do not introduce a second one.

**Consequences.** Related decision: for README.md, PROCESS.md and the crit 8 reflection, the agent supplies only skeletons and bullet prompts and the developer writes the prose, because the course says heavily AI-flavoured prose in those files is judged "median output" and marked down. The developer confirmed this split before plan approval.

## ADR-006: Camera: perspective, straight top-down
*2026-10-06 · Status: Accepted*

**Context.** After settling on a 3D top-down view, orthographic versus perspective projection had to be chosen.

**Options.**
- Orthographic, straight down (first version built).
- Perspective, straight down.

**Decision.** `PerspectiveCamera`, still directly above the character and looking straight down (no tilt). The developer only wanted "orthographic" removed, not a return to the earlier angled follow camera.

**Why.** The developer gave no explanation, just the conclusion ("no orthographic, a normal projection with perspective is fine"); read as a plain visual preference.

## ADR-007: Placeholder gameplay: bouncing projectiles
*2026-10-06 · Status: Superseded by ADR-032*

**Context.** The build only had a movable, visible, persisted character. The developer wanted some basic gameplay rather than an empty shell.

**Decision.** Clicking fires a bouncing projectile (like a tank game). No room system (consistent with ADR-002, everyone shares one scene). Players respawn somewhere after death. No win/loss or score recorded yet. Simulation is server-authoritative: movement, bounce, TTL and hit detection run on the server, and the client only renders and sends a "fire" intent. It reuses the existing broadcast loop and obstacle collision data.

**Why.** The developer stressed this is still only a placeholder; the final product might have no PVP at all. PROCESS.md must say this clearly and not present "having projectiles" as the project's core gameplay.

## ADR-008: Aiming: mouse aim decoupled from movement
*2026-10-06 · Status: Accepted*

**Context.** The developer reported projectile motion was choppy and asked whether the mouse could be used to aim.

**Decision.** Decouple. Character facing always follows the mouse's projection point on the ground, and WASD only moves (the standard twin-stick shooter approach). The client uses a Raycaster to project screen coordinates onto the ground plane (y=0) to get the aim direction. The server's `rotation` field keeps its meaning (the angle used for fire direction), it is just now set by the mouse, so no server change was needed.

**Also fixed.** The choppiness: projectile broadcasts (~15Hz) were much slower than the render rate (60fps) and projectiles teleported to the latest position. They now interpolate like remote players, using a fixed-duration linear interpolation rather than exponential-decay lerp, because exponential decay gives a visible "can't catch up" lag on fast projectiles.

## ADR-009: Death: three-second respawn countdown and neutral projectiles
*2026-10-06 · Status: Accepted*

**Decision.**
1. After death the player stays frozen in place for 3 seconds (no movement or firing), then is teleported to a random spawn point, instead of the earlier instant respawn on being hit.
2. Projectiles no longer distinguish their shooter. Previously the shooter was excluded to avoid hitting yourself the moment you fire; the developer explicitly asked for "neutral", so a bullet that bounces back can hit its own shooter. The spawn forward offset (0.8) is larger than the hit radius (0.65), so firing normally never hurts yourself, only a bounced-back bullet does.

**Why.** The developer gave no reason; these were direct gameplay instructions.

## ADR-010: Leaderboard: in-room, temporary scores, not persisted
*2026-10-06 · Status: Accepted*

**Context.** After death was added, the developer wanted a light leaderboard on the left.

**Decision.** Count only players currently connected. A disconnect clears the score and a reconnect restarts from 0. Scores are in memory and not written to SQLite (unlike position, which must survive restarts). Rules: hitting another player gives +1 to the shooter; hitting yourself (a bullet that bounces round to the shooter) gives -1 to yourself.

**Why.** The developer gave the scoring rules directly with no further explanation.

## ADR-011: Fixes after the live multiplayer test (error messages, lag, reconnect)
*2026-10-07 · Status: Accepted*

**Context.** On crit 8 day a real multiplayer test showed that (1) the game would not open in Chrome on some people's computers (it worked for others), and (2) play felt laggy outside a local network. The fixes target crit 9.

**Problem 1: analysis.** The code has no Chrome-specific logic. "Works on some machines, independent of browser vendor" points to two existing silent-failure points. `WebGLRenderer` throws when no WebGL context is available (hardware acceleration disabled on managed devices, remote desktop without GPU passthrough), killing the script and leaving a blank page. If a campus or corporate proxy blocks the WebSocket handshake (HTTPS only, blocking the upgrade), the 3D scene renders but the welcome message never arrives and nothing happens. Neither is an environment problem the client code can fix, but there was no visible message at all. **Decision:** add visible error messages for both cases, turning "won't open for no reason" into "this is the cause".

**Problem 2: three fixes.**
1. Own shots had no local prediction, so a click waited a full server round trip before the bullet appeared, the most obvious source of laggy feel on a real network. Add local prediction: a click immediately spawns a local bullet using the same physics parameters. It is removed once the real bullet shows up in a server broadcast (matched by `ownerId`, FIFO against a local pending queue), or by a safety timeout if no match arrives.
2. Projectile interpolation assumed broadcasts arrive exactly every 66ms and stalled until the next one. Real networks jitter, so late updates caused "stutter then jump to catch up". Change it to the same "faster the further away" continuous easing as remote players, making no assumption about arrival interval, at a slightly higher rate.
3. WebSocket disconnects were never reconnected. This matters more than it looks, because Fly's `auto_stop_machines` stops the machine when idle and kills open WS connections, which until now was permanent until a page refresh. Add a reconnect loop with backoff.

**Out of scope.** Real server-side lag compensation (rewinding world state to the shooter's perceived time, as in Source/Overwatch) and moving from WebSocket/TCP to a UDP-based transport (WebRTC). Both are large architecture changes that are not worth it for placeholder combat. They are recorded in PROCESS.md under "what's first-draft" as known, accepted limitations.

**Why.** The developer hit these problems in real multiplayer testing and asked for the approach mainstream multiplayer games use (mentioning lag compensation and local computation), but did not ask for full server-side rollback compensation.

## ADR-012: Gameplay rework: unified "pickup object" system
*2026-10-08 · Status: Accepted*

**Context.** The developer found "click to fire" too crude and wanted an equipment-like setup.

**Decision.** (Developer's concept, paraphrased.) Players start empty-handed and pick objects up with left click. All pickups are the same kind of thing, each with a primary action and possibly a secondary action. An "equipment slot" is only a concept and is not shown in the UI. Two initial objects:
- Weapon (gun): primary action is shooting, keeping the bouncing bullets (the developer chose to keep ranged shooting over melee or a non-damaging effect), but a gun must be picked up first; no secondary action.
- Crate: primary action is placing, at the mouse target, with a distance limit and a translucent preview (the developer's pick of the recommended option); secondary action toggles grid snapping. A placed crate is an obstacle that blocks both players and bullets.

**Input.** Many people use Mac trackpads, where right click (two-finger tap or ctrl+click) feels very different from a mouse. The secondary action can be triggered by right click or the E key, fully equivalent (the developer chose the recommended option). All operations avoid hold and drag (tiring on a trackpad); grid snapping is a toggle, not hold-to-apply.

**Persistence.** The developer said object state should be persisted in future but not now because too much is still variable. In this version objects live in memory only and a server restart returns them to the initial layout.

**Agent defaults (told to the developer, who did not object).** Only one item can be held at a time. While holding something, left click is always the primary action, and switching requires pressing Q to drop. Items cannot be taken from other players. Death or disconnect while holding drops the item in place. The 4 original fixed obstacles stay as terrain.

## ADR-013: Low poly art system, interaction conventions, and tutorial yard
*2026-10-08 · Status: Superseded by ADR-017 (art reference); remainder in force*

**Context.** A large update covering art direction, interaction conventions and onboarding.

**Art direction.** The developer chose low poly, taking the colour scheme of Firewatch only as inspiration, but required a systematic, consistent palette and that every model be something the AI can reliably build in code. Face counts, detail and palette rules were left to the agent, which researched second-hand write-ups of the Firewatch GDC talk, Synty/Kenney-style practice and low poly face-count guides.
- Trade-off: under a straight-down camera, Firewatch-style distance-based fog does not work (every ground point is roughly the same distance from the camera and the whole screen would wash out evenly), so depth comes from light/dark layering and shadows instead.
- Detail floor (developer's words, paraphrased): "at least you can roughly tell what the thing is". For example a gun modelled on the M4A1 should be recognisable by its features. Generated models go to the developer for acceptance.
- Models are designed for a top-down view. The developer noted the gun from above was just a black stick and suggested laying it on its side. Decision: the gun lies on its side on the ground, and when held also turns sideways so the silhouette shows from above (this was pending acceptance; see ADR-014).

**Interaction conventions (developer's request).** Interactable objects need obvious feedback (hover glow etc.), otherwise players do not know they can be clicked. E as the secondary key occupies the left hand that is moving, so it is hard to use. The developer asked the agent, while implementing, to "think harder about whether anything almost common-sense is missing". Secondary keyboard key changed from E to Space (the left thumb is free when using WASD); right click, two-finger tap and ctrl+click stay.

**Where the rules live.** The developer chose a separate document, `docs/art-and-interaction.md`, with one line referencing it in CLAUDE.md to keep CLAUDE.md lean.

**Tutorial yard.**
- Form: an enclosed area inside the shared world (the developer's pick of the recommended option), not a private instance per player, so no "room" concept is needed in the architecture. No firing inside it.
- Spawn rule: the developer chose "all spawns and respawns are in the yard" (the recommended option was "first time only", which was not picked). Consequence told to the developer: the saved player position is no longer used for spawning, so the "persistence" hard requirement is temporarily just identity and colour, and object persistence needs scheduling early.
- Guidance form (developer's words, paraphrased): they like key bindings written directly on the floor, for example a mouse-click icon on the floor next to a pickup.

## ADR-014: Corrections after first model review
*2026-10-08 · Status: Accepted*

**Decision.**
- Held weapon: the previous version also turned the held gun 90 degrees so its outline showed from above. The developer rejected this: "the gun lies flat on the ground, but in the hand it still has to be held upright. That's exactly the common-sense issue I meant." Only objects lying on the ground are laid flat for the top-down view. Held objects always use a realistic grip (rifle upright, top facing up), even though less is visible from above. This is written into the rules document.
- Character: the developer said the first top-down character "looks a lot like a Middle Eastern headscarf" and asked to avoid that, and to look more casual overall. A round helmet, a light hexagonal shoulder ring outside the head, and a dark visor band across the front combined into a headscarf shape from straight above. It was changed to a baseball cap, T-shirt, jeans and white sneakers, removing the helmet, shoulder pads, visor band and backpack. Facing is now indicated by the cap brim and the forward-reaching hand. A rule was added to the rules document: do not accidentally produce clothing silhouettes with specific cultural meaning.
- The developer accepted the model fidelity and the colour tone.

## ADR-015: Details fixed while implementing steps 3 and 4 (common-sense checklist)
*2026-10-08 · Status: Accepted*

**Context.** Decisions made by the agent during implementation and told to the developer.

**Decision.**
- Map: arena ±18 plus a 14×9.4 yard on the south side (bottom of the screen), with a 4-wide gate in the middle of the arena's south wall. The previously invisible boundary became a visible low stone wall ("no invisible walls").
- No-build zones: the gate and the spawn strip, otherwise someone could block the yard gate with crates or spawn inside a crate.
- No firing in the yard: the server ignores fire inside the yard, and bullets shot into the gate from the arena vanish at the yard line.
- Fire-rate cooldown of 250ms (previously as fast as you could click).
- Station restocking: a station item taken is replaced after 3 seconds, with a world-wide cap per kind (guns 12, crates 30) to prevent emptying or flooding.
- Player colour: assigned from the 6-colour palette, picking the one used by the fewest online players, to avoid duplicates. Old saved random hsl colours are replaced on load.
- The server rejects position reports outside the arena, yard and gate (walls stop walking but not a client simply reporting a coordinate outside the wall).
- Interaction feedback: hovering a reachable pickup gives a pulsing accent outline, a ground ring, a hand cursor and "click to pick up"; out of reach gives a dim outline and "move closer"; holding a gun shows a crosshair cursor and, in the yard, "no firing in the yard"; a failed crate placement shakes the preview and states the reason (too far / blocked / no building here); with grid snap on, grid lines show around the preview; key state is cleared when the window loses focus (otherwise the character keeps walking on return).

## ADR-016: Final form: shared building sandbox
*2026-10-12 · Status: Accepted (direction fixed, gameplay not yet decided)*

**Context.** Before crit 9: what is the project ultimately? The brief's persistence acceptance is "come back the next day and what two people did is still there". A pure PVP match leaves only a record of results, a weak persistence argument, while actions that change the world are naturally persistent.

**Options.**
- A: shared building sandbox
- B: deepen the existing arena
- C: cooperative unlocking
- D: territory control

**Decision.** The developer chose the shared building sandbox as the final target.

**Why.** Persistence argument, as above. The developer named the difficulty themselves: they have not yet found gameplay rich enough to carry it.

**Consequences.** The developer's initial idea is a Rust-like multiplayer sandbox PVP running weeks to months with a "base" feel; not finalised, scale, offline protection and wipe cycle still to discuss. Added the same day: the scale is a "shrunken, lightweight Rust", not Rust-sized. The developer judged offline raiding and overnight map destruction not a big problem: it is an advanced-gameplay issue the assignment does not much examine, to be controlled with measures like resource limits when needed, and no separate offline protection mechanism will be built.

## ADR-017: Art upgrade: keep low poly, finer detail, tone referenced to Arc Raiders
*2026-10-12 · Status: Superseded by ADR-020*

**Context.** The earlier minimal low poly was for technical validation. With the sandbox direction set, a better stylised look was wanted.

**Decision.** Low poly stays, with a bit more detail. Style and tone (especially tone) refer to Arc Raiders concept art and in-game footage, replacing the earlier Firewatch reference. The developer said to leave the docs for now and keep developing steadily.
- Detail means more modelled detail and post-processing (AO, outline, grading, glow), both, but performance must be respected, using cheap tricks and referring to well-optimised examples.
- Scope: all existing models are rebuilt, with subject matter also moved toward Arc Raiders (the agent read "对" as both, and told the developer).
- The developer approved the full proposal: signal colours become cyan = interactable and red = not allowed, with orange given to player equipment; personal player colours use saturated 80s colours; rendering follows "bake whatever can be baked" (vertex AO, in-material grading, CSS vignette, outlines only on hero objects, halo sprites instead of bloom), with true post-processing as an optional high-quality tier later; proceed in four steps with acceptance at each.

## ADR-018: First tone review: not bright or artistic enough
*2026-10-13 · Status: Superseded by ADR-019*

**Context.** Developer feedback on the first Arc-referenced pass: the problem is partly the object colours and partly the tone.

**Decision.** Target feel (developer's words, paraphrased): highly saturated, overall very bright, yet soft; they think it comes from "some very vivid colours plus some premium greys", and could not tell lighting from material, only describing the final colour impression. Make it more artistic with more aggressive parameters, referring to Arc's concept art rather than in-game screenshots; at most one or two in-game shots, focusing on the "Spaceport" map. Also try a batch of new objects.

## ADR-019: Stylisation still insufficient: colour cards first, then Buckshot Roulette
*2026-10-13 · Status: Superseded by ADR-020*

**Context.** The second round (bright Spaceport) was still "not stylised enough" to the developer.

**Decision.** Five flat colour cards were requested first (Spaceport noon, golden hour, coastal foggy morning, 80s synth, brutalist pastel); none was picked. The developer then asked for a card in the style of Buckshot Roulette, ideally from a breakdown of that game's art, and set the Arc style aside for now.

## ADR-020: Style direction moves to NASA-punk; art becomes the main investment
*2026-10-13 · Status: Accepted (the NASA-punk direction was shelved in ADR-024; art as the main investment stands)*

**Context.** After the Buckshot Roulette card and reference images, the developer said it was still not stylised enough.

**Decision.** New reference: NASA-punk colours, with more spacecraft, instruments and white equipment in scenes. The agent was to research NASA-punk (palette, reference images) first, then propose.

**Why.** The developer's key decision: because gameplay code builds fast and is cheap to change, **art style is the part most worth investing effort in**, and this sets the priority for how remaining time is spent.

**Consequences.** Changing style may require adjusting gameplay; the developer considers this minor and not a current blocker.

## ADR-021: NASA-punk tone: realistic nostalgia, modern colour handling
*2026-10-13 · Status: Shelved by ADR-024 (not rejected)*

**Context.** Between a more dramatic "punk" reading and a more realistic one.

**Decision.** The developer first chose "more punk and dramatic", then corrected themselves: "I misread, it's actually the former". The result is a fairly realistic NASA nostalgia (off-white, matte aluminium grey, warm brown, restrained brand-colour accents), not a dramatic route with heavy accent colours and high contrast. Additional requirement: overall colour handling should be "a bit modern", not a yellowed, aged archive photo. Neutrals clean, accents clearer and more vivid instead of retro, faded matte colours. The developer added the game "封锁协议" (LOCKDOWN Protocol) as a reference for modernised NASA-punk colour.

## ADR-022: Added reference: LOCKDOWN Protocol
*2026-10-13 · Status: Accepted*

**Context.** Resolving the tension between nostalgia and modernity in ADR-021.

**Decision.** Confirmed as a space-station social-deduction game by the French indie studio Mirage Creative Lab (Steam appid 2780980). Art reading: modern, clean stylised low poly; white/light-grey base materials, whole-block saturated colour by zone (greenhouse green, medical teal), orange spacesuits as accent; no ageing or rust. Use it as the reference for "NASA-punk content, modern execution": neutrals clean and bright rather than yellowed matte, accents pure and vivid rather than retro matte. The agent produced a combined palette card, `.claude/look/nasapunk-modern-card.png` (off-white / light grey / charcoal neutrals plus international orange, turquoise, cyan, red, amber and navy accents), pending the developer's acceptance.

## ADR-023: Third palette: NASA-punk content, modern execution
*2026-10-13 · Status: Superseded by ADR-031 (surface colours)*

**Context.** Applying ADR-021 and ADR-022 in code.

**Decision.** All of `shared/palette.ts` rewritten: cool white and light grey neutrals (warm brown and yellowing removed), GEAR dark grey-black, CLOTH becomes grey flight suit plus white shoes; PAINT_ORANGE/TEAL/CREAM/BLUE purified and brightened, PAINT_GREEN added; sky light changed to blue-white, FAR/OUTLINE to dark grey-black, ACCENT to a brighter, more "screen-like" cyan. Grade strength reduced from 1.15 to 1.05 because the developer wanted "modern", not over-stylised saturation.

**Consequences.** Outputs: `.claude/look/compare-nasapunk-modern.png` (original / Arc bright / NASA-punk modern), `diorama-nasapunk-modern.png`, `game-nasapunk-modern.png`. `pnpm check` was green, code not committed. The developer asked to keep the earlier references and colour cards and not delete them, since other directions may be tried.

## ADR-024: Shelve NASA-punk; reference the Escape from Tarkov "Labs" map
*2026-10-13 · Status: Accepted*

**Context.** The developer said "fine for now" to the NASA-punk modern version (not rejected, not confirmed as final) and wanted to try a new direction.

**Decision.** New reference: the realistic lighting and atmosphere of Escape from Tarkov, focused on the Labs map. Method requirement from the developer: do not just take colour values from screenshots, since Tarkov's colours are ordinary realistic colours. The real difference is the lighting logic (light sources, contrast, atmosphere), and the agent should reconstruct the whole logic by observation and reasoning rather than assembling a colour card. The developer also wants to try a pixelation post-process to imitate a retro look, with the side benefit of hiding low poly flaws (seams, aliasing, AO blockiness). Priority restated: look at picture, colour and lighting first; earlier gameplay changes are not handled for now.

## ADR-025: New gameplay idea: cooperative PVE assault with persistent defences
*2026-10-13 · Status: Proposed*

**Context.** A gameplay concept recorded for later; not to be implemented yet. The developer described it as only a rough feedback loop, not a settled design.

**Idea.** There is a hard-to-reach objective (like a zombie-horde defence), and a single attempt will probably fail. The map is persistent: when players fail a round, the defences and other things they built survive the enemy rather than being wiped, so with enough attempts one eventually breaks through. After a breakthrough the server may be reset, or an arcade-style scoreboard may record players' contribution or scores across runs.

**Consequences.** If it holds, the persistence acceptance shifts from "the base itself" to "defences accumulated across attempts plus scoreboard history", adding to the pure building sandbox a narrative that rounds are played and lost but the world remembers your contribution.

## ADR-026: Tarkov lighting logic applied (two iterations)
*2026-10-13 · Status: Accepted*

**Decision.** The "paint" part of the palette stays as the NASA-punk / LOCKDOWN Protocol version. Only lighting and materials change: SUN / HEMI_SKY / HEMI_GROUND / GRADE_SHADE / GRADE_LIGHT all turned cool (previously warm sun and purple shadows). New `tileMaterial` (low-roughness floor, soft tile-like sheen) and `glossyMaterial` (stronger reflection for metal parts such as guns), giving matte / tile / glossy states.

**Iterations.** Round 1: floor highlights too large, mirror-like, overall dark and muffled. The developer wanted to "learn the lighting logic", not copy the gloom. Round 2: split tile (roughness 0.55) from glossy (roughness 0.3), raised ambient intensity from 2.4 to 2.7, brightened HEMI_GROUND and GRADE_SHADE, removed the mirror look while keeping the cool tone and shadows that read blue-grey rather than black.

**Consequences.** Outputs: `.claude/look/compare-tarkov-light-v1-v2.png` (NASA-punk / Tarkov v1 too dark / Tarkov v2 corrected) and `game/diorama-tarkov-light-v2.png`. `pnpm check` green, not committed. Next: pixelation post-process, screenshotted separately from the lighting changes.

## ADR-027: Pixelation post-process: black-screen bug and fix
*2026-10-13 · Status: Accepted*

**Context.** After implementation, the main game view and the diorama both rendered pure black while the HUD (DOM) still showed, pointing to the WebGL pipeline.

**Cause.** The dither lookup used GLSL `float[16](...)` array-constructor syntax, which is legal only in GLSL ES 3.00 (WebGL2, `#version 300 es`). `RawShaderMaterial` had no `glslVersion`, so it compiled as ES 1.00 and the fragment shader failed silently.

**Decision.** Rewrite `bayer()` as an if-chain with no arrays, compatible with ES 1.00 (keeping WebGL1 compatibility).

**Consequences.** Gotcha found: `pnpm dev` runs `scripts/build-client.ts` only once at startup and does not watch files, so client code changes need a manual rebuild or screenshots and tests see the old bundle. Verified: typecheck clean, new screenshots show output with pixel blocks and dither. PIXEL_SCALE (0.42) and ditherAmount (0.02) have not yet been accepted by the developer.

## ADR-028: Indoor space: underground-facility motif for the PVE gameplay
*2026-10-13 · Status: Accepted*

**Context.** The developer asked first to rebuild a rough indoor space, without fixing specific mechanics, to serve the PVE assault and persistent defences idea (ADR-025). Lighting and colour are explicitly set aside; the focus is the elements. The developer had no ideas and asked the agent to brainstorm.

**Options (motifs offered by the agent).**
- Underground command / lab bunker (default recommendation, continues the launch-site background story)
- Data centre / server farm
- Missile silo (vertical structure)
- Isolation / containment facility
- Underground car park

**Agent's generic element list** (needed whatever the motif):
1. Several breach points / enemy entry points (vents, collapsed wall, flooded stairwell, stuck elevator shaft); horde gameplay needs more than one door.
2. A core objective room (reactor / mainframe / beacon / cage, not yet decided).
3. Bottleneck corridors (natural fortification points).
4. Large rooms / risk areas (racks, desks, shelves as cover, complex sight lines, contrasting the bottlenecks).
5. Vertical structure (catwalks, stairs, maintenance ladders) for tactical layers and high ground for ranged weapons.
6. A safe room / spawn the horde cannot enter, also a preparation area.
7. Sealable structures (doors / gates that physically close) so players can change routes.
8. Persistent traces (burn marks, bent metal, half-destroyed fortifications, stains from the previous failed round), echoing the persistent map.
9. Environmental storytelling props (abandoned desks, lockers, terminals, signs).
10. Reuse existing props (crate / supplyCase / jerseyBarrier moved indoors from the outdoor launch-site style).

Suggested minimal topology: safe room, one main corridor (bottleneck), a fork into 2-3 rooms (at least one with a vent breach), converging on a central objective room (which has its own breach, giving a flanking route).

**Decision.** The developer adopted the whole proposal (default motif plus the full element list) without picking or rejecting any item. They added two choices the same day: spatial relation "replace the arena, keep the yard" (the yard teaching area is not torn down, spawn and tutorial logic untouched); scale "minimal topology", to validate the sense of space first without overreaching.

**Consequences.** Next step: build a very simple greybox indoor scene reusing existing wall/crate modelling, with lighting and colour still deferred.

## ADR-029: Indoor greybox details set by the agent
*2026-10-13 · Status: Proposed (awaiting developer acceptance)*

**Decision.**
- Topology: yard, main corridor, west lab / east server room, a narrow passage from each, north core room. The core can be entered from both sides (flanking).
- The corridor's direct route to the core is blocked by a sealed blast door, with a short dead-end airlock behind it, leaving a place for "sealable structures" later; for now it is a fixed obstacle.
- Three breach points: vent in the lab's west wall, collapsed gap in the server room's east wall, stuck elevator shaft in the core's north wall. For now they are scenery only (player movement is confined inside the facility). There are no no-build zones around them, since "blocking the breaches" is intended future gameplay.
- Crates are allowed at all doorways inside the facility (holding the bottleneck is the point of this space). Only the yard gate and the spawn strip stay no-build.
- Interior walls are taller than the yard's low wall (2.5 vs 0.8) so the interior blocks sight. Solid areas between rooms are drawn as dark blocks, so from above the rooms look carved out of solid mass.
- Walls use a new interior wall panel model (light panel, light top, dark skirting, pilasters); the yard keeps its stone wall; supplyCase and jerseyBarrier are reused indoors.
- Vertical structure not built: with a straight-down camera, upper and lower floors are nearly unreadable; deferred.

## ADR-030: Greybox first-round feedback
*2026-10-13 · Status: Accepted*

**Context.** Developer review of the indoor greybox, four points plus extras.

**Colour.** Overall tone "feels wrong".
- The scene needs light sources, not necessarily computed in real time, left to the agent to decide on performance.
- Objects still carry the vivid NASA-punk colours, which is unnecessary. Only indicator lights and the like should be vivid. Everything else should be greyer and as realistic as possible.
- But "more colour": not more vivid, but more varied in hue, all inside one colour system. The developer's example (paraphrased): even a red wall, in this rendering environment, would look grey-red or dark red.
- Method: this time do not reference any actual game. Reference colour-system and atmosphere knowledge and good industry colour principles; the developer considers "referring to good industry colour principles" the most important thing.

**Scene.** The layout is fine; the agent may continue to a more detailed scene with a stronger sense of a "facility", free to elaborate.

**Display.**
- The camera is a bit high and should come a little closer.
- A horror-game feel: add visual blind spots, with places that cannot be seen in black.
- Walls: the setting is an underground facility, so only wall sides are visible and wall tops are blind spots (black).

**Gameplay.**
- A separate tutorial room, with **one-way** entry to the map. The form depends on setting/worldbuilding and is not to be decided yet.
- Core gameplay confirmed as "protect something": activate it first, then defend.

**Extras.**
- Model detail could rise a bit (the developer was unsure whether the current result is final).
- Wants a proper asset management process, with textures and tone adjustable separately (decoupled from model code).
- Noted but not to be done yet: if the next tone round is still unsatisfactory, an admin-style UI with sliders to adjust hue, saturation, greyness and contrast like photo editing may be needed.

## ADR-031: Facility round 2: OKLCH colour system, zone lighting, line-of-sight blackout
*2026-10-14 · Status: Proposed (awaiting developer acceptance)*

**Context.** Agent decisions made while implementing the feedback in ADR-030, following the developer's rule to use colour theory and industry principles only, no games as reference.

**Decision.**
- Colour system: all surface colours sit in one OKLCH gamut (chroma at most 0.06, about Munsell 2-3; lightness matching real albedo, sRGB about 45-200). Each hue gets a set of three tones varying only in lightness; neutrals share one cool-grey "parent" tint. Basis: Gurney gamut masking, PBR albedo ranges, the Pointer gamut (real surfaces cannot be highly saturated).
- Only emissive things (lamps, indicator lights, screens, reactor, player shoulder lamp) may leave the gamut.
- Hue variety comes mainly from light, not paint: each zone gets a dominant colour temperature (tutorial room tungsten warm; corridor and lab cool fluorescent; server room cool LED; core sodium warm orange against cool tubes). White balance is set at 4500K, otherwise 4000K fluorescents look orange.
- Lighting performance: no baking (floor vertices too sparse, and moving objects would not be lit). A fixed pool of 8 point lights follows the nearest fixtures the player can see, with no shadows; only the player's flashlight casts shadows. Fixtures have emissive parts so lamps outside the pool still read as lamps.
- Grading moved out of materials into one object in `client/assets/grade.ts`, applied by a single full-screen post-process. This is what the future slider admin UI would bind to.
- Visibility: a 2D line-of-sight polygon plus depth reconstruction of world position; unseen areas are pure black; anything above wall height is black; only furniture taller than a person blocks sight (racks, cabinets, pillars), low things can be seen over.
- Camera height 22 to 16.
- Asset pipeline: every model is registered in `client/models/registry.ts`; the model sheet is generated from it; `spec/assets.test.ts` checks triangle budget and gamut and is part of `pnpm check`.
- Player: clothes become a low-saturation version of the player colour, with a lamp in the player colour on the shoulder (the developer's pick of the recommended option).
- Tutorial room: the yard becomes an indoor room; the one-way door is enforced by the server (no returning once through; death and respawn reset it); the concrete form awaits worldbuilding.
- Reactor activation: empty-handed, click within range. After activation the whole map's emergency lights flash, the core turns blue, and a "defend" banner shows; no enemies yet; resets when the server is empty.
- The original launch-site props (`props.ts`) were never committed and were moved to `.claude/attic/` rather than deleted.

## ADR-032: Design decisions made during autonomous development
*2026-10-14 · Status: Proposed (made while the developer was away, awaiting acceptance)*

**Decision.**
- Projectiles: non-bouncing, high-speed straight shots (the developer's specification), 45 u/s. On firing, a ray cast against walls, crates and the map edge gives the range, and each tick only that segment is swept for hits on players or enemies, so shots cannot pass through walls. Broadcast once (origin, direction, time, range); the client draws the tracer from a shared server clock. This replaces the bouncing projectile of ADR-007.
- Smoother multiplayer: other players and enemies use snapshot interpolation (2 broadcast intervals behind, about 100ms) instead of "chase the latest position"; broadcast rate 15 to 20 Hz; items sent only when changed (22 to 7 KB/s per client).
- Persistence: items, reactor and defence state saved to SQLite, flushed on SIGINT/SIGTERM. The reactor no longer resets when everyone leaves ("progress carried across rounds" is the loop itself).
- Defence: 10s preparation after activation, then enemies enter in waves from the three breaches. Flow-field pathfinding (crates count as walls so they reroute; if fully blocked they gnaw crates, 6 hits to break through); they attack the reactor and players in their way; three shots kill one; reactor health at zero means the round is lost and the reactor goes dark, but what was built stays. Values are in `shared/enemies.ts`.
- Reactor collision shrunk to the central cylinder (the base is only knee-high, so people can stand at the edge to defend and fire).
- Security: a single client could crash the server (non-object JSON and oversized frames both did). Added a 4KB message limit, a rate limit of 60 messages per second, and a movement speed cap (anti-teleport).

## ADR-033: Flashlight shadows: headlamp on the cap brim
*2026-10-14 · Status: Accepted*

**Context.** The light source was at the character's chest (height 1.5), so the cap brim cast a large trapezoid shadow and the held gun cast a second one.

**Options.**
- First version: the player and held items cast no shadow.
- Light from a higher position.

**Decision.** The first version was rejected by the developer: "shadows are fine, they add presence, but put them in a realistic place, like overhead." Adopted: move the light to the front edge of the cap brim as a headlamp (`HEADLAMP` in `look.ts`), keep the player's own shadow, with the hands and gun below and in front of the light so projected shadows look realistic.

## ADR-034: Ceiling lamps visible in the top-down view
*2026-10-14 · Status: Accepted*

**Context.** The camera looks straight down through the ceiling, so ceiling fixtures and their halos floated over players' heads. The developer did not want to simply delete them and liked the lighting.

**Options.**
- A: keep the overhead light but do not draw the fixture (a floor pool instead)
- B: move lamps to the walls
- C: fade fixtures near the player
- D: only drop halos and shrink fixtures

**Decision.** A and B combined (the developer's call). Narrow rooms and room edges get wall lamps; lights in the middle of rooms stay overhead with no visible fixture and a faint floor pool as the halo. The intake room got an extra overhead fill bulb.

**Why.** It keeps the lighting look. Walls are in view, so wall lamps read as real. The ceiling is implicitly above the camera's cut, the same logic as the black wall tops.

## ADR-035: Autonomous round: full-auto, wounds, enemy targeting, permadeath with spectating
*2026-10-14 · Status: Proposed (built; awaiting the developer's playtest)*

**Context.** The developer listed future directions (lighting option C, a full-auto rifle, smarter enemy AI, simple wounds, permadeath with spectating, a resource loop, a tutorial prep room), then left the agent alone for about an hour to choose its own work, with the instruction to leave anything it was very unsure about.

**Options.** The agent took the items that complete existing mechanics and need little aesthetic judgement. It left lighting C and the "fewer, wider lamps" change (art judgement), the resource loop (a large design question), and the prep room (the developer said it comes last).

**Decision.** The parameters and effects below are the agent's choices, not the developer's:
- Full-auto: a click fires one shot and holding fires at the gun's rate. Holding is only a bonus, so the "no hold-to-act" trackpad rule holds. Rate of fire went from 250 ms to 150 ms.
- Wounds: three wounds, and the fourth hit kills. In order: slower movement (×0.75), a dazed blur with a red edge, then a shaking aim (±0.12 rad). This order was chosen from the developer's examples. There is a 1 s grace between hits so a pack can't chain-kill. The aim shake is applied client-side and trusted, since the game is co-op and this keeps the shot prediction exact.
- Enemy targeting: an enemy chases a player it can see and walk straight to within 6 units. It gives up beyond 10 units, searches the last sighting for 2 s, then returns to the reactor. Once within 2.5 units of the reactor it stays on it. There is no pathing around corners to reach players yet.
- Permadeath applies only while the reactor is live. Deaths while roaming freely still respawn after 3 s. The attempt is wiped only when every player who went through the gate is out, and a wipe takes the same failure path as the reactor being destroyed.
- Spectating is through a living teammate's eyes (their camera, torch and line of sight), on an old-CRT post effect. A click switches to the next teammate.
- Chewed boxes show their wear: they shudder at each bite, slump as wear builds, and leave dust when they break.

**Consequences.** All of these numbers need tuning through play. Known gap: a player who is out and reconnects comes back fresh.

## ADR-036: Who's who, what each player may change, and the action log
*2026-10-19 · Status: Accepted (codenames and shared boxes chosen by the developer; the rest built by the agent, to be playtested)*

**Context.** The final project must tell two or more people apart, check on the server what each may see and change, and log who did what. Crit 10 rehearses this: two classmates play from the URL alone, in separate Chrome profiles, while the developer narrates from `flyctl logs`.

**Options.**
- Identity: typed names (needs moderation, an extra step before playing) vs an automatic codename.
- Boxes: owned by whoever placed them vs shared by everyone.

**Decision.**
- **Identity.** Each browser gets a random id from a cookie the server sets on the first connection; nothing the client sends can change it. Each player is shown everywhere, on screen and in the log, as a codename: their colour plus the first four characters of the id (e.g. `Orange-3f2a`). This was the developer's pick over typed names. The same browser in a second tab is the same person: the newer tab takes over, and the older one is closed and doesn't reconnect, so one person never has two bodies.
- **What each player may change**, all enforced by the server:
  - Everyone sees everything. It's one shared facility, played co-operatively.
  - Shared: loose items and placed boxes. Anyone may pick up a box anyone placed. This was the developer's call: co-op, with resources shared.
  - Shared: the reactor switch.
  - Personal: what you're holding. Nobody can take it from you.
  - Personal: your own body (position, wounds, being out). Movement is checked for speed, walls and the one-way gate.
  - Wounds and being out belong to the attempt, not the connection, so leaving and coming back doesn't heal you or bring you back in.
- **The log.** Every line starts with who did it: `[Codename] picked up box 3f2a1c at (4.0, 16.8)`.
  - Logged actions: joins and leaves, the gate, pickups, drops and placements, switching the reactor on, wounds and deaths (and by whom), and a summary of shots every 5 s.
  - Refused actions are logged too, because they are the server holding the line. Examples: taking an item from someone else's hands, moving through a wall, firing in the safe room. These are capped at one line per kind every 3 s per player, so a hostile client can't bury the log.
  - Attempts get their own lines: `[attempt 3] failed: the reactor is down, charge 41% (crew: …)`.

**Why.** Codenames make the log readable next to the screen without any sign-in step: the crit's rule is "anything they need to get in has to be on the page". Boxes are shared because the game is co-op, and private boxes would make the defences belong to whoever happened to build them. Personal state is the part another player could grief, so that is where the server draws its lines.

## ADR-037: The objective is a charge bar; a run takes a dozen attempts; an arcade board remembers it
*2026-10-19 · Status: Accepted (direction and numbers 1-3 from the developer; scaling numbers chosen by the agent, untuned)*

**Context.** ADR-025's loop was: a hard objective, attempts that mostly fail, defences that carry over between attempts, then a breakthrough. Until now there was no way to win: waves just kept coming.

**Decision.**
- The developer's direction:
  - Once switched on, the reactor charges. **Full charge, after 6 minutes, completes the objective.**
  - The attack grows as the charge climbs, so late in the charge there are more and more enemies.
  - The reactor being destroyed (or everyone being out) only fails that attempt. The charge then starts again from zero, and the boxes stay.
  - A full run should take about ten or more attempts.
  - The box cap goes from 30 to 60, so defences keep growing over more attempts. This stands in until a resource loop exists.
  - A persistent arcade scoreboard (the ADR-025 idea).
- The agent's numbers, to be tuned by play:
  - Each wave holds `4 + 22 × charge` enemies.
  - Waves start every 15 s at the beginning, shrinking to every 4 s at full charge.
  - Waves come on the clock rather than waiting for the last one to be cleared, so late waves overlap.
  - The 40-enemy cap stays, since the 256 MB machine is the limit.
- On a win:
  - The run is recorded with its crew.
  - Everyone who took part gets a win.
  - The facility goes back to its starting kit and everyone returns to the intake.
- The board, kept in SQLite:
  - the run in progress (attempts so far, best charge)
  - the top players (wins, then kills; boxes placed)
  - recent won runs
- ADR-010's per-session score stays as the room list above the board.

**Why.** The developer described the objective as a long charge rather than a number of waves, and a reactor going down as a failed attempt, not a breakthrough. Resetting the charge to zero makes each attempt a real attempt, and the carried-over boxes are what make the next one go further.

---

## ADR-038: A garden on the surface, a lift down, and UI that floats on what you can use
*2026-10-20 · Status: Accepted (direction and rules from the developer; layout, timings and look built by the agent, not yet played)*

**Context.** The developer asked for three things. First, a tutorial area above ground: sunny and warm, with young grass and plants, against the cold facility. Second, minimal line-work sci-fi UI in the spirit of Rain World. It should float out when something can be used, stay stuck to that thing (for example at a gun's top-left whatever you do), and appear and disappear naturally. Third, a lift in place of the spawn room, joining the surface to the facility as seamlessly as possible (step in, doors shut, a short ride, doors open). It doubles as the ready-up: press the use key to shut it and go down, with a wait of a dozen seconds or so when there are other players. They later added a scoreboard screen in the garden that opens like a scoreboard when used, since it can't be read from overhead.

**Decision.**
- The developer's calls:
  - The surface does **not** follow the art rules at all. It should look like a bright, soft impressionist painting.
  - Firing is allowed in the garden.
  - The UI is white, with grey for "not available".
  - E is fine as the use key. The real rule behind "left hand only on Space/Q" is never to require holding Q or E while moving; a short tap is fine.
  - For now, the lift brings people down at any time: it returns to the top after a ride, and late players can follow. "The lift only comes back when the attempt is over" stays open; the code is the same either way.
  - Going down in the lift is joining the attempt, even before the reactor is on. Dying down there is final until the attempt ends. Before the reactor is switched on, a player can ride back up, which takes them out of the attempt, and they can then respawn in the garden. Once the reactor is on, nobody goes back up.
- How the agent built it:
  - The surface shares the facility's coordinates, 40 units south. The two ends of the car are identical, and a ride moves everyone inside by exactly that much. A warp counter lets the client jump with them and drop moves sent from the old spot.
  - The lift is a server state machine (open, closing, moving, opening).
    - Pressing E inside the car sends it. It waits 15 s if anyone else on that level isn't aboard, and 3 s once everyone is (the wait shortens if they arrive).
    - Pressing E outside the door calls an empty car.
    - An empty car at the bottom goes back up after 5 s.
    - While an attempt is on, the bottom door is shut to anyone outside the car, and anyone still inside is stood back in the corridor.
  - When an attempt ends (won, lost, or everyone below dead before the reactor came on), everyone below is revived in the garden and the car returns to the top.
  - E uses the nearest usable thing: lift button, then item, then reactor, then scoreboard. Clicking an item or the reactor still works.
  - Prompts are anchored to world points and drawn to their upper left: a dot, a 45° leader and a bracketed tag. They grow out dot, line, tag, retract in reverse, bob gently, and shake when refused. The whole HUD moved to the same white/grey line style.
  - The surface has its own post-process ("paint"): Kuwahara brush strokes, a warm high-key grade, blue-violet shade and canvas grain. Out of sight is bare canvas instead of black. It has a sun with shadows and a sky fill, and no headlamp. The look cross-fades in the car.
  - The scoreboard is a screen on the garden's north hedge. Using it opens a centred panel; walking away, E or Esc closes it. The always-on board in the corner is gone; the room list stays.

**Why.** The developer wanted the arrival area to be the facility's opposite, and decided its look shouldn't be held to the underground's rules. Making the lift the ready-up gives one clear moment of joining an attempt. Letting people ride back up until the reactor is on means a player who goes down too early isn't punished for it. Prompts pinned to the object put the instruction where the eye already is.

---

## ADR-039: Direction only — the charge bar becomes waves, scored as in-fiction currency
*2026-10-20 · Status: Proposed (direction from the developer; not built; several parts still open)*

**Context.** The 6-minute charge bar (ADR-037) is a single long timer with no natural break in it. The developer wants attempts to be chopped into waves instead, with a pause between them for spending.

**Decision.**
- The six-minute charge bar is replaced by a wave count. A wave ends once it's cleared, not on a clock.
- Between waves there's a 30-second break, meant for buying items and buildings from a shop that doesn't exist yet but will.
- Each wave scores on its own: clearing faster scores higher. Other scoring parts (no damage taken, no teammate down, and so on) are still open — the agent offered options drawn from similar games, and the developer hasn't picked any yet.
- The score doubles as the shop's currency. It's framed in the game's fiction as a quota: a supply credit a large, exploitative corporation issues to the contractors it sends down to die.
- The break should offer a way to start the next wave early, though whether that needs everyone's agreement or just one player is undecided.
- Still open: whether the score also decides who's winning, what ends a full run under the new scheme, and what the persistent board ends up recording.

**Why.** The developer wants a rhythm of pressure and relief rather than one continuous climb, and a reason, in the game's own terms, for the currency a shop would need.

---

## ADR-040: Waves built: ten to win, a break after each, anyone can send the next early
*2026-10-21 · Status: Accepted as a default (built by the agent while the developer was away; awaiting review)*

**Context.** The developer asked for ADR-039 to be built in order (waves, then a turret and the economy, then the queued surface and lift items). Because they couldn't correct course live, they said to list options but build what the agent judged best, and review afterwards.

**Decision.**
- The 6-minute charge bar is gone. The objective is clearing `WAVES_TO_WIN` = 10 waves (`DEV_WAVES` shortens it for local testing).
- A wave is cleared once all of its enemies have spawned and none are left alive. A 30 s break follows, then the next wave. The 10 s breather after switching the reactor on is treated as the first break.
- Wave size keeps the old charge formula's range, now driven by wave number: `4 + 22 × wave/10`, so 6 in wave 1 and 26 in wave 10.
- E at the reactor during a break sends the next wave early. **Anyone** can do it. The alternative, an all-ready vote like the lift's "everyone aboard" shortcut, was not built.
- A failed attempt reports waves cleared instead of charge percent. The board's "best" is now the most waves cleared.
- After a server restart, the saved wave count is kept and the attempt resumes with a fresh break. Enemies were never saved.
- Also done here (queued item f): the reactor's E no longer needs empty hands. A click on the reactor with an item in hand still uses the item, so firing over the reactor stays firing.

**Why.** Why waves at all is the developer's reason in ADR-039. Letting anyone skip is the simplest version that works with one player and doesn't stall on an idle teammate. It's the first thing to revisit if groups find it griefable. The empty-hands rule went for the developer's reason: it felt anti-human, and E has no conflict with firing.

## ADR-041: A shared quota and one thing to buy with it, a sentry turret
*2026-10-21 · Status: Accepted as a default (built by the agent; numbers untuned; awaiting review)*

**Context.** ADR-039 fixed that the score doubles as currency, framed as a corp's supply quota, but not who holds it, how it's earned, or what it buys.

**Decision (agent defaults).**
- The quota is **shared by the crew**, not per player: the defences are everyone's, so is what pays for them. The alternative, per-player balances split by kills or contribution, was not built.
- It's earned only by clearing a wave: 15, plus 1 for every second under par (par = 2.5 s per enemy in the wave). The other ADR-039 candidates (no-damage, no-death, streaks, per-kill points) are still unchosen.
- The quota carries over between attempts, like boxes, and is cleared when a run is won. It's saved in the `world` table.
- The shop is a supply terminal in the corridor, where the dead vending machine stood, so it can be reached in a break without the lift. Buying isn't limited to breaks: running back mid-wave is its own risk.
- One item for sale: a sentry turret, 40 quota, at most 8 in the world. It's handed straight to the buyer and placed exactly like a box (one tile, grid snap, same no-build zones). It blocks and reroutes enemies like a box, and is chewed down in 10 hits (a box takes 6).
- A placed turret fires a real projectile every 0.6 s at the nearest enemy it can see within 7 units. Its shots pass through the crew, and its kills count for nobody.

**Why.** These are the smallest economy that closes the loop: clear waves, earn, buy defence, clear faster. They're meant to be judged in play, not argued in advance.

## ADR-042: The garden becomes a fenced dig site among ruins
*2026-10-21 · Status: Accepted (direction from the developer, queued 2026-10-20; layout and models by the agent, awaiting review)*

**Context.** The developer queued three surface changes: out of sight should be black as underground, not cream canvas; the garden should be bigger, bounded by a see-through fence rather than by sight; and the dressing should tell a story, an ancient ruined facility being explored by a military-type organisation, keeping the garden's colour and tone.

**Decision.**
- Out of sight on the surface is black.
- The garden grows from 26×18 to 34×24. The hedges become a chain-link fence on the same lines, which stops movement but not sight. Sight reaches 6 units past it, onto ruins nobody can walk to: broken walls, toppled drums, an old rusted gantry, rubble.
- Inside the fence: stumps of a colonnade with moss in the joins and a lintel fallen in two (the ruin), and olive drop crates by the lift, a field tent and hazard tags on the fence (the corp). Colours, lawn, path and sun are unchanged.
- Everything inside is kept below sight-blocking height. A first try with one tall pillar cast a wide black wedge across the sunny lawn, which the agent judged wrong for the surface.

**Why.** The developer's reasons: the fence shows the edge while letting players see what's beyond it, and the dressing should say who's here and what came before.

## ADR-043: Sight through the lift doors follows the leaves
*2026-10-21 · Status: Accepted (the developer's request, queued 2026-10-20)*

**Decision.** Each door leaf is its own sight blocker, placed where it's drawn and sized by how open the door is, so the view through the doorway narrows and widens with the gap. Before, the door blocked sight all at once the moment it began to close.

**Why.** The developer wanted the door animation and what you can see to agree.

## ADR-044: Attempts end in the facility: lights up, blackout, or a cut to black
*2026-10-21 · Status: Accepted (direction from the developer after playtesting; mechanics by the agent, awaiting review)*

**Context.** Every ending, won or lost, snapped everyone straight back to the garden, which the developer found abrupt. They asked for three endings. A win should light the whole facility up "as if it has only just been properly powered", and the crew leaves by lift. A wipe should hold the camera where everyone fell, then cut away (to black, say). A dead reactor should black the facility out completely, torches only, with enemies that never stop coming. The developer hadn't decided whether the lift should still work in the blackout; fighting on until the end was one option they gave, but only if the pressure is high enough that nobody can sit it out.

**Decision.**
- *Won.* The defence gains a `won` phase. Every lamp comes on (the dead ones too, each catching at its own moment with a stutter), the red emergency lamps go off, and the ambient brightens and whitens. Fallen crew are back in the garden. The lift carries the rest up, and the facility resets only once nobody is left below.
- *Wipe.* The server holds for 4.5 s before moving everyone up. The client freezes the view where it was and fades to black over the last 1.3 s, moves behind the black, then fades up on the garden.
- *Blackout* (agent's choice on the open question: no way out). A `blackout` phase: no lamps, halos or reactor light, near-zero ambient, torches only. Waves stop counting. Every breach spawns without end, starting 600 ms apart and tightening by a tenth every 5 s down to 150 ms. Enemies ignore the dead reactor and hunt the crew along a flow field rebuilt every second toward a living player. Turrets are unpowered. The lift stays locked until everyone is dead.
- A restart mid-ending finishes it: a won run resets, a blackout counts as failed.

**Why.** The developer's reasons: the change of state should be felt in the facility itself, and a blackout you can't leave is only interesting if it ends quickly.

## ADR-045: Shots land hard, and fights leave blood and bodies
*2026-10-21 · Status: Accepted (the developer's request; colours and amounts by the agent)*

**Context.** The developer wanted shots with more impact (a faster round, sparks where it hits) and a facility that remembers its fights: bodies and blood that stay until the run is won. Humans bleed red and crawlers green; the agent picked the shades.

**Decision.**
- Rounds fly at 90 instead of 45, with longer, thicker tracers. The server marks what stopped each shot (wall, enemy or player), and clients burst sparks off walls and boxes, or a splash off whatever bleeds.
- Gore is server-decided, saved, and sent to clients as increments. Crew blood is a dark arterial red (#8a1a16; the first try, #6b1714, vanished under sodium light), crawler blood an acid green (#74b81a). A crawler that's hit leaves a drop half the time. A dead crawler leaves a large pool and its body on its back, darkened, eyes out. A wounded crewmate drips red; one who dies below leaves a body face down in their colour. Caps are 900 blood marks and 300 bodies, oldest first. Nothing stays on the surface.
- The art rules gain one exception: blood is the only surface colour allowed outside the gamut.

**Why.** The developer's reason: immersion. A floor that keeps the mess shows how the attempt has gone without a word of UI.

## ADR-046: The shop moves beside the reactor and sells field dressings
*2026-10-21 · Status: Accepted (the developer's request; heal rule from the developer, layout by the agent)*

**Context.** The developer judged the corridor terminal badly placed. They asked for a comms-desk kind of thing next to the reactor to act as the shop, and for the original vending machine to be restored. They also asked for a medical option that isn't an item: buy it and you heal. Their rule for it: the heal is a bandage. Healed from one hit away from death, you're back to full with every debuff cleared, but the next hit puts you straight back to where you were.

**Decision.** The vending machine is back in the corridor. A corp comms desk (a radio stack, a screen, a whip antenna) stands just north of the reactor. E opens a supply panel: 1 for a turret (40), 2 for a field dressing (20), or click a line; it closes when you walk away. A dressing clears every wound and remembers how many there were, and the next hit restores exactly that many, not one more. It needs a wound to buy and works with full hands. A dressed wound shows as a dotted pip.

**Why.** The developer's reasons: the shop belongs where the fight is, and a heal that only buys time keeps wounds meaningful.

## ADR-047: Harder waves and a looser rifle
*2026-10-21 · Status: Accepted (direction from the developer; numbers by the agent, awaiting tuning)*

**Context.** The developer cleared all ten waves on a first try and asked for the difficulty curve to be "squared at least once more". They also wanted a rifle with random spread, a higher rate of fire and lower damage per round.

**Decision.** Wave size is 6 + 3w + 0.45w² (9, 32 and 81 at waves 1, 5 and 10). The spawn gap shrinks 50 ms per wave from 700 to a floor of 250. Enemies move 0.08 faster each wave, and up to 50 can be alive at once. The rifle fires every 100 ms instead of 150, every shot strays up to ±0.05 rad (an arm wound still adds its own 0.12), and a crawler takes five rounds instead of three. Turrets fire every 450 ms instead of 600 to keep pace.

**Why.** The developer's reason: one clear on a first try means the curve is too flat. Their spec for the rifle makes it fire more and hit less.

## ADR-048: A fallen town on the surface, a harder retro screen, a terminal UI
*2026-10-21 · Status: Accepted (direction from the developer; look by the agent, awaiting review)*

**Context.** Three look requests from the developer. The surface ruins were too sparse, and should be mechanical and architectural wreckage, not stone; a laptop could still see the black edge. The pixel filter didn't have enough flavour, maybe because the resolution was still too high, and the agent could look for other ways to add atmosphere. And the UI text and leader lines looked too modern: make them more pixel-styled, after Lethal Company.

**Decision.**
- *Surface.* The colonnade becomes a fallen town: sheared concrete columns and slabs with rebar, asphalt streets outside the fence, burnt-out cars, a crane jib down across the north road, containers, pipe stacks, a toppled pylon, gutted building shells and rubble everywhere. Sight past the fence goes from 6 to 16 units.
- *Screen.* The internal resolution drops from 0.42 to 0.25 of the window. Underground, every frame is crushed to 12 levels a channel, with an ordered dither fixed to the big pixels, a scanline per pixel row and slight crawling grain. The surface keeps its painted grade.
- *UI.* Everything is an old company terminal: the VT323 pixel face in warm phosphor white with a faint glow, two-pixel frames with stepped corners, segmented bars, and prompt leaders drawn as pixel steps from a square dot. A report panel itemises each wave's pay (time against par, base, speed bonus, total) and sums up each attempt (outcome, waves, time held in the dark, kills per player). Wave banners give the enemy count and the size of the next wave.

**Why.** The developer's reasons: a denser, man-made wreck for the setting, more retro atmosphere, and UI that matches the pixel screen.

## ADR-049: Matching lift ends, burning eyes, no friendly fire
*2026-10-21 · Status: Accepted (from the developer's second playtest, with a teammate)*

**Context.** Three things from playing together. Riding down, some models in the lift car appeared out of nowhere. The crawlers were almost impossible to see, while teammates stood out well enough; the developer chose brighter red light over a red outline, wanting it to bloom, grow brighter the closer it is, and flicker slightly. And teammates carry no clear marker, so they get shot by mistake.

**Decision.**
- *Lift.* The bottom door was drawn with a door frame (steel jambs and a row of hazard stripes) and the top one wasn't, so the two "identical" cars differed and the frame popped in as the doors opened. The top door now gets the same frame. This is rendering only; walkable space is unchanged.
- *Crawler eyes.* Each crawler's eyes are an overexposed hot core plus a short red bloom round it. Both get brighter and larger as the crawler comes closer to the viewer (from 11 units in to 1.5), with a slight two-frequency tremble. The bloom is kept small enough that the body still shows.
- *Friendly fire* is off (`FRIENDLY_FIRE` in shared/protocol.ts): players' shots pass through every player, as turret shots already did.

**Why.** The developer's reasons: the lift should be invisible as a cut; enemies should be found by their light in the dark, which suits the setting better than an outline; and with no way to tell teammates apart mid-fight, being shot by them is just noise for now.
