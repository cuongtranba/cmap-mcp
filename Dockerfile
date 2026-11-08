# syntax=docker/dockerfile:1

# Build stage: install with the committed lockfile and bundle dist/cli.js.
FROM oven/bun:1.4.2 AS build
WORKDIR /src
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN bun run build
# The cache directory must exist and be writable by the non-root runtime user.
RUN mkdir /data

# Runtime stage: distroless Bun, no shell. dist/cli.js bundles every dependency
# (only node: built-ins stay external), so nothing else is copied.
FROM oven/bun:1.4.2-distroless
WORKDIR /app
COPY --from=build /src/dist/cli.js ./dist/cli.js
COPY --from=build --chown=65532:65532 /data /data
ENV CMAP_CACHE_DIR=/data
USER 65532:65532
VOLUME /data
EXPOSE 8787
# No curl in distroless, so the check runs Bun itself.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/usr/local/bin/bun", "-e", "fetch('http://127.0.0.1:8787/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["/usr/local/bin/bun", "/app/dist/cli.js"]
CMD ["mcp", "--http", "0.0.0.0:8787"]
