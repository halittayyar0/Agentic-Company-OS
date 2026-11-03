# Consistent Node 24 maintenance runtime

The released baseline is v0.5.10, main `4df02635ba85ac18b0cbf4d2d6bdacafb7f4ba57`. Its original source, five native packages, genuine Windows fresh/upgrade cases, portable installer and 13 anonymously downloaded public assets are qualified. That evidence remains attached to that revision.

## User value and approach

Ship the same maintained Node 24 patch in Docker, Windows x64, macOS Intel/Apple Silicon and Linux x64/ARM64. Node 24.22.2 includes an upstream correction for async context when TransformStream writes wait for backpressure. Agent permissions depend on operation-local context, so verify that a reader cannot supply a different tool scope to a writer's callback.

The current tool entry establishes a fresh policy scope for each operation. No production permission exploit has been established, and this work must not claim one. The regression uses controlled stream callbacks with no file, browser, model or delegation effect.

Considered approaches:

- Docker-only PR #99: leaves native packages, local checks and CI on another patch; incomplete for this product.
- Move to another Node major: unnecessary compatibility change outside the existing Node 24 contract.
- Coordinated 24.22.2 patch and context regressions: selected by the agent under the user's instruction to make routine decisions without further approval.

## Required behavior

- Pin Node 24.22.2 for all five native targets to exact official URLs and SHA256 values; use one verified official `node:24.22.2-bookworm-slim` index digest in all Docker stages.
- Require Node 24.22.2 or newer 24.x in the source/portable prerequisite checks. Reject 24.22.1, prereleases and other majors. Keep the existing issue code and all seven localized prerequisite messages.
- Run active CI and genuine-source preparation on 24.22.2. PostgreSQL 17.11, pnpm 10.17.1, model/runtime pins, task deadlines, permissions, replay rules and Windows helper source/executable/provenance/notice stay unchanged.
- Prove parked callbacks retain their creating operation's context in default and legacy async-context modes. Construct and queue the stream inside the writer operation: its read-only policy remains denied when an observing reader drains it. A stream created outside any scope cannot borrow a reader's context. Calling write inside another scope does not transfer ownership of a stream created elsewhere.
- Keep license notices from the exact Node archives and matching official tag. Change a notice only if the authoritative bytes differ.
- Stage application version 0.5.11. Preserve compatibility with the published 0.5.10 workspace and upgrade protocol 1; no database migration is needed.
- Update current operator/developer instructions and fixtures; retain historical verification/spec/plan facts and published release proofs.

## Evidence and boundaries

First reproduce the stream context difference using the existing24.22.1 runtime, then prove the same tests with a separately staged, checksum-verified24.22.2 executable. Source tests use disposable process-lifetime PGlite and isolated provider storage. This is not persistent PostgreSQL evidence.

Qualify affected setup tests, seven-language320/1024 prerequisite UI, full source suite, type/build/format/security/license/bundle checks, then the original protected PR/platform/native checks. The changed genuine-source workflow may add an original job; it must not be omitted simply because the older cycle had 21 jobs.

Normal protected merge and exact actual-main validation precede any new release qualification. A previous revision's passing artifacts do not qualify the new runtime. Keep old failures and attempt identities; do not rerun producers, weaken protection, force push or rewrite history. Paid services, new personal authentication and secret sharing remain outside authorization.

## Primary sources

- https://nodejs.org/en/blog/release/v24.22.2
- https://nodejs.org/dist/v24.22.2/SHASUMS256.txt
- https://github.com/nodejs/node/pull/66907

The upstream change concerns writer/reader callback context. It is not presented here as a security release, a production exploit reproduction, or proof that all runtime vulnerabilities are absent.
