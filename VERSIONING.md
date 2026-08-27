# Versioning policy

Dune follows [Semantic Versioning](https://semver.org). This document defines what
"breaking" actually means for `@dune/core` (and, by the same standard, first-party
plugins and themes), so that classification is a checklist rather than a judgment
call made fresh every release.

## What counts as breaking

A change is breaking if it fails **either** of these two tests:

### 1. The contract test

Something is removed, renamed, or incompatibly changed in the explicitly-designated
stable surface: hook types (`DunePlugin`, `MountApi`, etc.), `bootstrap()`'s call
signature, the `site.yaml`/config schema, CLI command names and flags, and the
subpath exports meant for plugin/theme authors to depend on (`@dune/core/hooks`,
`/config`, `/storage`, `/search`, and similarly-documented subpaths).

Internal implementation files that happen to be technically importable but were
never part of the documented, advertised surface do not count — changing them is
not a contract break just because someone theoretically could have reached in.

### 2. The working-site test

An existing, **unmodified** site — same config, same content, same data already on
disk — stops working or loses data as a **direct result of upgrading alone**:

- a site that previously booted now fails to boot,
- a request that previously served successfully now fails,
- data that was previously valid on disk is now silently lost or misread.

**Explicit carve-outs — these do NOT trigger the working-site test, even though the
observable output changes:**

- **Bug fixes that correct behavior contradicting what was already documented.**
  The old behavior was never the real contract, just a bug; fixing it is not
  breaking even if some caller was relying on the wrong output.
- **Additions and opt-in features.** Nothing that requires the operator to newly
  opt in can fail this test by definition — it only adds an option, it doesn't
  change what unmodified configs do.
- **Security fixes**, by convention, even when they technically change behavior
  (e.g. closing an auth bypass). Shipping the fix matters more than version-bump
  purity, and "the previous behavior was a vulnerability" is a different kind of
  claim than "the previous behavior was a documented feature."

The test only fires when something that *used to work as documented* stops
working, or data that *was valid* gets corrupted — not when something that was
already wrong gets corrected, and not when new capability is added.

## Everything else

Applies from `1.0.0` onward:

- **Minor**: passes both tests above but adds anything — new exports, new hooks,
  new CLI commands, internal refactors, deprecate-with-a-shim (the shim itself
  keeps old callers working; only the eventual removal of the shim is a candidate
  for the contract test, in a later release).
- **Patch**: pure bug/security fixes with no surface or working-site impact.

## Before 1.0.0

Before `1.0.0`, the split above doesn't apply — there's no major version to
escalate a real break to, so **Minor is reserved for breaking changes only**:

- **Minor**: fails either test above (the contract test or the working-site
  test). This is the pre-1.0 stand-in for what becomes a major bump once the
  library is stable — the version number itself is the signal that something
  in this release broke an existing, unmodified site or its documented
  surface, and the changelog should be read before upgrading.
- **Patch**: passes both tests — everything else, with no exception. A pure
  fix, a security fix, a pin bump, an internal refactor, *and a genuine new
  feature or export* are all Patch pre-1.0. Adding something does not by
  itself earn Minor before `1.0.0`, unlike the rule above.

The point of this split is that a pre-1.0 Patch release should be safe to take
without reading anything — if it isn't, it was misclassified, not the rule's
fault. Classify by actually running both tests (especially the working-site
test — passing the local test suite is not sufficient proof, see the note in
memory on why `jsr:`-resolved bugs are invisible to local testing) before
picking Minor vs. Patch; don't default to Minor because a release happens to
add something.

## Applies beyond core

The same two tests apply to first-party plugins and themes, not just
`@dune/core` itself — a plugin's own exported types and hooks get the contract
test; a plugin's effect on an existing site's data or behavior gets the
working-site test.
