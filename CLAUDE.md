# Your harness

This file is yours, and it arrives empty on purpose. The rules you hold the
agent to are part of what gets marked, so they should be rules you decided on.

Nothing about the template is recorded here. What the repo ships is explained
where it lives --- `fly.toml`, the `Dockerfile`, the CI workflow and
`spec/README.md` each say what they fix --- and the course website publishes the
[final project brief](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/).
What the agent needs to carry from any of it is your call.

## README.md / PROCESS.md authorship

These two files should read in my own voice (course guidance: AI-generated
prose here gets flagged as "median" output and marked down). The rule is
about *inventing* content, not about who types it:

- If I haven't told you what a section should say, give me a skeleton
  (headings, bullet prompts, structure) and leave the prose to me.
- If I've already dictated the actual points/content (e.g. "put these three
  decisions in, write them up"), formalizing that into full prose is fine --
  that's not you making things up, it's you writing down what I already said.

The distinction that matters: did the content originate from me, or did you
invent it. Only the latter is off-limits.

## ADR drafting

Architecture decisions get discussed here before they get written up properly.
When a design discussion reaches a decision point (an option chosen, and the
reason I gave for it), log it to `.claude/notes/adr-draft.md` --- background,
options considered, what was picked, and why, in my own words where possible.
That file lives under `.claude/`, which is already gitignored, so it never
gets pushed; it's scratch material for writing the real ADRs from later, not
a deliverable itself.

## Art and interaction rules

Every model, colour and control is held to
[`docs/art-and-interaction.md`](docs/art-and-interaction.md). Read it before
adding or changing any asset or input, and run its interaction checklist
before calling a mechanic done.

## Spending the course budget

The weekly budget is shared by everything in this repo, so cost is a
constraint like any other. What actually burns it (measured 2026-10-08) is a
long context re-read after its cache expires: one resumed 400k-token session
cost $1.70 in a single request. Images and file reads matter far less.

- **Don't let a long session go cold.** The prompt cache lapses after ~5
  minutes idle. For a new topic, or after a break, suggest a fresh session
  with a short handoff (or `/compact` first) instead of resuming a huge one.
- **Match the model to the work.** Design, art judgement and tricky
  refactors warrant the strongest model; routine work (commits, small edits,
  running checks, balance lookups) doesn't --- suggest `/model` down when a
  stretch of routine work starts.
- **Subagents get the cheapest model that can do the job.** Pass `model:
  "haiku"` or `"sonnet"` for broad code searches, web research, running
  tests/reading logs and summarising, and precisely specified mechanical
  edits. Keep judgement (design decisions, how a model looks, weighing
  trade-offs) in the main conversation.
- **But don't delegate tiny tasks.** Every subagent pays its own start-up
  cost; a lookup in a known file is cheaper done directly.
- **Screenshots split by purpose.** Verification shots with a concrete
  checklist ("is the yard fully visible, is the floor text legible, any
  errors, is the preview red") go to a cheap subagent that reports back in
  words, so the image never enters the main context. Aesthetic review stays
  in the main conversation, cropped to what needs judging. For repeated
  checks, continue the same subagent with SendMessage rather than spawning
  a new one each time.
- **Don't re-read files already in context, and keep replies compact.**

## Committing

Commit on your own; don't wait to be asked. Once a change is finished and
verified (`pnpm check` green, plus whatever screenshot or repro the change
needed), commit it locally with a message that says what changed and why.
One logical change per commit. Pushing is different: a push to `main`
deploys the live game, so never push unless I say so.

## Session handoff

`.claude/notes/handoff.md` (gitignored, local only) is the agent's own
handoff: current state, where things live, open decisions, verify recipes.
It's written for an agent, not for me --- terse, facts over prose.

- **Read it first** at the start of every session.
- **Keep it current**: update it after every commit, every decision I make,
  and whenever a task finishes or changes direction --- not just at the end.
  Always before suggesting `/clear`, `/compact` or a new session.
- Overwrite stale lines rather than appending history (decision history
  belongs in the ADR draft); keep it short enough to read in one go.
