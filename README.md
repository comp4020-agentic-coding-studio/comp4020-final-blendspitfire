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

- Open the page, type a name (or leave it blank for a codename), and join a
  site or start a new one. A site holds up to four; send a friend the link in
  the address bar and they land in the same site.
- To see the multiplayer side, open a second window (an incognito one counts)
  and join the same site.
- First-time players start in a tutorial, then fly back to the surface by
  helicopter.
- **WASD** to move, **mouse** to aim; **left-click or Space** to fire (hold for
  automatic); **E** to use (lift, shop, reactor); **Q** to drop what you're
  holding; **G** to ready a grenade, then click to throw; **X** to vote ready
  in the break between waves; **M** to mute; **Esc** for the menu.
- Pick up a rifle on the surface, take the lift down, press E at the reactor
  to start it, hold out for six waves, then leave on the freight lift.

## What counts as good, to me

My design thinking is influenced by *The Art of Game Design* (Schell). My
reading of some of its ideas is that a game should give players a problem to
solve, and its goals should have value inside the game. Here the problem is
the threat of the monsters, and protecting the reactor matters because of the
recovery job: it powers the lift that carries the goods out.

What I value most is the fun of co-operation itself, and immersion. Players
should know the shared goal and be able to face the pressure together; the
carefully tuned art, lighting and sound give the job a sense of being there.
Sound is in, but because of time it's less polished than the art. If players
don't know where to go, mistake teammates for enemies, or the fighting has no
pressure, then even with every feature working, the experience hasn't reached
my goal.

Controls should be clear with immediate feedback, and should look after
players on a trackpad. The picture should run smoothly, never broken by
performance problems, and above all there must be no serious bug that stops
play.

## What the checks enforce, and what can only be judged

Enforced by automatic checks in `spec/`:

- Players in two browsers are told apart; the same person coming back is the
  same person; nobody can take what another player is holding.
- Different sites can't see each other; a site holds at most four.
- An enemy's stats never quietly change with the wave; a tougher enemy always
  looks different.
- Turrets can't seal off a passage entirely.
- In the tutorial, one player's shots never affect another player's targets.
- The server survives malformed messages and floods, and a client can't
  teleport.

Held by rules, but in the end judged by eye: models, colours and controls
follow [`docs/art-and-interaction.md`](docs/art-and-interaction.md) (for
example, a held gun is gripped the normal way, trackpads are first-class, and
vivid colour is kept for things that glow).

Only playtesting can judge: whether co-operation is fun, whether the setting
draws people in, and whether players know what to do next.

## What I chose not to build

- No long-term progression or replay loop: for the reasons above, even if I
  built it, probably nobody would actually play through it, so it's better as
  one visit that's complete in itself than a game that needs long commitment.
- No complex roles or co-ordination that needs several people acting at once:
  another person means more firepower and another direction covered; "1+1=2"
  is enough. Complex co-op mechanics also cost players more to pick up.
- No accounts or logins: a name is only for the leaderboard. It's simpler.
- No friendly fire: teammates are never against each other. The picture is
  deliberately blurry, so telling friend from foe is hard, there are a lot of
  monsters and players' fire is dense. I like games with friendly fire myself,
  but leaving it out fits the "theme-park ride" idea better.
- Enemies don't quietly get stronger: difficulty comes from what you can see
  (how many, what kind), not hidden numbers. This is also a personal
  preference; I don't like stat changes you can't see.

## References and inspiration

- Jesse Schell, *The Art of Game Design: A Book of Lenses*, 3rd ed. (CRC
  Press, 2019); read in Chinese as 《游戏设计艺术（第3版）》, trans. 刘嘉俊 et
  al. (Publishing House of Electronics Industry, 2021). The ideas of
  experience, problem-solving and goals with value inside the game; these are
  my readings of it.
- *Buckshot Roulette* and *Lethal Company*: a pixelated picture lets players
  imagine the detail the models lack, and builds tension. The game itself
  isn't meant as horror. *Lethal Company* also inspired the setting of
  recovering assets for a shady company.
- *Titanfall 2*'s Frontier Defense: the main gameplay reference, activating an
  objective, protecting it and surviving.
- *Escape from Duckov*: showed me a top-down twin-stick game can carry
  something light with a story; a fixed viewing distance also lowers how much
  detail the models need.
- *Arc Raiders*: a sci-fi post-apocalyptic reference used while exploring the
  art and prompting, not something the final picture copies.
- James Gurney, *Color and Light: A Guide for the Realist Painter* (Andrews
  McMeel, 2010), and his posts on gamut masking
  ([Color wheel masking](http://gurneyjourney.blogspot.com/2008/01/color-wheel-masking-part-1.html),
  [Gamut masking method](http://gurneyjourney.blogspot.com/2011/09/part-1-gamut-masking-method.html)):
  the basis of the facility's colour system, many hues all greyed into one
  family, with only things that glow allowed to be vivid.
