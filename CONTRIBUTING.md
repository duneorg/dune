# Contributing to Dune

Thanks for your interest in contributing. Here's what you need to know.

## Contributor License Agreement

Before your pull request can be merged, please read the [CLA](CLA.md). By
submitting a PR you confirm that you have read and agree to its terms. No
signature or separate action is required — your submission is your agreement.

## Getting started

```bash
git clone https://github.com/duneorg/dune
cd dune
deno task dev  # starts the docs site at localhost:8080
deno task test # runs the test suite
```

## How work happens here

Non-trivial changes start as an issue, so the tracker shows what is planned,
why, and where help is welcome. Typos, docs fixes and dependency bumps don't
need one.

1. **Open (or find) an issue first.** A good one is written for someone with no
   context: the problem and how you hit it, the evidence, the approach you
   propose, open questions, and what "done" looks like. If you're unsure of the
   design, ask in the issue before building a large change.
2. **Branch from `main`** — never commit to it directly — and open a PR.
3. **Link the issue from the PR.** Use `Fixes #N` when the PR finishes the
   issue (closing it on merge also triggers a "Released in vX.Y.Z" comment when
   the fix is published, so reporters learn when it is actually available). Use
   `Refs #N` when it is one step of several; large changes can land as a stack
   of PRs under one tracking issue.
4. **Separable pieces are open to everyone.** Slices that someone else can pick
   up independently are labelled `help wanted` (or `good first issue` when they
   need little project knowledge). Comment on the issue to claim one.

## Pull requests

- Keep PRs focused — one thing per PR
- Add or update tests for any changed behaviour
- Run `deno task check` before submitting
- Describe what the PR does and why in the description, and link its issue
- If your change might be breaking, check it against [VERSIONING.md](VERSIONING.md)
  before proposing a version bump — not every export/behavior change qualifies

## Reporting issues

Use GitHub Issues; the templates ask for what we need: Deno version
(`deno --version`), a minimal reproduction, and what you expected vs. what
happened. For questions and ideas that aren't bugs, the feature template or a
discussion works too.

## Code style

Follow the patterns already in the codebase. `deno fmt` and `deno lint` are
the enforced standards.
