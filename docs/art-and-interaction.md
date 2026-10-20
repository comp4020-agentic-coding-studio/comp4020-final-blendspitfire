# Art and interaction rules

The rules every model, colour and control in this game is held to. They
exist so the look stays one look as assets get added, and so nothing gets
built that's beyond what can be made reliably in code.

## Art: low poly, built in code

**The surface is exempt.** Everything in this section governs the
underground facility and the lift car. The garden on the surface
(`client/world/surface.ts`) deliberately follows none of it: it aims for a
bright, soft impressionist painting --- its own colours, its own materials,
a sun with shadows, and its own grade (the "paint" pass in
`client/postprocess.ts`). Characters, items and the UI are shared by both
levels and stay under these rules.

**A few shared materials, flat shading, vertex colour.** Every model is
coloured primitive parts merged into one geometry per finish, drawn with
the shared materials in [`client/models/kit.ts`](../client/models/kit.ts):
`matte` (paint, concrete, fabric), `tile` (sealed floors), `glossy` (bare
metal) and `emissive` (lamps, LEDs, screens --- unlit). No textures, no
per-model materials. Other exceptions, and only these: projectiles, the
hover highlight, the placement preview, and the floor guide decals.

**Colour comes from the palette, in three kinds.**
[`shared/palette.ts`](../shared/palette.ts) is the single source.
- *Surfaces* --- what things are made of --- all sit inside one gamut:
  OKLCH chroma ≤ 0.06 (about Munsell chroma 2--3) and lightness 0.26--0.82
  (real-world albedo, about sRGB 45--200). Many hues, none loud: an oxide
  wall is a greyed deep red. Each swatch is one hue at three lightness
  steps with hue and chroma held still; neutrals lean toward one cool
  "mother" grey so they hold together. (Gamut masking after James Gurney;
  albedo range from PBR practice; real surfaces can't be very saturated.)
- *Emitters* --- lamps, indicator LEDs, screens, the reactor, a player's
  shoulder lamp --- are the only things allowed outside the gamut.
- *Lights* are set by colour temperature, white-balanced to 4500K. Each
  zone has one dominant temperature (lift car: warm tungsten; corridor and
  lab: cool fluorescent; server hall: cold LED; core: sodium by the
  reactor against cool tubes), so most of the scene's hue variety comes
  from the light, not the paint.
- UI signals (cyan "can act", red "can't", green "will work") and player
  colours only ever appear as UI or as an emitter.

`spec/assets.test.ts` fails any registered model with a non-emissive
colour outside the gamut, and any palette swatch outside it.

**The grade is separate from the models.** Exposure, contrast,
saturation, shadow/highlight tint, vignette and dither live in
[`client/assets/grade.ts`](../client/assets/grade.ts) and are applied once
to the whole frame (`client/postprocess.ts`). Tune the look there; no
model needs rebuilding.

**Lighting.** Underground: no sun, a very dim cold ambient, and the lamps
in [`client/world/dressing.ts`](../client/world/dressing.ts). A fixed pool
of 8 point lights (no shadows) follows the lamps the player can see; every
lamp also has a halo, so lamps outside the pool still read. The camera
looks down through the ceiling, so nothing is drawn hanging from it: put
a lamp on a wall where a wall can light the space (corridors, passages,
room margins), and where only an overhead light will do, keep the light
but draw no fixture --- its halo is a faint pool on the floor. The
player's torch is the only shadow-casting light, and it sits where a real
light would be worn (a headlamp at the cap brim's front edge), never
inside the body: from a point inside, the character's own geometry throws
shadows no real light could. Don't fix self-shadowing by switching shadows
off; move the light. Keep floors and walls
mid-dark so light pools instead of washing the room.

**Line of sight.** What the player can't see is black: other rooms, the
far side of tall fixtures, and every wall top (`client/visibility.ts`).
Walls are dressed on their room-facing faces only. Fixtures with half-height
≥ 0.95 block sight; lower ones are seen over.

**Consistent density.** Radial segments 5--10; spheres are icosahedra at
detail 0--1. A smooth 32-segment sphere next to a 6-sided cone breaks the
style more than any colour choice.

**Budgets (triangles)**, enforced per category by `spec/assets.test.ts`
from [`client/models/registry.ts`](../client/models/registry.ts):
character 700 · character carrying 1000 · handheld 300 · item 260 ·
fixture 1400. Draw calls matter more than triangles: the facility is
merged into one mesh per finish.

**Every asset is registered.** A new model goes into
`client/models/registry.ts` --- that puts it in the model sheet and under
the budget and gamut tests.

**Designed for the camera.** The camera looks straight down from 16 units,
so about 72 px per world unit at 1080p. What reads is the top outline,
value contrast against the floor, and light --- not side detail.

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

**Depth from light and value, not fog.** Distance fog is useless from
straight overhead (every floor point is about the same distance away).
Depth reads through pools of lamp light, the torch's moving shadows, and
the black of what's out of sight.

**Randomness is seeded.** Rubble, floor tones and clutter come from
`rng(seed)` so every client builds the identical world.

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

**Respect the hands.** The left hand is on WASD and the right hand aims and
clicks. Never require holding a key while moving: Space, Q and E are taps,
one press per action, so they work mid-stride.

**Prompts float on the thing.** Whatever E would act on gets a prompt
pinned to it (`client/ui/prompts.ts`): white when it'll work, grey with the
reason when it won't, growing out of the object and folding back into it.
All UI is the same thin white/grey line-work (`public/index.html`).

**Trackpads are first-class.** Many players are on a laptop trackpad, so:
no hold-to-act, no drag-to-act, and nothing that needs a right button.
Every right-click action also has Space, and Mac ctrl+click is treated as a
right-click (not as a left click as well).

**The world explains itself.** Boundaries are visible (no invisible walls),
your own character is easy to find (a ring at your feet, and your shoulder
lamp in the dark), the controls for what you're holding are on screen, and
new players learn from guides painted on the floor next to the thing
they're about. One-way things say so before you commit: the lift's prompt says
where it goes, and once an attempt is on, its prompt at the bottom says
it's locked.

**Before calling any mechanic done, check:** cursor, hover state, success
feedback, failure feedback and reason, what happens at the edges (out of
range, dead, disconnected, someone else got there first), and whether it
works on a trackpad.
