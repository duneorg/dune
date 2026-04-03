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

## Pull requests

- Keep PRs focused — one thing per PR
- Add or update tests for any changed behaviour
- Run `deno task check` before submitting
- Describe what the PR does and why in the description

## Reporting issues

Use GitHub Issues. Include Deno version (`deno --version`), a minimal
reproduction, and what you expected vs. what happened.

## Code style

Follow the patterns already in the codebase. `deno fmt` and `deno lint` are
the enforced standards.
