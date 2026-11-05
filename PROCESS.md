# Process

## The experience I wanted to give

Asset Nexus Unlimited is now a top-down multiplayer co-op game. Players go
into an underground facility as an asset recovery crew, start the reactor and
hold it, restore power to the freight lift, then leave with the goods. The
reactor is the means of finishing the job; the cargo is why the company sent
them down. That setting shaped the evacuation too: the cargo has to be the
visual focus, and the lift has to look like a space really built for hauling
(the evacuation went in at [`7cbb188`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/7cbb188),
and the cargo was redone along these lines in [`67fabdf`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/67fabdf);
see also [ADR-069](docs/adr.md#adr-069-freight-lift--panel-by-the-door-the-cargo-one-heap-the-shaft-built-around-the-platform)).

My starting point was influenced by *The Art of Game Design*: a game should
convey some experience, give players a problem to solve, and make its goals
valuable inside the game. Over development that experience became clearer:
co-operation and immersion. The later it got, the more I realised a course
project needs a short, complete experience that's fun straight away. I let go
of building feedback through long-term progression or repeat play, and moved
towards a theme-park ride: someone who comes and plays once should feel what
it's trying to say. That shows in concrete trade-offs: the objective shrank
from ten waves to six, the cross-attempt build-up of keeping what you built
after a failure stopped being the focus, and when many people play at once,
rooms (at most four to a site) keep every run a complete experience for one
squad ([ADR-060](docs/adr.md#adr-060-seventh-round--what-watching-the-group-play-showed-about-the-ui),
[`e120767`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/e120767)).

## The stack: the part I'm not interested in, handed to the agent

To put it plainly: I'm not interested in the technical implementation itself.
What I care about is what players actually see, hear and handle in the
browser, the front-end "experience" and its effect. So I left the stack
entirely to Claude, with one requirement: keep to the project's existing
toolchain, stay consistent, and don't bring in a second build system or
runtime partway for the sake of one feature. It chose Node, TypeScript,
WebSocket, SQLite, Three.js and esbuild; the server decides the real-time
rules, and the client presents them and predicts some of them. The trade-offs
are recorded in
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

I put my effort into the direction of the gameplay and aesthetic judgement.
Gameplay is usually easy to describe and easy for the agent to change; art
only shows whether it's close to what I had in mind after seeing the real
result again and again.

## Letting the agent keep the project's memory

The most convenient and most important choice for me this time was having
the agent maintain a set of documents: ADRs record decisions and their
reasons, the handoff keeps the current state and the next work, and the
harness and the art and interaction rules hold the constraints that have to
carry forward. Once set up, it updates these files itself as it works, and I
don't have to explain the project's background each time. The rules went into
`CLAUDE.md` in [`4e64818`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/4e64818);
[`cd7a57f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/cd7a57f)
required the handoff to let a new session take over unaided; and
[`2e194f4`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/2e194f4)
moved them into `docs/` and into git.

I want to stress what the ADRs do. This may just be my impression, but I feel
that with ADRs the agent knows not only what I did but why I did it. That
makes it less likely to misread what I meant later on for some reason, or to
pick a worse solution just to follow a rule.

Especially in the last two or three weeks, I rarely felt any obvious
miscommunication. My way of working gradually became: spend ten-odd minutes
discussing a plan, let it build on its own for an hour or two, then come back
to check and play. This is my subjective impression; I never ran a comparison
with and without the system. It brings problems too: some offhand remarks get
fixed into hard rules and need correcting later. These feelings are also in my
[crit 10 reflection](reflections/crit-10.md).

## What the checks protect

The tests in `spec/` target the part of the experience that's hard to notice
at once when it breaks: whether two browsers are told apart, whether the same
person coming back is the same person, whether what one player holds can't be
taken by another (`multiuser.test.ts`); whether players in different sites
can't see each other and a fifth person is turned away (`rooms.test.ts`);
whether malformed messages and floods can't bring the server down
(`robustness.test.ts`); and the rules of the lift, waves, shop and tutorial
(`lift`, `defence`, `economy`, `tutorial`). These are all rules a program can
enforce. Whether co-operation is fun or the picture draws people in, tests
can't answer; only playtesting can.

## How art exploration became rules

The top-down view came straight from *Escape from Duckov*: the form suits a
light game that also carries a story, and a fixed viewing distance lowers how
much detail the models need. *Buckshot Roulette* and *Lethal Company* inspired
the pixelation, which both hides the models' lack of detail, letting players
imagine what's missing, and helps build tension. *Lethal Company* also
inspired the shady-company setting; for gameplay I mainly drew on
*Titanfall 2*'s Frontier Defense.

Giving references didn't make the art reach what I expected straight away. I
tried different directions, *Arc Raiders* among them, and gradually it became
clear that what needed controlling was the relationship between materials,
lighting and colour. The facility ended up with one consistent low-saturation
gamut, vivid colour mostly kept for things that glow, and the overall grade
kept separate from the models; a gallery page and automatic checks let every
model be reviewed together and check triangle counts and colour range. The
art system was set up in [`d9a96d5`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/d9a96d5),
the facility and gamut came in [`fdc8482`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/fdc8482),
and the later red-grey regrade in [`f69f2f4`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/f69f2f4).

## How corrections landed in rules and checks

Correcting the agent also ends up in the rules. For example, to make the
outline clearer from above, it once turned the gun in a player's hands
sideways as well. I said a gun on the ground can lie on its side, but a gun in
the hands still has to be held normally. That feedback was written into the
art rules. Likewise, when the headlamp threw shadows that made no sense on the
character itself, I refused to fix it by turning shadows off and asked for
the light to be moved instead. These examples show the rules need to keep the
visual goal and the reasoning behind a judgement, so that fixing one problem
doesn't lose the effect I wanted. See
[ADR-014](docs/adr.md#adr-014-corrections-after-first-model-review),
[ADR-033](docs/adr.md#adr-033-flashlight-shadows-headlamp-on-the-cap-brim)
and the headlamp rule commit [`ebd6978`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/ebd6978).

Gameplay corrections land in tests. The agent once had enemies quietly get
tougher and faster in later waves. My rule: if the numbers change, the look
has to change with them; what players see should tell them what they face.
The rule went into
[ADR-053](docs/adr.md#adr-053-an-enemy-kinds-stats-never-scale-with-the-wave)
and became a test in [`572769f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/572769f)
("an enemy kind has the same stats on every wave"). Similarly, playtesting
showed turrets could seal a passage completely, which isn't the kind of
defence I want; once turrets stopped blocking enemies,
[`60785ea`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/60785ea)
added a test that "an enemy walks past a ring of turrets", so later changes
can't undo it
([ADR-066](docs/adr.md#adr-066-ninth-round--scope-for-the-last-week-and-the-backlog-settled)).

## What playtesting showed beyond the implementation

A group playtest changed my judgement about guidance. Some people took the
surface for a PvP arena and never found the lift; without a reminder nobody
knew to start the reactor, and someone never found the shop. Based on that
feedback I added a tutorial in separate rooms, objective markers and arrows
at the screen's edge. Later, the information was all there but buried too
deep, or arrived all at once at the end of a wave, so the ready hint got a
place of its own and the information now comes in batches. See
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

## Where the trade-offs stand

I spent a lot of adjustment on the art; sound, because of time, isn't
polished to the same degree. It's in, made by first listening on a preview
page and then deciding whether to keep the synthesised sound or swap in a
recording, but immersion and the pressure curve still have room to improve.
See [ADR-071](docs/adr.md#adr-071-sound-first-batches) and the combat sounds
wired in at [`80ba129`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/80ba129).

This collaboration let me put more energy into choosing and reviewing.
Documents and checks cut down repeated explanation and helped the agent move
forward on its own; at the same time, what experience the game finally
conveys still has to be judged by me and by real players.

## References

Schell, J. (2019). *The Art of Game Design: A Book of Lenses* (3rd ed.). CRC
Press. Read in the Chinese translation: 谢尔, J. (2021). 《游戏设计艺术（第3版）》
(刘嘉俊 等译). 电子工业出版社.
