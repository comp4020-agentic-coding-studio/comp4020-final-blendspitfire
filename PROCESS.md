# Process

## What this app is, and the stack behind it

It's now a top-down 3D multiplayer PVE game set in an underground facility.
Players spawn in a safe intake room, go through a one-way gate, and make
their way through a corridor, a lab and a server hall to the reactor in the
core, the objective they have to protect. Anything out of sight is pitch
black, and the image runs through a pixelation filter.

What works today: several players moving around at once, picking up items
(a gun that fires, a box that builds cover), and activating the reactor.
There are no enemies yet.

The stack was left entirely to the AI to choose: Node 24 (TypeScript run
directly, no build step) + bare `ws` for WebSocket + Node's built-in
`node:sqlite` for persistence + Three.js on the client, bundled with esbuild.
This wasn't a substantive decision on my part. The only boundary I set was
one consistent toolchain throughout: no second build system or runtime
brought in partway for the sake of one feature.

## Decisions and trade-offs

### Decision 1: game or tool
The brief leaves "what to build" completely open, fixing only three hard
requirements: multi-user, real-time, persistent. So the choice came down to
either a game (or something game-like) or a tool-style site. I went with a
game. Honestly, this was mostly personal interest — I find it more fun, and
wanted to build some experience in this kind of development.

### Decision 2: turn-based or real-time
Within "game", I had to decide early whether it would be turn-based (card
games, board games, quizzes) or real-time. I picked real-time, again mostly
out of personal preference: I rarely play turn-based games myself.

### Decision 3: 2D or 3D
2D looked like the lower technical bar at first, but its real problem is art
assets: neither I nor the AI are good at drawing, and from past experience,
AI-generated 2D art is painful to iterate on. 3D sidesteps this — with a
decent engine and lighting, even the simplest geometry (boxes, capsules)
reads as reasonably designed once lit. So I went with 3D.

### Decision 4: normal real-time multiplayer is the foundation
The game is designed as a real-time online game, so ordinary online play is
its foundation: the server is the authority and everyone sees the same world
live. The options and their costs are in
[ADR 0001](docs/adr/0001-server-authoritative-shared-world.md).

### Decision 5: no architectural cap on players per match
The server (256MB, one shared vCPU) already sets a natural ceiling on load.
I didn't add a tighter, artificial cap on top, such as "4 players max": the
resource limit will be hit on its own, and tightening it by design is a
separate question I chose not to.

### Decision 6: low poly as the art base
Once I'd settled on 3D, I chose low poly as the art style, for the same
reason I chose 3D: every model is assembled in code from simple shapes, which
is well within what the AI can do reliably. The bar I set for models was
"you can at least tell what it is": the gun should be recognisable as an
M4A1 from a few signature features. The first version was minimal, only to
prove the tech; later I kept low poly and raised the detail.

### Decision 7: a realistic palette
I looked at several art styles, trying in turn sci-fi-leaning palettes like
Arc Raiders and Starfield, but I was never satisfied with how the AI
understood colour, so in the end I went with a more realistic palette. In
other words, it's not that I think realism is the better style; experimenting
showed that, of the styles I like, realism is the one the AI is best at
producing.

### Decision 8: shooting stays as a core element
Last week I'd treated shooting as a placeholder. After weighing it up
properly, I changed my mind: I don't have professional development
experience, and my understanding of social games is fairly shallow, whereas
shooters overlap heavily with the games I actually play. That means even
without much formal game-design knowledge, I can push the design forward
fairly naturally on experience and intuition.

### Decision 9: from a Rust-like game to persistent PVE with building
At one point I'd decided on a scaled-down, Rust-like multiplayer sandbox
with bases. I later overturned that in favour of a persistent PVE with some
building, playing roughly like holding off a zombie horde. The core loop: players gather resources, activate an
objective, and hold off the enemies. They'll very likely fail in the end,
but what they built and the resources they gathered are kept, and they use
what the last round left behind to hold out in the next, until the objective
is fully activated.

### Decision 10: restricted vision and a horror atmosphere
I set the map's style to restricted vision and a horror-leaning atmosphere.
This is a personal aesthetic judgement: when art assets can only be so
detailed, limiting the information players get is a simple way to raise
immersion. The pixelation filter is there for a similar reason, and it also
hides some low-poly flaws. Many recent indie games pair simple models with a
pixel filter to good effect: the player fills in the detail instead of it
all being built. It's a technique I personally admire.

## What's first-draft and likely to change

The most obviously first-draft part is the gameplay itself: there are no
enemies yet, the reactor can only be activated, and the "defend" half
doesn't exist. Keeping what was built and gathered across rounds, from
Decision 9, isn't done either: items currently live only in memory, so a
server restart puts everything back. What the intake room is in the game's
world waits on the setting. Colour is still being tuned; if I stay unhappy,
I may build a slider panel to adjust hue, saturation and contrast like
editing a photo.

One thing is deliberately left out. The first real multiplayer test showed
noticeable latency. I added client-side shot prediction and jitter-tolerant
interpolation, but not server-side lag compensation or a UDP transport:
too large a rearchitecture for what was then a placeholder. Shooting has
stayed, but the main opponents will be server-controlled enemies, so lag
compensation matters much less.

## Commit evidence

- [`8d98917`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/8d98917) — the shared 3D space MVP.
- [`881e4fd`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/881e4fd) — prediction, interpolation and reconnect after the first real multiplayer test.
- [`11b3500`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/11b3500) — pick-up items replace click-to-shoot.
- [`d9a96d5`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/d9a96d5) — low poly base (Decision 6) and interaction rules.
- [`4e64818`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/4e64818) — budget and handoff rules added to `CLAUDE.md` after an expensive resumed session.
- [`fdc8482`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/fdc8482) — the facility, realistic palette, restricted vision, gate and reactor (Decisions 7, 9, 10).
