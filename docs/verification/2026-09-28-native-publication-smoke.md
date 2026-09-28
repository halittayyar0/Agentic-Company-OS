# Native publication and phone checkpoint — 2026-09-28

## Real PostgreSQL repair and verification

The portable PostgreSQL 17.10 archive was downloaded from the EDB distribution
linked by PostgreSQL. Its 333,925,750 bytes matched the CI-pinned SHA-256
`f9aafca58e7026a1ef2caeee711acf761671e57904d430adc85f468374f5a821`.
No system database service was installed.

The first native process smoke failed: the expanded public stock roster contained
14 agents while the endurance contract requires exactly ten. The failure is
preserved in `publication-native-smoke.json`; it was not counted as a pass.

A new database-backed regression reproduced `14 !== 10`. The validated synthetic
runtime now requests a bounded stock cohort when seeding an empty database.
Ordinary installations continue to seed the complete 14-agent roster. Invalid
cohort sizes and an existing mismatched roster fail without silently deleting or
deactivating agents. The regression checks direct reports, company membership,
restart identity and invalid sizes; existing organization/localization tests
also pass (nine tests, no skips). Full typecheck and production build passed
in the separate candidate, followed by the same nine focused tests there.

The repaired native smoke ran against clean source-only candidate commit
`dcb1e48bb32027ec943158040d72ecdfbfca17b6` and exited zero:

- PostgreSQL 17.10, one API and two independent workers;
- ten of ten expected synthetic responsibilities completed;
- one persisted health bucket and no reported health-truth mismatch;
- one worker killed, absence observed, and a new process recovered;
- database unavailability observed, followed by recovery of the full topology.

The report SHA-256 matches its sidecar:
`790a5ef5f3be31c9be14362706333333b4f5b0c01bf75367c63734b103ab8d43`.
This is a short native smoke, not a 24-hour result, a Docker result, or a rerun
of the five distinct native race tests previously skipped by the full suite.
The last full source suite predates this small seeding repair.

## Temporary phone preview

A separate empty PostgreSQL-backed production-mode preview was started with no
provider credentials, scheduler disabled, host execution disabled, an independently
generated operator key, and a four-hour supervisor deadline. The API and database
bind only to loopback. A checksum-verified Cloudflare connector exposes the
authenticated preview over a temporary HTTPS hostname; no router port was opened.
Operator runtime data from the original checkout was not copied.

External HTTPS checks returned: UI 200, anonymous catalog 401, login 200, and
authenticated catalog 200 with 30 guides and ten new local tools. The session
cookie has Secure, HttpOnly and SameSite=Strict. Chrome verified first-run language
selection, login and the populated Turkish skill catalog at the external URL.

The temporary URL and access key are deliberately absent from source and release
artifacts. Cloudflare Quick Tunnels do not support SSE, so this preview is for
phone layout/navigation checks and is not the permanent private-access solution.
The existing Tailscale/private-network guide remains the installation path.
Physical-phone confirmation is still pending from the operator.

## Publication remains pending

Source and reachable-history scans passed with reviewed exact-value exceptions;
the initial two-commit publication history was scanned again after the repair.
The original working tree and Git history remain intact. The publication copy
uses a fresh, reviewed history that excludes historical assistant notes and all
runtime data. GitHub account authentication, remote repository creation/push,
remote CI and public visibility are not yet verified.
