# Private-helper snapshots implementation

1. Preserve e498615 original workflow, security alerts, rejected stock verifier
   and independently qualified Windows primary evidence. Existing loader/resume
   behavioral tests are the baseline; original CodeQL is the failing oracle.
2. Open the helper before descriptor metadata checks; retain bounded reads,
   before/after identity, canonical pathname and pinned digest validation.
3. Copy exact verified snapshot bytes during packaging. Retain the owned file
   descriptor in the Windows ACL fixture. Compare complete trusted-host entries
   in the phone-resume fixture.
4. Keep the existing loader census, adding POSIX FIFO rejection coverage within
   that case. Run focused behavior, types, build, packaging, helper ACL/lifetime,
   formatting, bundle, audit and secrets checks appropriate to the changed code.
   Report any unavailable check explicitly.
5. Review the final diff, commit as Halit Tayyar without coauthors and push a new
   PR100 head. Qualify only fresh original runs including the separate required
   CodeQL check. After normal protected integration, validate fresh actual-main
   archives, genuine model/059 GUI upgrade, distribution and public readback.
