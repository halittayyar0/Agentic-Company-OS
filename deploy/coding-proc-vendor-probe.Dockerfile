FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS compiler
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libc6-dev meson ninja-build pkg-config libcap-dev python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /source
COPY deploy/codex-attribution/bubblewrap-source.tar.gz /source/
COPY scripts/src/testing/vendor-proc/prepare-source.py /source/
COPY scripts/src/testing/vendor-proc/command-filter.c /source/
RUN python3 /source/prepare-source.py \
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

FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS probe
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 libcap2 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=compiler /source/provenance.json /source/binary-sha256.txt /source/compiler-version.txt /source/build-packages.txt /usr/share/doc/acos-proc-vendor-probe/
COPY deploy/codex-attribution/bubblewrap-source.tar.gz deploy/codex-attribution/BUBBLEWRAP-COPYING /usr/share/doc/acos-proc-vendor-probe/
COPY scripts/src/testing/vendor-proc/prepare-source.py /usr/share/doc/acos-proc-vendor-probe/
COPY scripts/src/testing/vendor-proc/command-filter.c /usr/share/doc/acos-proc-vendor-probe/
COPY scripts/src/testing/vendor-proc/probe.py /opt/agentic-codex/proc-probe.py
COPY scripts/src/testing/vendor-proc/privacy.py /opt/agentic-codex/proc-privacy.py
USER node
ENTRYPOINT ["/usr/bin/python3", "-I", "-S", "/opt/agentic-codex/proc-probe.py"]

FROM probe AS namespace-probe-red
COPY --from=compiler --chmod=0555 /source/build-red/bwrap /usr/bin/bwrap

FROM probe AS namespace-probe-green
COPY --from=compiler --chmod=0555 /source/build-green/bwrap /usr/bin/bwrap

FROM namespace-probe-green AS namespace-probe-filtered
COPY --from=compiler --chmod=0555 /source/build-filtered/bwrap /opt/agentic-inner/bwrap
