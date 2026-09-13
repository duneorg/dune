# Dune CMS — Production Dockerfile
#
# Build: docker build -t dune .
# Run:   docker run -p 3000:3000 -v ./my-site:/site dune
#
# The site root is mounted at /site. The container runs `dune serve`
# on port 3000 by default.

FROM denoland/deno:2.9.6

WORKDIR /app

# @dune/core self-resolves a dependency's `jsr:@dune/core` imports (e.g.
# @dune/plugin-admin's own imports of this same package) back onto this
# checkout's local src/ instead of fetching it from JSR — a `deno install`
# run before src/ exists in the build context fails with "Module not found
# file:///app/src/...". So src/ must be copied before `deno install`, not
# after. This "cache dependencies first" ordering looked reasonable but has
# been broken since the Dockerfile was added (2026-02-13) — never caught
# because nothing ran `docker build` in CI.
COPY deno.json deno.lock* ./
COPY src/ src/
RUN deno install

# Run as the base image's own non-root `deno` user rather than creating a
# new one — it already owns /deno-dir (the npm/JSR cache), which a site's
# own runtime imports need to write to on first request. But the `deno
# install` above ran as root (before this USER switch) and left
# /deno-dir/npm itself owned by root, orphaned inside the otherwise
# deno-owned /deno-dir — re-chown it explicitly or the site's first request
# fails caching its own npm deps with "Permission denied".
RUN mkdir -p /site && chown -R deno:deno /site /app /deno-dir

USER deno

# Site root is expected as a volume mount at /site
VOLUME /site

EXPOSE 3000

# Health check using the /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["deno", "run", "-A", "src/cli.ts", "serve", "--root", "/site", "--port", "3000"]
