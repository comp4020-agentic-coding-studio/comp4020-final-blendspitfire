# Process

## What this app is, and the stack behind it

It's a top-down 3D multiplayer co-op PvE defence game. Players spawn in a
sunlit garden on the surface, where they learn the controls and try the gun
on a range. Then they take a lift together down to a dark underground
facility, and make their way through a corridor, a lab and a server hall to
the core, where they switch on the reactor and hold it.

What works today: several players online at once, all seeing the same world;
picking up items (a gun that fires, a box that builds cover); a lift between
the surface and the facility; enemies coming through the breaches in waves
once the reactor is on, more of them as it charges; wounds, and spectating
after death; a full charge wins the run, while a failed attempt sends the
charge back to zero but keeps the boxes; players told apart by codename and
logged on the server; and a persistent scoreboard. The world is stored in
SQLite and survives a server restart.

The stack was left entirely to the AI to choose: Node 24 (TypeScript run
directly, no build step) + bare `ws` for WebSocket + Node's built-in
`node:sqlite` for persistence + Three.js on the client, bundled with esbuild.
This wasn't a substantive decision on my part. The only boundary I set was
one consistent toolchain throughout: no second build system or runtime
brought in partway for the sake of one feature.

How I split the work with the AI: I'm fully in charge of the game's
mechanics, because I don't think the AI does well when left to decide those
on its own. Art is where the AI and I have iterated the most. I often ask
the AI to go and find references, rather than trying to describe what I want
in words.

## Decisions and trade-offs

### Decision 1: game or tool
The brief leaves "what to build" completely open, fixing only three hard
requirements: multi-user, real-time, persistent. So the choice came down to
either a game (or something game-like) or a tool-style site. I went with a
game. Honestly, this was mostly personal interest — I find it more fun, and
wanted to build some experience in this kind of development.

I keep the course's goals and the game's goals apart. The course asks for
multi-user, persistence, and a record of how I used AI to plan, build and
test; it isn't marking whether the game is as fun as a commercial one. So I
don't need to prove this is a "good game". What I need to show is why I made
each design choice, what I expect it to do, and how I'll check and weigh it
from here.

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

None of this was derived from theory. It came from the course's constraints
plus the games I play. Co-op comes from the course's multi-user requirement,
which I turned into defending together. Waves of enemies that get harder come
from the classic PvE defence modes I know and like, such as Call of Duty's
Zombies; it's a proven format, and I wasn't after mechanical novelty. Keeping
what you built after a failure was first prompted by the persistence
requirement: if persistence only showed up as a scoreboard, that felt thin,
so I wanted storage to be part of the game loop itself, and it's also a
direction I believe in. In some ways the project is close to a fuller game I
had in mind before. It's a smaller version of that idea, cut down by the time
and the course's goals, but it isn't that game.

Settled: a failed attempt starts over from the beginning (today the charge
goes back to zero; once waves replace it, that means back to wave 1), but
what was built stays. So there are two loops. Within an attempt: fight a
wave → earn by how well you did → build in the break → next wave. Across
attempts: fail → keep what was built → start over → get closer to the
objective. I want that build-up to be direct and mechanical, not dependent on
deep strategy: put down a turret and it reliably adds firepower, so over a
few rounds the defence grows until the players have a real chance of winning.
At the moment boxes are the only thing carried over; turrets and traps don't
exist yet.

### Decision 10: restricted vision and a horror atmosphere
I set the map's style to restricted vision and a horror-leaning atmosphere.
This is a personal aesthetic judgement: when art assets can only be so
detailed, limiting the information players get is a simple way to raise
immersion. The pixelation filter is there for a similar reason, and it also
hides some low-poly flaws. Many recent indie games pair simple models with a
pixel filter to good effect: the player fills in the detail instead of it
all being built. It's a technique I personally admire.

### Decision 11: weak co-op
I went for a fairly "weak" form of co-op. The goal isn't elaborate roles,
combos, or puzzles that need several people acting at once. Another player
means more firepower, someone covering another direction, or someone free to
build while the rest fight. I'm not chasing "1+1>2"; for this project, the
plain help of "1+1=2" is enough.

### Decision 12: a sunlit surface above, the facility below, joined by a lift
I built in a deliberate contrast between the surface and the facility. The
surface is relaxed and calm, with plenty of soft sunlight and greenery; it's
where players get ready, learn the controls and use the range. Below is the
industrial facility where the fighting happens: badly lit, grey, oppressive.
Going down in the lift should make the change of mood obvious. That's not
just for looks: I'm using space, light and colour to pull the player into the
world. I decided the surface doesn't follow the underground's art rules at
all; what I want there is the bright, soft feel of an impressionist painting.
The lift is also the ready-up. Going down means joining the attempt; before
the reactor is switched on you can ride back up and leave, and once it's on
there's no going back up. That gives one clear moment of joining, and nobody
is punished for going down too early.

### Decision 13: every attempt should be worth going all out
While thinking about expensive gear, I noticed a problem: I don't want
players holding back for some later round and getting through the current
one as cheaply as possible. If the shop sold a very expensive special ammo,
for example, players might never use it and save it all for the end. That's
not something I want to encourage. So for now I'm not leaning towards
expensive one-off consumables, and prefer permanent structures or upgrades
that keep working. That doesn't rule consumables out entirely; it means that
when I design a new resource, I check whether it would push players to
hoard, stall or play passively.

