# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

# Dependencies (better-sqlite3 compiles a native module)
FROM base AS deps
# Build tools are only a fallback: better-sqlite3 usually downloads a prebuilt binary.
ARG SKIP_BUILD_TOOLS=
RUN [ -n "$SKIP_BUILD_TOOLS" ] || (apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 DATA_DIR=/data
RUN groupadd -g 1001 app && useradd -u 1001 -g app -m app && mkdir -p /data && chown app:app /data
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
