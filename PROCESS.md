# Process

## The experience I wanted to give

Asset Nexus Unlimited is a top-down multiplayer co-op game: an asset
recovery crew starts and holds a reactor underground, then leaves with the
goods. The cargo is why the company sent them down, so it had to be the
evacuation's visual focus
([ADR-069](docs/adr.md#adr-069-freight-lift--panel-by-the-door-the-cargo-one-heap-the-shaft-built-around-the-platform),
[`67fabdf`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/67fabdf)).

My starting point was influenced by *The Art of Game Design*: a game should
convey some experience, give players a problem to solve, and make its goals
valuable inside the game. Over development that experience became clearer:
co-operation and immersion. The later it got, the more I realised a course
project needs a short, complete experience that's fun straight away. I let go
of building feedback through long-term progression or repeat play, and moved
towards a theme-park ride: someone who comes and plays once should feel what
it's trying to say. That shows in concrete trade-offs: the objective shrank
from ten waves to six, and rooms (at most four to a site) keep every run a
complete experience for one squad ([ADR-060](docs/adr.md#adr-060-seventh-round--what-watching-the-group-play-showed-about-the-ui),
[`e120767`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/e120767)).

## The stack: the part I'm not interested in, handed to the agent

To put it plainly: I'm not interested in the technical implementation itself.
What I care about is what players actually see, hear and handle in the
browser, the front-end "experience" and its effect. So I left the stack
entirely to Claude, with one requirement: stay consistent, no second build
system or runtime partway for one feature. It chose Node, TypeScript,
WebSocket, SQLite, Three.js and esbuild, with the server deciding the rules.
The trade-offs are recorded in
[ADR-005](docs/adr.md#adr-005-tech-stack-native-typescript-on-node-ws-nodesqlite-threejs)
and the [note on the server-authoritative design](docs/adr/0001-server-authoritative-shared-world.md);
the first implementation is [`8d98917`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/8d98917).

I judge the technology only by results: do several players see the same
world, do the controls respond, does the picture run smoothly. When the first
real multiplayer test showed obvious lag, what I cared about was that
"shooting feels wrong"; how to fix it (client-side prediction, interpolation,
reconnecting) the agent proposed and built
([`881e4fd`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/881e4fd)).
The cost of this split is that I know little about the code underneath, so I
judge whether it's right mainly through automatic checks and playtesting, not
by reading it.

I put my effort into gameplay direction and aesthetic judgement instead.

## Letting the agent keep the project's memory

The most important choice for me was having the agent maintain a set of
documents: ADRs record decisions and their reasons, the handoff keeps the
current state, and the harness and art rules hold the constraints. It
updates them itself as it works, so I don't re-explain the background. The rules went into
`CLAUDE.md` in [`4e64818`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/4e64818),
and [`2e194f4`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/2e194f4)
moved the documents into `docs/` and into git.

I want to stress what the ADRs do. This may just be my impression, but I feel
that with ADRs the agent knows not only what I did but why I did it. That makes it less likely to misread me later, or to
pick a worse solution just to follow a rule.

Especially in the last two or three weeks, I rarely felt any obvious
miscommunication. My way of working gradually became: spend ten-odd minutes
discussing a plan, let it build on its own for an hour or two, then come back
to check and play. This is my impression; I never ran a comparison. It brings
problems too: some offhand remarks get fixed into hard rules and need
correcting later ([crit 10 reflection](reflections/crit-10.md)).

## What the checks protect

The tests in [`spec/`](spec/) cover rules a program can enforce. Whether
co-operation is fun or the picture draws people in, tests can't answer; only
playtesting can.

## How art exploration became rules

The references (README, [ADR-088](docs/adr.md#adr-088-references-and-what-each-one-gave-the-game))
didn't make the art reach what I expected straight away. I tried different
directions, and gradually it became
clear that what needed controlling was the relationship between materials,
lighting and colour. The facility ended up with one consistent low-saturation
gamut, vivid colour mostly kept for things that glow, and a gallery page
plus automatic checks to review every model together. The
art system was set up in [`d9a96d5`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/d9a96d5),
the facility and gamut came in [`fdc8482`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/fdc8482),
and the later red-grey regrade in [`f69f2f4`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/f69f2f4).

## How corrections landed in rules and checks

Art corrections end up in the rules. To make the outline clearer from
above, the agent once turned the gun in a player's hands sideways too. I said a gun on the ground can lie on its side, but a gun in
the hands still has to be held normally. That feedback was written into the
art rules. Likewise, when the headlamp threw shadows that made no sense on the
character itself, I refused to fix it by turning shadows off and asked for
the light to be moved instead. The rules need to keep the reasoning behind a judgement,
so that fixing one problem doesn't lose the effect I wanted. See
[ADR-014](docs/adr.md#adr-014-corrections-after-first-model-review),
[ADR-033](docs/adr.md#adr-033-flashlight-shadows-headlamp-on-the-cap-brim)
and the headlamp rule commit [`ebd6978`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/ebd6978).

Gameplay corrections land in tests. The agent once had enemies quietly get
tougher in later waves. My rule: if the numbers change, the look has to
change with them. It went into
[ADR-053](docs/adr.md#adr-053-an-enemy-kinds-stats-never-scale-with-the-wave)
and became a test in [`572769f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/572769f)
("an enemy kind has the same stats on every wave"). Likewise, turrets
sealing a passage became the test "an enemy walks past a ring of turrets"
([`60785ea`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/60785ea)).

## What playtesting showed beyond the implementation

A group playtest changed my judgement about guidance. Some people took the
surface for a PvP arena and never found the lift; without a reminder nobody
knew to start the reactor, and someone never found the shop. Based on that
feedback I added a tutorial in separate rooms, objective markers and arrows
at the screen's edge. See
[ADR-050](docs/adr.md#adr-050-what-the-group-playtest-showed--tutorial-and-visual-guidance-come-next);
the guidance markers are in [`0e52073`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/0e52073),
the tutorial in [`12a8297`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/12a8297),
and the information hierarchy in [`544c774`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/544c774)
([ADR-060](docs/adr.md#adr-060-seventh-round--what-watching-the-group-play-showed-about-the-ui)).

These problems weren't just something the AI missed. Even I only realised
them by watching other people play. The agent can verify that the program
follows the rules and check pages and pictures, but it can't actually have
the player's experience. I think this is to some extent a hard limit, which
more harness or a different workflow alone can't solve. Whether the art
works, whether co-op is fun, whether players understand the next step still
need human judgement, above all other players' feedback.

Sound was pointed out by someone else too. I had largely ignored it during
development, until my tutor, Thomas, asked me in a chat whether I'd thought
about adding sound effects. Before that it hadn't occurred to me at all.
Once they were in, though not finely polished, the game really felt
different ([ADR-071](docs/adr.md#adr-071-sound-first-batches),
[`80ba129`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/80ba129)).

## Where the trade-offs stand

I spent a lot of adjustment on the art; sound came late and isn't polished
to the same degree, and the pressure curve still has room to improve.

This collaboration let me put more energy into choosing and reviewing.
Documents and checks cut down repeated explanation and helped the agent move
forward on its own; at the same time, what experience the game finally
conveys still has to be judged by me and by real players.

## References

Schell, J. (2019). *The Art of Game Design: A Book of Lenses* (3rd ed.). CRC
Press. Read in the Chinese translation: 谢尔, J. (2021). 《游戏设计艺术（第3版）》
(刘嘉俊 等译). 电子工业出版社.
