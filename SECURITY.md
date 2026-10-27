# Security policy

## Reporting a vulnerability

Please report security problems **privately**, not through a public issue, pull
request, discussion or branch.

Use GitHub's private reporting: open the repository's **Security** tab and
choose **Report a vulnerability**. That opens a confidential advisory that only
you and the maintainers can see.

Include what you can of:

- the affected version (`dune --version`) and how you run Dune,
- what the problem is and what an attacker could do with it,
- steps or a minimal example that reproduce it.

You don't need a complete write-up or a fix; a clear description is enough to
start.

## What to expect

We read every report, confirm whether it is a vulnerability, and work on a fix
privately. Details are kept out of public commits, branches and the CHANGELOG
until a fixed release is available. When it ships, the release notes describe
the problem without a step-by-step recipe, and we credit the reporter if they
want that.

## Supported versions

Dune is pre-1.0. Security fixes go into the latest release; older versions are
not patched, so upgrade to the newest version first.

## Not security issues

Ordinary bugs, hardening ideas that have no exploit, and questions belong in the
regular [issue tracker](https://github.com/duneorg/dune/issues).
