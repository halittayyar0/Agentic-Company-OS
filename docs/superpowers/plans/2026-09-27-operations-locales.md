# Operations localization and evidence review implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. Preserve existing work; no commit or publication is part of this checkpoint.

**Goal:** Complete global and project Operations presentation in seven languages with honest evidence, accessible phone interactions and guarded operator reconciliation.

**Architecture:** Lazy, typed language packs and a route copy boundary own presentation. Existing snapshot, stream and backend receipt models retain authority. Reconciliation uses the existing immutable receipt decision API, real Zod validation, React Hook Form and read-only recovery after uncertain writes.

**Tech Stack:** React, TypeScript, TanStack Query, Zod mini, React Hook Form, Playwright, Node 24.

**Spec:** Goal 7, `UX-CONTRACT.md`, `DESIGN.md`, `docs/localization.md`, and existing operations receipt contracts.

## Global constraints

- Languages: tr, en, de, ru, zh-CN, zh-TW, ar; Arabic RTL.
- Preserve names, IDs, provider/tool identifiers and recorded user/model content.
- Never infer health from missing samples or equate sample coverage with a real 24-hour endurance run.
- Explicit Europe/Istanbul display zone; localized numbers and dates.
- No new dependency, installation, paid service, mobile application, publish or credential operation.
- Existing web/private HTTPS mobile access remains the delivery route; physical device review is external.
- All touched forms use React Hook Form, Zod, ValidatedForm; preserve drafts on failure.

## Review focus

1. Language asset failure must not mount untranslated mutation controls.
2. Long original IDs and German/Russian/Arabic labels must fit 320–390px and enlarged text.
3. Failed refresh must retain known data and disclose its age, never imply live data.
4. Lost reconciliation response must not enable a changed decision before checking immutable server evidence.
5. Incomplete/truncated evidence must not prove absence of an external effect.

## Tasks

- [x] Add failing locale parity/presentation tests, typed lazy packs and a selected-language context. Cover structured truth priority, explicit timezone and original evidence values.
- [x] Localize both routes and all Operations components; remove false endurance claims; retain last good fleet data; fix logical spacing, wrapping, touch targets and sheet focus.
- [x] Replace schema-shaped reconciliation validation with Zod/RHF; bound refresh/uncertainty and preserve input; test failure, confirmation and conflict paths.
- [x] Extend browser fixtures for seven locales, phone/RTL, keyboard validation, recovery, empty/error and stale views. Run focused source and UI checks.
- [x] Run relevant release gates, inspect screenshots, record exact results and remaining external checks in a verification report and update localization docs.

## Execution ledger

- Ruling: Goal 7 already authorizes these concrete changes; no additional design approval is needed. Work stays in the existing checkout to preserve the ongoing release candidate.
- Ruling: Snapshot `verifiedTwentyFourHours` is retained for internal compatibility but UI describes sample coverage only; it is not an endurance certificate.
- Baseline: meeting checkpoint has 837 passed / 5 skipped source tests, 307 earlier full browser checks, final 61 Project Studio checks; see previous verification report for exact artifact limits.

- Review: a fresh source reviewer found changed-intent retry and snapshot-eviction races. Frozen submission, pinned receipt selection and scope guards address both; follow-up source review reported no further significant findings in those files.
- Ruling: existing immutable reconciliation APIs remain unchanged. This checkpoint retains input only while the room is mounted; durable navigation/reload recovery and an exact scoped receipt read remain required release work, explicitly recorded in the verification report.
- Verification: 846 passed / 5 skipped in the full source suite; 28 focused final source checks; 320 full Chromium checks before the final summary-label typography adjustment; 18 focused Chromium checks on the final rebuilt artifact. Workspace types/builds, API regeneration (238 unchanged fingerprints), clean PGlite migrations, formatting, production audit, license policy, bundle and diff checks passed.
- Visual review: inspected final English and Arabic phone screenshots. Native phone, Safari, actual enlarged-text/browser settings, assistive technology and native-speaker acceptance remain unverified.
- Release audit: added current English/Turkish README status, updated the roadmap and documented remaining work. Added omitted native sampler/file-lock CI steps and raised the CI job allowance to 35 minutes; remote execution remains unverified.
- Evidence: `docs/verification/2026-09-27-operations-locales.md` and `docs/verification/2026-09-27-release-readiness.md`. Goal 7 remains active; no commit or publication.