### Decision 14: waves with a break between, and rewards tied to how well you defend
Next, the six-minute charge bar will be replaced by a wave count. After each
wave is cleared, players get a relatively safe stretch to buy gear, build
turrets or traps and adjust the defence before the next wave, much like PvE
modes such as Titanfall 2's Frontier Defense. I'm currently leaning towards
30 seconds, with an option to start the next wave early; the alternative is
up to 60 seconds, starting early once everyone is ready. Playtesting will
decide. Each wave is scored when it ends, and a faster clear scores more;
other possible bonuses (no damage taken, no teammate down, and so on) will
draw on established designs, but none are picked yet. To stop players
deliberately failing fast and restarting to farm rewards, rewards will be
tied to how well they defend, above all how long they hold out and how far
they get, so restarting quickly won't pay. The exact formula needs economy
testing. The score doubles as the shop's currency, but to keep it immersive,
in the game it's a supply quota that a large, shady corporation hands out to
the mercenaries or employees it's sending in to risk their lives. This
direction is settled but not built.

## An open decision: a short run or a long one

This isn't settled. Option A is a short run, which I currently lean
towards: a few failures and some build-up give the players a real chance at
the objective. It suits the map's current size, and makes it more likely
that a ten-minute playtest shows the whole loop; ideally a run could be won
in ten minutes, but that needs testing. Option B is a long run: a dozen or
even dozens of attempts, maybe carried on by different groups of players
over time. That would bring out the sense of inheritance I'm interested in,
where later players build on what earlier ones left and slowly change the
whole world. But it would need a bigger map, more enemies and mechanics, and
enough content to last. AI might lower the cost of producing that content,
but integrating, debugging and actually testing the gameplay would still be
real work. Next I'll decide based on how long a run actually takes, the
map's size, the pacing, and how much development time is left.

## Looking back through Schell's lenses

I want to use Jesse Schell's *The Art of Game Design: A Book of Lenses* as
a reference frame for evaluating the design from here. To be clear, the
original gameplay came from my interests, the course's requirements and the
games I've played; the book's concepts are tools I'm using afterwards to
reflect and analyse, not where these mechanics were derived from.

- **Game as a problem-solving activity.** Schell defines a game as a
  problem-solving activity approached with a playful attitude. The direct
  problem my players face is how to hold out longer under ever-growing
  enemy pressure, and how to use what's already built to reach a higher
  wave. This helps me say more clearly what the player is actually doing.
- **Essential Experience.** Rather than listing features, the question is
  what I want the player to experience, and how the mechanics and visuals
  support it. What I care about most is light co-op, immersion from the
  setting, and growth that builds up across failures.
- **Elemental Tetrad.** Mechanics, story, aesthetics and technology give
  me four angles to check the project from. My focus now is the combat and
  building mechanics, the visual atmosphere, and the technology for
  multiplayer sync and persistence; a complex story isn't a priority at this
  stage.

These are tools for analysis; they don't prove the design is fun.

## What's first-draft and likely to change

The most obviously first-draft part is the economy and progression: boxes
are the only thing carried between attempts, there are no resources, shop,
turrets or traps yet, and waves and scoring (Decision 14) are only a
direction so far. Whether the objective stays a reactor (it could become a
transmitter or something else), and whether runs are short or long, are both
undecided. The garden's dressing will also change: the colours stay, but its
contents should follow a setting of an ancient ruined facility being explored
by a military-type organisation, so ruins and rust alongside supply crates
that have clearly just been deployed. Colour is still being tuned; if I stay
unhappy, I may build a slider panel to adjust hue, saturation and contrast
like editing a photo.

Everything here about how players will feel (the help of co-op, the change
of mood, snowballing growth) is a design expectation, not yet tested with
players. In a ten-minute playtest I'd like players to meet at least three
things: defending together in one shared space; the contrast between the
surface and the facility; and at least one round of fight → fail → inherit →
try again. What I need to check next: can several players reliably get in
together and see the same fighting and building; do players understand
waves, resources, building and the break; after a failure, does progress
reset properly while what should be kept is still there; can players clearly
feel the advantage of what was inherited; do the rewards really encourage
holding out longer rather than failing fast to farm; can one full loop fit in
ten minutes, and is a win possible; is the surface/facility contrast clear
enough. If the results don't match what I expect, the adjustments will be
recorded as decisions too.

One thing is deliberately left out. The first real multiplayer test showed
noticeable latency. I added client-side shot prediction and jitter-tolerant
interpolation, but not server-side lag compensation or a UDP transport:
too large a rearchitecture for what was then a placeholder. Shooting has
stayed, but the main opponents are server-controlled enemies, so lag
compensation matters much less.

## Commit evidence

- [`8d98917`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/8d98917) — the shared 3D space MVP.
- [`881e4fd`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/881e4fd) — prediction, interpolation and reconnect after the first real multiplayer test.
- [`11b3500`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/11b3500) — pick-up items replace click-to-shoot.
- [`d9a96d5`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/d9a96d5) — low poly base (Decision 6) and interaction rules.
- [`4e64818`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/4e64818) — budget and handoff rules added to `CLAUDE.md` after an expensive resumed session.
- [`fdc8482`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/fdc8482) — the facility, realistic palette, restricted vision, gate and reactor (Decisions 7, 9, 10).
- [`56985d0`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/56985d0) — world persistence: items and the reactor survive a restart.
- [`7fffa1e`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/7fffa1e) — the defence: enemy waves come through the breaches to attack the reactor.
- [`11ed891`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/11ed891) — death during an attempt is final, spectate teammates; everyone down fails the attempt.
- [`ee12b19`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/ee12b19) — codenames, server logs, the charge bar win and the scoreboard.
- [`d4c3fa3`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/d4c3fa3) — the surface garden, the lift and the floating UI (Decision 12).

## References

Schell, J. (2015). *The Art of Game Design: A Book of Lenses* (2nd ed.). CRC Press.
