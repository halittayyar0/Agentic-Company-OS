# Security review checkpoint — 2026-09-28

The first public CodeQL analysis reported 33 alerts. Review dispositions are
recorded on the individual GitHub alerts, not suppressed through blanket rule
exclusions.

## Confirmed false positives

- 4–5: natural-language exclusivity normalization, with no HTML output sink.
- 6: developer-local module paths serialized with `JSON.stringify` into JS literals.
- 7 and 9: the production API/login limiters are mounted before authentication.
- 8 and 11–13: ephemeral loopback test apps; production limiting is separate.
- 14: a test-only acknowledgement resolver stored in a `Map`, not a dynamic prototype call.
- 15–22: operation, command, content and browser-binding digests; no password authentication.
- 26: a post-operation assertion in a private filesystem test fixture.
- 27: descriptor identity is checked after opening before the deletion review reads bytes.
- 33: a substring assertion on serialized test output, not an origin validator.

## Repairs in the publication branch

Earlier security work added bounded descriptor reads to secret/config/control
files, null-prototype cookie parsing, and linear URL trimming. This continuation
also checks the opened VM file against its pre-open and current leaf identity;
hashes native executable/lockfile bytes through the verified descriptor; rejects
file replacement/size changes; and removes stale verifier digest caching.

Runtime probes reject credential-bearing URLs and redirects, keeping operator
credentials on the explicitly selected loopback runtime. Static UI requests now
have a bounded per-process limiter. Two HTML test fixtures now reject an invalid
identifier or render only fixed labels instead of reflecting arbitrary request text.

The descriptor/verifier/file regression set passed 104 tests with one existing
environment-dependent skip. The probe/static/browser-fixture set passed 57 tests.
Full workspace typecheck passed. These results do not mark pending repair alerts
fixed on the default branch; the protected merge and subsequent CodeQL analysis
remain required. A passing scan is not a guarantee that no vulnerabilities exist.
