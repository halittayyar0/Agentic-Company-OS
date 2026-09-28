# Model-turn inbox — local checkpoint verified

The [implementation plan](../superpowers/plans/2026-09-27-meeting-turn-inbox.md) follows the verified [Operations recovery checkpoint](./2026-09-27-operation-recovery.md). Goal 7 remains active. The previous 857 passing source tests and 327 passing browser scenarios belong to that earlier artifact.

## Current implementation

- Discover project-scoped saved model turns independently of selected/listed meetings. Show original request, meeting and participant identities, prompt and saved response limit without inventing metadata.
- Validate stored top-level fields strictly. Preserve corrupt records and offer explicit review/clear with exact raw-value comparison. Valid acknowledgement compares the original complete intent, preserving same-UUID changed input and newer identities.
- Read at most 20 records per page. The storage-key scan starts with 1,000 keys and exposes incomplete scanning with an explicit continuation control. Read/enumeration errors are visible, not empty inboxes.
- Use all seven language packs, phone-sized controls and cancel-first review. Discovery, reload and clearing do not start model calls. Existing exact-identity retry and accepted running/unconfirmed restrictions remain in place.
- Show original recorded replies and localized skipped-expert reasons directly in the inbox, including when the meeting is absent. Recorded failure and zero new replies are explicit; older transcript entries are not presented as this turn's replies. Reject malformed reply display data before acknowledging the outcome.

## Evidence so far

- Nine focused storage/network/locale tests passed after the missing-export red run; the final focused source run passed ten after adding a malformed-reply guard.
- Two browser cases failed against the prior artifact: unlisted valid records and damaged records with an unavailable meeting list had no accessible inbox.
- The first integrated Project Studio suite passed 69 scenarios. Subsequent edge tests reproduced the missing-receipt clearing gap; after repair, 20 focused browser scenarios passed. The fresh reviewer then identified an inaccessible recorded outcome for absent meetings. Its browser reproducer failed, the reply/skip display was added, and all 20 focused scenarios passed again (60.0 seconds).
- Final workspace typecheck and production build passed. English and Arabic 320px recorded-outcome screenshots were inspected. The full source suite completed: **867 total, 862 passed, zero failed, five skipped**, 658.3 seconds. The full production Chromium suite completed: **339 passed**, 12.7 minutes. Both original process handles returned successful terminal results.
- Final selected-language bundle: 1296.0 KiB raw / 381.0 KiB gzip. Explicit aggregate ceilings are 1,330,000/392,000 bytes. All seven turn packs measure 28,154/11,767 bytes with revised 29,000/12,000 limits. Outcome review added 3,608/1,453 bytes across these packs. Individual/media/other family limits are unchanged. The revised gate passes.
- Production dependency audit reported no known vulnerabilities; production license policy passed. Neither result is a content/history secret scan.
- Full formatting, `git diff --check` and clean PGlite migration passed. Fresh API generation retained all **239** file fingerprints with zero differences. There was no server protocol, schema or dependency change in this feature.

The five source skips are native PostgreSQL advisory ownership, operation-receipt/browser-affinity/reconciliation races, heartbeat/recovery lock ordering, cross-connection file locks, and a Windows symlink fixture whose setup returned `EPERM`. They are not passing proofs. The PostgreSQL cases used no external database; the local migration selected process-lifetime PGlite.

Local logs: `%TEMP%/acos-turn-inbox-source-red.log`, `acos-turn-inbox-source.log`, `acos-turn-inbox-ui-red.log`, `acos-turn-inbox-ui.log`, `acos-turn-inbox-types.log`, `acos-turn-inbox-build.log`, `acos-turn-inbox-bundle-initial.log`, `acos-turn-inbox-review-red.log`, `acos-turn-inbox-review-source-red.log`, `acos-turn-inbox-review-source-green.log`, `acos-turn-inbox-reviewed-build.log`, `acos-turn-inbox-reviewed-ui.log`, `acos-turn-inbox-reviewed-bundle.log`, `acos-turn-inbox-final-audit.log`, `acos-turn-inbox-final-licenses.log`, `acos-turn-inbox-final-format.log`, `acos-turn-inbox-final-migrate.log`, `acos-turn-inbox-final-codegen.log` and `acos-turn-inbox-codegen-stability.json`. Final full runs are `acos-turn-inbox-all-source.log` and `acos-turn-inbox-all-ui.log`. Visual artifacts remain in `test-results/turn-inbox-reviewed-focused/` and `test-results/turn-inbox-all-ui/`.

## Remaining

This feature's applicable local gates passed. The broader [release audit](./2026-09-27-release-readiness.md) remains open, including the [Browser/Terminal operator recovery gaps](./2026-09-27-operator-recovery-audit.md). The focused reviewer found no Critical/Important issues and one Minor, regraded and repaired because the absent meeting made its recorded outcome inaccessible; all decisions and declined-review limits are in the plan's final review ledger. No deferred minor remains. No publication, installation, credential change, paid model request or new server protocol/migration was performed. Docker/psql/DATABASE_URL remain absent in this shell. Native PostgreSQL, Docker, physical-phone HTTPS and native-language/accessibility acceptance remain separate unverified gates.
