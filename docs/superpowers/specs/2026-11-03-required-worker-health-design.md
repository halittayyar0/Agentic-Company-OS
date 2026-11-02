# Required worker capacity and truthful health

## Evidence and outcome

Original PR100/head454d382 Windows job125560342014 attempt1 failed `health_truth_consistent`, with100/100 responsibilities and seven successful recoveries. Minute1 persisted `runtimeTruthState=live`, healthy workers1, stale workers1 and fresh scheduler tick780ms. The two-worker endurance adapter correctly requires two healthy workers; its live-to-healthy mapping exposed the missing capacity policy. The failed original, both artifact digests, raw primary evidence and job log remain immutable.

An offline controlled probe calls the actual native two-worker environment builder, runtime config parser and production derivation. It reproduces minimum1/live/healthy1/stale1, then fails the required two-worker degraded-state assertion. No database, model, account or original CI rerun is involved.

The user must see reduced capacity when an installation requiring two workers loses one, while a deliberately single-worker installation may remain live. Historical stale rows must not poison a recovered fleet. Existing task processing, permissions and cost limits remain unchanged.

## Design

- Add administrator environment setting `RUNTIME_MIN_HEALTHY_WORKERS`, integer1..64, generic default1. It describes required healthy capacity; it does not spawn workers, change concurrency or grant permissions.
- Compose, managed native installation and both endurance environment producers declare2 for their actual two-worker topology. Controlled endurance cannot inherit a lower ambient minimum. Intentional custom single-worker deployments can choose1. Combined/development compatibility retains default1.
- `deriveRuntimeTruth` accepts `minimumHealthyWorkerCount`, default1, and returns the effective minimum. With at least one healthy worker below that minimum, report `degraded` and reason `worker_capacity_below_minimum`. Emergency stop, local demo, offline/stale, heartbeat/tick cutoffs and transitional workers retain existing semantics. Two fresh healthy workers plus historical stale rows remain live with minimum2.
- Both persisted sampler and live overview/project/receipt read paths use the same validated policy. Persist their resulting state through the existing health schema; do not rewrite old samples or add a database migration. Keep the minimum explicit in current API runtime truth.
- Add the runtime minimum to OpenAPI and regenerate API clients/Zod through the existing generator. The UI accepts absent minimum in legacy snapshots, retains generic degraded presentation then, and never invents a target.
- For `worker_capacity_below_minimum`, the existing amber runtime badge shows localized ready/required capacity in all seven locales (tr/en/de/ru/zh-CN/zh-TW/ar). Preserve stale transport/snapshot precedence. Use existing badge layout and number formatting, including320px/RTL. No extra settings screen or agent is added.
- Account for only the new locale field through built-pack reconstruction, with an independent160 raw/96 gzip selected-byte and960 raw/480 gzip all-language cap. Older usage reporting receives packs without that field, avoiding duplicate compressed credit. Existing numeric base/total/route/media ceilings remain unchanged. This follows the existing bounded feature accounting; unrelated growth receives no new credit.
- Endurance raw-health interpretation, exactly-two-ready requirement, false-green rejection, fault windows, cadence, deadlines, task counts, permissions and original skip sets stay strict. Startup should reject an explicit policy inconsistent with its two-worker topology rather than downgrade that contract.

## Alternatives considered

Lowering the endurance healthy-worker requirement or relabeling a live sample inside the observer would hide the capacity gap. Treating every historical stale row as a current fault would permanently degrade recovered fleets. Globally requiring two workers would mislabel intentional one-worker installations. Explicit capacity at the topology producers addresses all three cases.

## Required proof and release boundary

- RED/GREEN production environment/config/derivation regression with the original count/tick values; explicit min2 loss/recovery and intentional min1 controls.
- Config bounds; hostile ambient setting cannot lower controlled topology; both managed deployment modes advertise their actual minimum.
- Disposable database sampler and live read-model agreement, including recovery and unchanged stored history; no inference/provider account used.
- API generated consistency, all seven locale strings and amber/live transitions at320/1024px including Arabic; unknown legacy minimum remains honest.
- Relevant focused tests, actual source/UI census changes only, fixed old skips/limits, types/build/format/audits/licenses/bundle/secrets and independent review. New commit author Halit, no coauthors, normal push.
- Fresh exact-head original CI and strict protection projection before normal merge; actual-main, native archives, genuine fresh/0.5.9 GUI upgrade, distribution21-file proof and13-asset anonymous publication remain separate. The rejected454d382 reports never qualify a new candidate or main.
