# Asset Nexus Unlimited

## What this game is

Asset Nexus Unlimited is a top-down 3D multiplayer co-op game. The players are
a crew recovering assets for a company: they go down into an underground
facility, start the reactor and protect it, hold off the monsters, restore
power to the freight lift, and finally haul the goods out.

What I wanted to make is a short but genuinely fun co-op experience. It's like
a theme-park ride: players don't need to commit long-term, and in a single
session they still go through getting ready, fighting and getting out, and
feel the fun of finishing a job together with other people.

## How to play

- Type a name (or leave it blank) and join a site or start one; a site holds
  up to four. To see the multiplayer side, open a second window (an incognito
  one counts) and join the same site.
- First-time players start in a tutorial that teaches the controls: **WASD**
  to move, **mouse** to aim, **left-click or Space** to fire, **E** to use,
  **Esc** for the menu.
- Your name, stats and the leaderboard are saved for good; a site is cleared
  a minute after everyone leaves.

## What counts as good, to me

My design thinking is influenced by *The Art of Game Design* (Schell). My
reading of some of its ideas is that a game should give players a problem to
solve, and its goals should have value inside the game. Here the problem is
the threat of the monsters, and protecting the reactor matters because of the
recovery job: it powers the lift that carries the goods out.

What I value most is the fun of co-operation itself, and immersion. Players
should know the shared goal and be able to face the pressure together; the
carefully tuned art, lighting and sound give the job a sense of being there. If players
don't know where to go, mistake teammates for enemies, or the fighting has no
pressure, then even with every feature working, the experience hasn't reached
my goal.

Controls should be clear with immediate feedback, and should look after
players on a trackpad. The picture should run smoothly, never broken by
performance problems, and above all there must be no serious bug that stops
play.

## What the checks enforce, and what can only be judged

Enforced by automatic checks in `spec/`:

- Players in two browsers are told apart, and nobody can take what another
  is holding.
- Different sites can't see each other; a site holds at most four.
- An enemy's stats never quietly change with the wave.
- Turrets can't seal off a passage entirely.
- The server survives malformed messages and floods, and a client can't
  teleport.

Held by rules, but in the end judged by eye: models, colours and controls
follow [`docs/art-and-interaction.md`](docs/art-and-interaction.md).

Only playtesting can judge: whether co-operation is fun, whether the setting
draws people in, and whether players know what to do next.

## What I chose not to build

- No long-term progression or replay loop: probably nobody would actually
  play through it, so it's better as one visit that's complete in itself.
- No complex roles or co-ordination: another person means more firepower and
  another direction covered; "1+1=2" is enough, and it costs players less to
  pick up.
- No accounts or logins: a name is only for the leaderboard.
- No friendly fire: the picture is deliberately blurry and fire is dense, so
  telling friend from foe is hard; leaving it out fits the "theme-park ride"
  ([ADR-049](docs/adr.md#adr-049-matching-lift-ends-burning-eyes-no-friendly-fire)).
- Enemies don't quietly get stronger: difficulty comes from what you can see,
  not hidden numbers
  ([ADR-053](docs/adr.md#adr-053-an-enemy-kinds-stats-never-scale-with-the-wave)).

## References and inspiration

- Jesse Schell, *The Art of Game Design: A Book of Lenses*, 3rd ed. (CRC
  Press, 2019), read in Chinese translation (2021): experience,
  problem-solving and goals with value inside the game.
- *Buckshot Roulette* and *Lethal Company*: the pixelated picture and its
  tension; *Lethal Company* also the shady-company setting.
- *Titanfall 2*'s Frontier Defense: the main gameplay reference.
- *Escape from Duckov*: the top-down form.
- *Arc Raiders*: an art reference while exploring.
- James Gurney, *Color and Light* (Andrews McMeel, 2010), and his posts on
  gamut masking: the facility's colour system.

What I took from each, with full citations, is in
[ADR-088](docs/adr.md#adr-088-references-and-what-each-one-gave-the-game).
