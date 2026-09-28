FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build

WORKDIR /app
ENV CI=true

RUN corepack enable && corepack prepare pnpm@10.17.1 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm run build
RUN pnpm --filter @workspace/api-server deploy --prod --legacy /prod/api

FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5000 \
    SERVE_STATIC_UI=true \
    STATIC_UI_DIR=/app/ui \
    XDG_CONFIG_HOME=/tmp/agentic-config \
    XDG_CACHE_HOME=/tmp/agentic-cache \
    AGENT_BROWSER_CHANNEL=chromium \
    AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium \
    AGENT_BROWSER_HEADLESS=true

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates chromium curl git tini \
    && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@10.17.1 --ignore-scripts

WORKDIR /app
COPY --from=build --chown=node:node /prod/api/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build --chown=node:node /app/artifacts/api-server/package.json ./artifacts/api-server/package.json
COPY --from=build --chown=node:node /app/artifacts/api-server/start.mjs /app/artifacts/api-server/start-worker.mjs /app/artifacts/api-server/load-workspace-env.mjs /app/artifacts/api-server/load-secret-env.mjs ./artifacts/api-server/
COPY --from=build --chown=node:node /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=build --chown=node:node /app/artifacts/agentic-company-os/dist/public ./ui

RUN mkdir -p /app/data /app/agent-sandboxes \
    && chown -R node:node /app/data /app/agent-sandboxes \
    && test ! -e /app/node_modules/typescript \
    && test ! -e /app/node_modules/tsx \
    && test ! -e /app/node_modules/esbuild \
    && test ! -e /app/node_modules/vite

USER node
EXPOSE 5000
VOLUME ["/app/data", "/app/agent-sandboxes"]

HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD curl --fail --silent http://127.0.0.1:5000/api/readyz >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "artifacts/api-server/start.mjs"]

# Synthetic endurance execution is deliberately unavailable in the ordinary
# production image. The dedicated target carries a root-owned, immutable build
# attestation which the runtime verifies before accepting soak-only fixtures.
FROM runtime AS endurance-runtime

ARG ENDURANCE_SOURCE_COMMIT_SHA
ARG ENDURANCE_SOURCE_TREE_SHA256

USER root
RUN printf '%s' "$ENDURANCE_SOURCE_COMMIT_SHA" | grep -Eq '^[a-f0-9]{40}([a-f0-9]{24})?$' \
    && printf '%s' "$ENDURANCE_SOURCE_TREE_SHA256" | grep -Eq '^[a-f0-9]{64}$' \
    && install -o root -g root -m 0444 /dev/null /app/.agentic-endurance-runtime
LABEL org.opencontainers.image.revision="$ENDURANCE_SOURCE_COMMIT_SHA" \
      com.agentic-company-os.source-tree-sha256="$ENDURANCE_SOURCE_TREE_SHA256"
USER node

# Keep the ordinary production runtime as Docker's default final target. This
# prevents an unqualified `docker build` from inheriting the endurance marker.
FROM runtime AS production-runtime
