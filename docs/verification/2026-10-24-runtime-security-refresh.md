# Runtime security refresh — 2026-10-24

Status: implementation and upstream verification in progress; no new package, image or release has been published by this cycle. Prior PR #81/main `50f54e8` evidence applies to its original binaries and cannot qualify this change.

## Why this change

The native inputs selected Node 24.21.0 and PostgreSQL 17.10. The existing application-container digest actually identifies Node 24.20.0 on both amd64 and arm64. These versions precede the [Node 24.22.1 security fixes](https://nodejs.org/en/blog/release/v24.22.1) and [PostgreSQL 17.11 security fixes](https://www.postgresql.org/docs/17/release-17-11.html). npm audits and CodeQL do not establish the security of those embedded binaries.

The existing PostgreSQL container digest `051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0` already identifies `17.11-1.pgdg12+2` on amd64 and arm64 and is retained. Public OCI index, platform manifest and config bytes were independently SHA-256 checked. Config identity is metadata evidence; it does not substitute for running the image.

## Verified upstream inputs

Node's official HTTPS [checksum index](https://nodejs.org/dist/v24.22.1/SHASUMS256.txt), SHA-256 `fdfbffc969c0f604beff0124d409b33a43b53f5c681d6220f80023e0d6df9dc4`, supplies all five archive checksums in `deploy/native-runtimes.json`. The full Windows archive matches `d2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5`; its complete LICENSE matches the official tag after newline normalization. The canonical tag notice is unchanged. The other target archives remain subject to full-byte verification on their native build hosts.

The complete PostgreSQL source archive is 21,787,224 bytes and matches the [published checksum](https://ftp.postgresql.org/pub/source/v17.11/postgresql-17.11.tar.bz2.sha256): `dd27f2b3c59e73ed14aa3324901242bf69a032a6347805f274e6260322d42979`. Direct copyright/regex/timezone notices and all 118 selected comment blocks in 113 source files are unchanged. Only the version in the additional-notices introduction changes; its exact preserved-newline SHA-256 is `323670e75a408c81f42980fd06283584d7c5602fecbccdc9c968d56190c88142`. No detached-signature verification is claimed.

The new official Node `24.22.1-bookworm-slim` index is `55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205`. Its independently hash-checked amd64 and arm64 configs both identify Node 24.22.1. Local Docker execution is unavailable on this Windows host; original remote container acceptance remains required.

## Behavior and compatibility evidence

- Actual Node 24.21.0 accepts a NUL-containing DNS name; the regression fails with “Missing expected rejection.” Actual hash-verified 24.22.1 rejects it. A valid query to the same owned loopback-only DNS server succeeds; no external DNS server is queried.
- Actual PostgreSQL 17.10 psql interprets the inline SQL-shaped data after a failed COPY: the harmless shared fixture reports `runtime-security-sentinel=1`. The identical fixture under actual 17.11 reports `runtime-security-sentinel=0` and executes the query after the terminator. It uses only a session-local temporary table in a fresh private SCRAM loopback cluster. Cluster shutdown, closed port and removal were verified for both versions. The complete official EDB Windows input is 340,719,294 bytes with measured SHA-256 `6eabdf00d2893713b75db4336a23c3fdf505f056e217ec6e2e95d901750cfea3`; no separate publisher checksum/signature verification is claimed for that test-only archive. Distributed native runtimes remain project source builds.
- New-build admission tests reject stale but previously valid Node/PostgreSQL pins and changed destinations. Existing historical-manifest and upgrade-inspection tests remain unchanged; the first focused run passed 33/33. Python integrity/admission tests passed 7/7 after their recorded failing controls.
- A browser regression first failed because the correction text omitted the patch version. Updated shared messages then passed in all seven locales at 320 and 1024 pixels, preserved Arabic RTL, prevented horizontal overflow and unblocked after a fresh readiness recheck. This is desktop Chromium viewport emulation, not physical-phone certification.

## Acceptance still required

Complete source tests, formatting, builds, security checks, original new-PR and actual-main platform checks, all five final native archives with both harmless runtime regressions, real useful work, upgrade from the published v0.5.7 installation, restart/backup, immutable image publication and anonymous public readback remain required. None is inferred from the old runtime's passing evidence. No paid model, new personal authentication, user database, secret disclosure or additional inference agent is part of this change.
