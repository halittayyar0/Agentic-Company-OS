# Durable operator recovery — local verification

The [implementation plan](../superpowers/plans/2026-09-27-operator-request-recovery.md) covers Terminal and Browser admission, actual effect guards, exact receipt reads and seven-language recovery. This checkpoint follows the [meeting-turn inbox](./2026-09-27-meeting-turn-inbox.md); it does not claim that the entire open-source release goal is complete.

## Implemented contract

- Migration 0025 adds retained request identities, private ownership, database-clock deadlines and encrypted bounded Terminal output. Identity binds the expert, action kind, authority and exact input. Matching replay never creates a new execution owner; changed input conflicts. Receipt reads survive expert deletion.
- Browser receipt metadata contains no URL, typed text, image, title or private lease. Receipt inspection does not restore control. Key loss/corruption preserves recorded completion while reporting unavailable Terminal output.
- HTTP mutations require UUIDs. Runtime workers validate the original owner at actual Browser effects; Terminal filesystem and host-process execution use effect guards. PostgreSQL deployments require the runtime control key, including combined deployments.
- Both tools save versioned identity with verified readback before dispatch and correlate late replies with the complete original intent. Seven selected-language packs provide exact read-only recovery, explicit unknown/missing states and Cancel-first review. Newer drafts and changed/damaged records survive late replies and storage retry.
- Filesystem effects revalidate after waiting for the workspace lock and at publication boundaries, including workspace creation. Native revalidation reuses the lock transaction to support a one-slot database pool. Interrupted dragging rechecks each step and releases a held button only on its captured page.

See [the public contract and upgrade/key/retention notes](../operator-recovery.md). Application dispatch is at most once per accepted identity; external effects are not transactional or guaranteed exactly once.

## Review and regressions

One fresh integrated reviewer found two Important issues: destructive local-storage retry/admission and stale authority after filesystem waits or between drag steps. Both were retained at Important severity and repaired in one pass. No Critical or deferred Minor findings remain from that focused review. Unrelated preserved changes and environment-dependent acceptance were outside its scope.

Three production browser regressions failed before raw-value comparison was added. Five actual filesystem mutations failed their expired-owner assertions before the post-lock guard; four more showed that expired requests could still create an empty workspace. A local browser drag failed before intermediate authority checks. These are observed RED-to-GREEN reproductions, not only tests written against already passing behavior. The final focused source group passed **34**, skipped **one native PostgreSQL test**, and failed **zero**; the production Browser/Terminal group passed **55/55**, 2.2 minutes. Existing stopped-state readback also passes after scoping the new root-creation check to guarded operator operations.

The native-only test now requires a one-connection application pool, actual guarded file publication, and a separate-connection advisory-lock expiry race in a disposable database. It is configured but **not executed locally**.

## Release gates

- Full source suite: **891 total, 885 passed, zero failed, six skipped**, **693.4 seconds**; the original process handle returned exit zero.
- Full rebuilt production Chromium suite: **363 passed, zero failed**, **13.6 minutes**; the original process handle returned exit zero. Final artifacts are retained in `test-results/operator-all-ui/`.
- Workspace types and production builds: passed.
- Generated API: **252** source fingerprints before and after generation; **zero differences**.
- Clean local migration: passed with process-lifetime **PGlite**, not native PostgreSQL.
- Production dependency audit: no known vulnerabilities. Production license policy: passed (Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, MIT, OFL-1.1). Neither is a secret-content/history scan.
- Selected-language bundle: **1308.2 KiB raw / 384.7 KiB gzip**, under explicit **1,345,000 / 396,000 byte** limits. All seven recovery packs: **11.8 / 5.4 KiB**, under **18,000 / 8,000 byte** aggregate limits. This feature deliberately allocated an additional 15,000 raw / 4,000 gzip bytes; other family, per-asset and media caps were retained.
- Full repository format check and `git diff --check`: passed; final report edits are formatted separately.
- Final English dark and Arabic light recovery screenshots were inspected at desktop/narrow widths and retained under `test-results/operator-reviewed-focused/`. These inspect controlled fixtures, not a physical phone, native input method or screen reader.

The six full-source skips are five native PostgreSQL proofs: worker/sampler advisory ownership; operator identity and guarded filesystem transaction reuse; operation receipts, Browser affinity and reconciliation; heartbeat/recovery lock ordering; and cross-connection file locking. The sixth is a Windows output-symlink fixture whose setup returned `EPERM`. These are explicitly unverified, not passing tests.

Focused logs under `%TEMP%`: `acos-operator-review-storage-red.log`, `acos-operator-review-file-fence-red.log`, `acos-operator-review-drag-red.log`, `acos-operator-root-fence-red.log`, `acos-operator-review-source-green.log`, `acos-operator-review-ui-green.log`. Final gates use `acos-operator-all-source.log`, `acos-operator-all-ui.log`, `acos-operator-final-{build,codegen,migrate,audit,licenses,bundle}.log` and `acos-operator-codegen-stability.json`.

## Outstanding evidence

Native PostgreSQL, production Docker topology, physical-phone private HTTPS, Safari, native IME, assistive-technology and native-speaker acceptance remain unverified. Docker, psql, Tailscale and secret-scanner commands are absent from PATH; the checked standard PostgreSQL/Docker installation paths and repository executable search also found no runtime. No software was installed, no credential was changed, no paid provider was called, and no commit, push or publication was performed. No real 24-hour run is claimed.

The broader [release audit](./2026-09-27-release-readiness.md) retains the remaining source-language/history/visual audit, secret-content/history review, exact candidate and clean-checkout/remote-CI requirements. Goal 7 stays active.
