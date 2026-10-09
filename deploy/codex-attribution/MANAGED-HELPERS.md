# Managed coding helpers: source and build

ACOS modifies the vendored Bubblewrap 0.11.2 source from Codex commit
`ff6aec96948b70d94983af2641a6b67c94faeff5`. Modifications were developed and
verified in October 2026. The exact source archive, original LGPL copying terms,
modification generator and inserted C source ship with the coding image.

## Rebuild

From this checkout, on a Linux x64 Docker engine:

```sh
docker build --pull --target coding-runtime --tag acos-coding:local .
```

The compiler stage in the root Dockerfile is the complete build recipe. It
verifies the source archive, runs the bounded guard regression, generates both
modified C files and builds them with GCC, Meson and Ninja. Meson disables
setuid support, SELinux, manuals and completions. The upstream test suite is not
run by that build; the separate kernel regression and actual CLI permission,
process lifetime and installation gates validate their documented scopes.

The measured toolchain uses the pinned Node 24 Bookworm base image
`sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e`,
GCC 12.2.0-14+deb12u1, libc6-dev 2.36-9+deb12u14, libcap-dev/libcap2
1:2.66-4+deb12u3+b1, Meson 1.0.1-5 and Ninja 1.11.1-2~deb12u1.
The image records actual compiler and package versions. A changed binary is
refused by the build and runtime digest checks; package updates require a new
reviewed identity and the gates again.

## Corresponding source in the image

- `/usr/share/doc/agentic-codex/bubblewrap-source.tar.gz`: all 50 verified original
  source blobs, with original build files and copying terms.
- `/usr/share/doc/acos-proc-vendor-probe/prepare-source.py`: exact modification
  generator, including bounded extraction and source anchors.
- The same directory contains `command-filter.c`, `proc-info-guard.c`,
  `provenance.json`, `binary-sha256.txt`, `compiler-version.txt`,
  `build-packages.txt`, `helpers.json` and the packaged AppArmor profile.
- This document and the root Dockerfile provide the build recipe. The image
  contains this document with the upstream license and notice files under
  `/usr/share/doc/agentic-codex`.

The generator's experiment labels record its original provenance. The managed
runtime's separate manifest defines the admitted production helper identities;
they do not change the original npm integrity or bundled binary identities.

## Changes and validation

The outer helper reads numeric child namespace information only when requested.
Before cloning for such a request, it requires a matching `/proc/self` PID and
a canonical single `NStgid` in a bounded status read. Missing, malformed,
duplicate, truncated or mismatched information refuses before clone.

The inner helper irreversibly installs a native x86_64 command seccomp filter
after setup and before execution. Namespace creation, namespace switching,
mounting and the new mount APIs are refused. `clone3` returns `ENOSYS` so libc
can use ordinary `clone`; namespace flags are denied while ordinary threads
and fork/exec remain supported. Other syscall ABIs are rejected.

CI retains independent known-live parent/sibling positive controls, actual
private-proc writes and mount-alias attempts, PID/proc collision cases and
container retirement. The separate actual Codex gate verifies all 23 cases
and installation/resume/restore. Neither gate makes model calls. Authentication,
model-generated delivery and sustained reliability require their own evidence.
