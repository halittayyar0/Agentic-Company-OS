# Bound native endurance health coverage

## Evidence and scope

PR44 merged as `e3993b7bd244d34099c81daecbc36f8fc825dd78` after all eleven required PR checks. Its actual-main run `37894073497` passed nine of ten Actions gates. Windows failed the unchanged independent report verifier: primary health coverage was incomplete. The ten-minute report credited eleven health buckets, including `07:19:00Z` sampled at `07:20:09.801Z`, before the run's first bucket (`07:20:01.112Z` start).

Preserve the original failed artifact and verifier. Correct the shared collector used by native and Docker drivers; keep all acceptance thresholds, real health checks, fault bounds, and strict verification unchanged. This correction does not complete the broader product goal or publish the reusable-guide feature.

## Tasks

1. Reproduce preceding and trailing bucket credit, duplicate observations, and missing minute identity with the real driver. RED observed in `.tmp/native-health-boundaries-red.log`: `[1,2,3,4]` instead of `[1,3]`.
2. Credit only aligned buckets within the planned duration, keeping source minute identity. Validate unplanned degradation even outside credited coverage. Existing fixtures observing two minutes must actually declare a two-minute duration. Run driver, coordinator, observer, verifier, CLI, type/build gates and real owned Windows/PostgreSQL compressed faults against frozen source.
3. Inspect the full diff, publish a focused PR, require exact-source PR checks and fresh actual-main acceptance, then resume distribution and the separate reusable-guide implementation. Never convert a short run into a 24-hour claim.

## Publication gates

The currently released `v0.4.0` remains unchanged. A green local short run alone cannot authorize a successful-release claim. Original artifact `11601737924` and its failed report remain diagnostic evidence, never rewritten acceptance data.
