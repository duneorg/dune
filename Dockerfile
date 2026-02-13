# Dune CMS — Production Dockerfile
#
# Build: docker build -t dune .
# Run:   docker run -p 3000:3000 -v ./my-site:/site dune
#
# The site root is mounted at /site. The container runs `dune serve`
# on port 3000 by default.

FROM denoland/deno:2.1.4

WORKDIR /app

# Cache dependencies by copying config first
COPY deno.json deno.lock* ./
RUN deno install

# Copy source
COPY src/ src/

# Create a non-root user for security
RUN adduser --disabled-password --gecos "" dune \
    && mkdir -p /site \
    && chown -R dune:dune /site /app

USER dune

# Site root is expected as a volume mount at /site
VOLUME /site

EXPOSE 3000

# Health check using the /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["deno", "run", "-A", "src/cli.ts", "serve", "--root", "/site", "--port", "3000"]
