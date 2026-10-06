<!-- Skeleton only — fill in the prose yourself. Rewritten (not appended to)
     at each crit. Target 900–1100 words. Can link to ADRs; raw material for
     those is in .claude/notes/adr-draft.md (gitignored, not published) —
     this is where the decisions and your reasoning from our conversation are
     already written down, so writing the real ADRs/this file should mostly
     be editing that material into shape rather than starting from scratch. -->

# Process

## What this app is, and the stack behind it

<!-- Short recap of the app concept, then: Node 24 (TS run directly, no
     build step for the server) + ws + node:sqlite + Three.js on the client,
     bundled with esbuild. Say *why*, not just *what* — the real constraints
     were: 256MB/1 shared vCPU single Fly machine, no separate DB service,
     and wanting the dev process to reuse one toolchain rather than bolt on
     a second one. -->

## Decisions and trade-offs

<!-- Pull from .claude/notes/adr-draft.md. At minimum, the ones worth
     writing up as real decisions:
     - game vs tool, and why a game
     - 3D over 2D (the art-skill argument: simple 3D geometry + lighting
       reads as "designed", simple 2D geometry reads as a placeholder)
     - architecture doesn't cap players per room, even though the server
       itself has a natural ceiling
     - fixed/follow camera and no physics, specifically to keep this
       crit's scope achievable by the cutoff
     - sqlite over a "real" database, given there's no separate DB service
       available anyway -->

## What's first-draft and likely to change

<!-- Acknowledge this stack/scope choice is for crit 8 specifically; what's
     explicitly deferred to weeks 9–11 (richer interaction between players,
     logging, etc.) -->

## Commit evidence

<!-- Link the commits that show the incremental process. A link's text is
     the commit hash itself (short or full), e.g. a markdown link whose
     label is just the hash, pointing at this repo's /commit/<hash> page. -->
