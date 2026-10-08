# Art and interaction rules

The rules every model, colour and control in this game is held to. They
exist so the look stays one look as assets get added, and so nothing gets
built that's beyond what can be made reliably in code.

## Art: low poly, built in code

**One material, flat shading, vertex colour.** Every model is coloured
primitive parts merged into one geometry and drawn with the shared material
in [`client/models/kit.ts`](../client/models/kit.ts) (`flatShading`,
`vertexColors`, roughness 1, metalness 0). No textures, no per-model
materials. Exceptions, and only these: unlit effects (projectiles), the
hover highlight, the placement preview, and the floor guide decals.

**Colour only from the palette.** [`shared/palette.ts`](../shared/palette.ts)
is the single source. Environment tokens have shade/base/light values; a
model gets depth by choosing among them, never by writing its own hex.

**Saturation is a signal.** The environment (ground, rock, wood, foliage,
walls) stays low-to-mid saturation. Only players and things you can act on
are saturated. Accent yellow means "you can act on this", danger orange
means "you can't" --- nothing else uses those hues, players included.

**Consistent density.** Radial segments 5--8; spheres are icosahedra at
detail 0--1. A smooth 32-segment sphere next to a 6-sided cone breaks the
style more than any colour choice.

**Budgets (triangles):** character 150--400 · handheld item 20--150 ·
crate 40--150 · rock 20--120 · tree 40--120. Draw calls matter more than
triangles: merge static scenery, use `InstancedMesh` for repeated props,
stay under ~100 draw calls.

**Designed for the camera.** The camera looks straight down from 22 units,
so about 53 px per world unit at 1080p. What reads is the top outline,
value contrast against the ground, and the cast shadow --- not side detail.

- Anything under ~0.15 units won't show; don't model it.
- Facing must show from the top outline alone (visor forward, backpack
  behind), at least ~0.3 units of asymmetry.
- Objects whose identity lives in their side profile are laid so the
  profile faces up when they're *lying in the world* (a gun on the ground
  lies on its side).
- But common sense beats camera-readability: a held item is held the way a
  person really holds it (a rifle upright, top up), even though that shows
  less of it from above.
- Nothing should read as a culturally specific costume by accident. A
  dome over the head with a band around it reads as a headscarf from
  above; characters are dressed casually (cap, T-shirt, jeans).
- Oversize small props a little when their features wouldn't survive at
  true scale (the M4A1 is ~1.3 long).

**Recognisable, not detailed.** An object should be identifiable from a few
signature features. The M4A1 is barrel + A-frame front sight + handguard +
carry handle + pistol grip + curved magazine + collapsible stock, nothing
finer.

**Depth from value and shadow, not fog.** Distance fog is useless from
straight overhead (every ground point is about the same distance away). The
background is the palette's darkest far layer; height reads through lighter
tops and the sun's sideways shadows.

**Randomness is seeded.** Rocks, trees and ground tones come from `rng(seed)`
so every client builds the identical world.

**Stay in reach.** Build from boxes, low-segment cylinders/cones,
icosahedra/dodecahedra, extruded flat profiles (`profile()` in the kit) and
seeded vertex jitter. Animate by transforms only (bob, spin, recoil). Out of
bounds: sculpted organic shapes (faces, hands, animals), rigged or skinned
animation, UV textures and normal maps.

**Review every new asset in the model sheet** (`/gallery.html` on the dev
server), especially its "overhead, game scale" column, before it goes in.

## Interaction: the obvious things, never missing

**Anything you can act on shows it.** Hovering a pickup that's in reach
highlights it unmistakably (outline + glow, pointer cursor). Hovering one
that's out of reach still responds, differently, and says why ("move
closer") --- silence reads as "not interactive".

**Every refused action says so.** Clicking an invalid placement, firing
where firing isn't allowed: a visible reaction and, where it isn't obvious,
a short reason. Never a click that does nothing.

**Respect the hands.** The left hand is on WASD, so its only extra keys are
the thumb's Space and an occasional Q. The right hand aims and clicks. A
frequent action never goes on a key that pulls a finger off WASD.

**Trackpads are first-class.** Many players are on a laptop trackpad, so:
no hold-to-act, no drag-to-act, and nothing that needs a right button.
Every right-click action also has Space, and Mac ctrl+click is treated as a
right-click (not as a left click as well).

**The world explains itself.** Boundaries are visible (no invisible walls),
your own character is easy to find, the controls for what you're holding
are on screen, and new players learn from guides painted on the floor next
to the thing they're about.

**Before calling any mechanic done, check:** cursor, hover state, success
feedback, failure feedback and reason, what happens at the edges (out of
range, dead, disconnected, someone else got there first), and whether it
works on a trackpad.
