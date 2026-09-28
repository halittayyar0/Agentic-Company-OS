# Connected installation checkpoint — 2026-09-28

The native installation executor was exercised on Windows x64 with Node 24 and
an isolated PostgreSQL 17.10 cluster. It built the application, started one API
and two workers, applied Arabic, read-only mode and the data/document packs, and
passed both runtime-topology probes. The static UI returned 200; an anonymous
catalog request returned 401. A personal skill was saved through the real API.
After stopping the owned runtime processes and resuming from the private
manifest, the operator identity and personal skill were preserved. The owned
runtime and disposable database were stopped afterward.

The phone verification helper independently checks UI 200, anonymous API 401
and authenticated API 200. Its negative test rejects an ingress that exposes
the API anonymously. Tailscale control tests cover login and listener conflicts;
these are automated tests, not a physical-phone acceptance result.

The focused connected-feature suite passed 66 tests before the final additions.
Seven subsequent focused tests covered manifest resumption, private-phone
verification, authenticated extension HTTP mutation/revision conflicts and
real capability dispatch. The browser monitor regression suite passed 34 tests,
including cursor advancement beyond JavaScript's safe-integer range. Full
workspace typecheck passed. A directory secret scan found no leaks.

The source suite and remote platform/container jobs are separate release gates.
This checkpoint does not claim that all remote gates passed or that a 24-hour
endurance run completed. It does not verify arbitrary MCP/package execution or
an isolated source-change/apply/rollback workflow.
