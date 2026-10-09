FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS compiler
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libc6-dev meson ninja-build pkg-config libcap-dev python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /source
COPY deploy/codex-attribution/bubblewrap-source.tar.gz /source/
COPY scripts/src/testing/vendor-proc/prepare-source.py /source/
COPY scripts/src/testing/vendor-proc/command-filter.c /source/
COPY scripts/src/testing/vendor-proc/proc-info-guard.c scripts/src/testing/vendor-proc/proc-info-guard-test.c /source/
COPY deploy/coding-helpers.json /source/helpers-expected.json
RUN gcc -Wall -Wextra -Werror /source/proc-info-guard-test.c -o /source/proc-info-guard-test \
    && /source/proc-info-guard-test \
    && python3 /source/prepare-source.py \
    && python3 -c 'import json; expected=json.load(open("/source/helpers-expected.json")); actual=json.load(open("/source/provenance.json")); fields=["archiveSha256","changedSourceSha256","filteredSourceSha256","commandFilterSha256","procInformationGuardSha256"]; assert all(actual[key]==expected[key] for key in fields)' \
    && (meson setup /source/build-red /source/tree/bubblewrap --buildtype=release -Dtests=false -Dsupport_setuid=false -Dselinux=disabled -Dman=disabled -Dbash_completion=disabled -Dzsh_completion=disabled || { cat /source/build-red/meson-logs/meson-log.txt; exit 1; }) \
    && ninja -C /source/build-red \
    && cp /source/tree/bubblewrap.c.modified /source/tree/bubblewrap/bubblewrap.c \
    && (meson setup /source/build-green /source/tree/bubblewrap --buildtype=release -Dtests=false -Dsupport_setuid=false -Dselinux=disabled -Dman=disabled -Dbash_completion=disabled -Dzsh_completion=disabled || { cat /source/build-green/meson-logs/meson-log.txt; exit 1; }) \
    && ninja -C /source/build-green \
    && cp /source/tree/bubblewrap.c.filtered /source/tree/bubblewrap/bubblewrap.c \
    && (meson setup /source/build-filtered /source/tree/bubblewrap --buildtype=release -Dtests=false -Dsupport_setuid=false -Dselinux=disabled -Dman=disabled -Dbash_completion=disabled -Dzsh_completion=disabled || { cat /source/build-filtered/meson-logs/meson-log.txt; exit 1; }) \
    && ninja -C /source/build-filtered \
    && sha256sum /source/build-red/bwrap /source/build-green/bwrap /source/build-filtered/bwrap > /source/binary-sha256.txt \
    && gcc --version > /source/compiler-version.txt \
    && dpkg-query -W gcc libc6-dev libcap-dev libcap2 meson ninja-build pkg-config python3 > /source/build-packages.txt


FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS build

WORKDIR /app
ENV CI=true

RUN corepack enable && corepack prepare pnpm@10.17.1 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm run build
RUN pnpm --filter @workspace/api-server deploy --prod --legacy /prod/api

FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS runtime

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
COPY --from=build --chown=node:node /app/artifacts/api-server/start.mjs /app/artifacts/api-server/start-worker.mjs /app/artifacts/api-server/start-chatgpt.mjs /app/artifacts/api-server/load-workspace-env.mjs /app/artifacts/api-server/load-secret-env.mjs ./artifacts/api-server/
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

# Explicit optional x64 coding image. Ordinary builds keep the smaller runtime
# and the native capability disabled. Archive scripts/authentication never run.
FROM runtime AS coding-runtime

USER root
COPY scripts/src/testing/install-codex-linux-fixture.py /tmp/install-codex-linux.py
COPY deploy/codex-attribution /usr/share/doc/agentic-codex
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 libcap2 \
    && rm -rf /var/lib/apt/lists/* \
    && python3 /tmp/install-codex-linux.py --image-runtime \
    && install -o root -g root -m 0555 /opt/agentic-codex/codex-resources/bwrap /usr/bin/bwrap \
    && rm /tmp/install-codex-linux.py
COPY --from=compiler --chmod=0555 /source/build-green/bwrap /usr/bin/bwrap
COPY --from=compiler --chmod=0555 /source/build-filtered/bwrap /opt/agentic-inner/bwrap
COPY --from=compiler /source/provenance.json /source/binary-sha256.txt /source/compiler-version.txt /source/build-packages.txt /usr/share/doc/acos-proc-vendor-probe/
COPY deploy/coding-helpers.json /usr/share/doc/acos-proc-vendor-probe/helpers.json
COPY deploy/agentic-coding.apparmor /usr/share/doc/acos-proc-vendor-probe/agentic-coding.apparmor
COPY scripts/src/testing/vendor-proc/prepare-source.py scripts/src/testing/vendor-proc/command-filter.c scripts/src/testing/vendor-proc/proc-info-guard.c /usr/share/doc/acos-proc-vendor-probe/
COPY scripts/src/testing/vendor-proc/proc-info-guard-test.c /usr/share/doc/acos-proc-vendor-probe/
RUN chmod 0444 /usr/share/doc/acos-proc-vendor-probe/helpers.json \
    && echo 'd614afff26b5f4f2250f432876399dc95ed2e8c04dbf6dbece3a067d9c7cacb7  /usr/bin/bwrap' | sha256sum --check --strict \
    && echo '9f5789651eb95860fe3242745513a177029983e7a208854529ae7dc23aaf0eb9  /opt/agentic-inner/bwrap' | sha256sum --check --strict
ENV ACOS_CODEX_EXECUTABLE=/opt/agentic-codex/bin/codex
USER node

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
