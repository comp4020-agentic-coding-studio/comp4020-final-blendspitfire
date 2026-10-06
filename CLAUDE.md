# Your harness

This file is yours, and it arrives empty on purpose. The rules you hold the
agent to are part of what gets marked, so they should be rules you decided on.

Nothing about the template is recorded here. What the repo ships is explained
where it lives --- `fly.toml`, the `Dockerfile`, the CI workflow and
`spec/README.md` each say what they fix --- and the course website publishes the
[final project brief](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/).
What the agent needs to carry from any of it is your call.

## ADR drafting

Architecture decisions get discussed here before they get written up properly.
When a design discussion reaches a decision point (an option chosen, and the
reason I gave for it), log it to `.claude/notes/adr-draft.md` --- background,
options considered, what was picked, and why, in my own words where possible.
That file lives under `.claude/`, which is already gitignored, so it never
gets pushed; it's scratch material for writing the real ADRs from later, not
a deliverable itself.
