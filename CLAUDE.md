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
