# Process

## What this app is, and the stack behind it

Right now this is a top-down 3D, twin-stick multiplayer PVP shooter in the
style of Battle City: each visitor controls a character built from simple
geometric shapes, moves around a shared scene, aims with the mouse, and
clicks to fire a projectile that bounces off walls and obstacles. Hitting
another player freezes them for a few seconds before they respawn somewhere
random. What the game actually is hasn't been decided yet — the current
gameplay only exists to make it playable.

The stack behind it was left entirely to the AI to choose: Node 24
(TypeScript run directly, no build step) + bare `ws` for WebSocket + Node's
built-in `node:sqlite` for persistence + Three.js on the client, bundled with
esbuild. The only requirement I gave it was to keep one consistent toolchain
throughout.

## Decisions and trade-offs

### Decision 1: game or tool
The brief leaves "what to build" completely open, fixing only three hard
requirements: multi-user, real-time, persistent. So the choice came down to
either a game (or something game-like) or a tool-style site. I went with a
game. Honestly, this was mostly personal interest — I find it more fun, and
wanted to build some experience in this kind of development.

### Decision 2: turn-based or real-time
Within "game", I still haven't settled on what the final game actually is,
but I had to decide early whether it's turn-based (card/board games, quizzes)
or real-time. I picked real-time, again mostly personal preference — I don't
play many turn-based games myself.

### Decision 3: 2D or 3D
2D looked like the lower technical bar at first, but its real problem is art
assets: neither I nor the AI are good at drawing, and from past experience,
AI-generated 2D art is painful to iterate on. 3D sidesteps this — with a
decent engine and lighting, even the simplest geometry (boxes, capsules)
reads as reasonably designed once lit. So I went with 3D.

### Decision 4: the stack was entirely the AI's call
As above, this wasn't a substantive decision on my part — I only set one
boundary condition: keep a single toolchain for the whole project, don't
introduce a second build system or runtime partway through for the sake of
one feature. The actual choices were the AI's.

### Decision 5: no architectural cap on players per match
The server hardware itself (256MB memory, one shared vCPU, single process)
sets a natural ceiling on concurrent load, but I didn't also add a tighter,
artificial cap at the architecture/design level (e.g. hard-coding "4 players
max"). These are two separate things: the server's resource limit is an
objective constraint that will get hit on its own; whether to also tighten
that number by design is a separate question, and I chose not to.

## What's first-draft and likely to change

The shooting mechanic itself is the most likely thing to change. I'm still
figuring out what this game is actually meant to be — I don't even know yet
whether it ends up PVP, PVE, something non-combat and purely cooperative, or
even sandbox-like. The current combat rules exist mainly to give the project
something playable right now, not because they're the intended direction.

<!-- out-of-scope note, skeleton for you to expand: real multiplayer testing
     (2026-10-07) surfaced real-network latency as a problem. Client-side
     shot prediction and jitter-tolerant interpolation were added, but true
     server-side lag-compensated hit detection (rewinding world state to the
     shooter's perceived time) and swapping WebSocket/TCP for a UDP-based
     transport (WebRTC) were deliberately left out -- too large a
     rearchitecture to justify for a placeholder combat mechanic whose
     actual shape (per the paragraph above) isn't decided yet. -->

## Commit evidence

[`8d98917`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/8d98917) — the shared 3D space MVP: server, client, Dockerfile, doc skeletons.
