# Compact organization context and a failed real-model trial

Development verification, 2026-10-11. This follows the
[response-recovery record](./2026-10-11-incomplete-response-recovery.md).
The development changes have not received complete release acceptance.

## User benefit and boundaries

Task and chat prompts send the same organization rows with less encoding overhead.
JSON quotes and apostrophes remain literal inside XML element text. Ampersands and
angle brackets remain escaped, including embedded closing tags and literal entity
names. The organization section remains explicitly untrusted data.

The existing 24-report ceiling, active-agent filter and per-field bounds remain.
Core policy, role expertise, permissions, manager identity, task context and tool
schemas are preserved. Other prompt fields retain their previous escaping.

The actual first request's 13-report section decreased from 1,254 to 804 UTF-8
bytes: 450 bytes saved. Readback of the old and new requests proves identical
decoded rows and an otherwise identical system prompt. This is a byte measurement;
there is no measured token saving or successful-job speed claim.

## Scoped checks

| Check              | Result and scope                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Regression modules | 79 passing cases across prompt cost, compact JSON, tool catalog and task tool envelope modules                                 |
| Final JSON module  | Two passing cases; one overlaps the earlier run, so the counts are not added                                                   |
| Seven languages    | Task and chat prompts preserve exact custom expertise, owner brief, markup boundaries, literal entities and bounded rows       |
| Large organization | Actual 25-report fixture emits 24 unique rows with the existing name and role limits                                           |
| Workspace gates    | Formatting, all workspace typechecks, production builds and the original bundle limits passed                                  |
| Browser routes     | 28 passing variants across seven languages, light/dark and 320px phone/desktop widths; zero retries, failures, flakes or skips |

The browser tests use the production preview with controlled API fixtures and
inspect eight primary routes. They do not prove live model quality, physical
phone behavior, all task mutations or the entire application test suite.

The initial compact-JSON test failed because structural quotes were expanded.
An early combined run exposed fixture interference with the existing default
organization seeding. The new test was moved to its own module; existing test
sources and assertions were retained. The subsequent complete modules passed.

The checked runtime source contains 2,091 public files, fingerprint
`75a51c3802345a4d1166e27c2577ad5c5d7c7b6f6ad90639da3b5fb123dd2045`.
Documentation was updated afterwards. This record does not certify other native
platforms, container installation or a 24-hour recurring run on this source.

## Real Windows CPU trial: failed

The owned native Ollama 0.30.0 installation used the retained, verified
`qwen3.5:0.8b-q8_0` model. The original readiness, inference and job windows stayed
at 20, 120 and 180 seconds. The task remained:

> Use calculate for 17 × 23, report 391, then complete this one task. Do not delegate, create agents, browse or write files.

There were no simulated model responses or usage, injected completion criteria,
forced tools, personal credentials or observed cloud requests.

The first actual inference returned HTTP 500:

```text
XML syntax error on line 7: element <function> closed by </parameter>
```

The daemon log identifies failure while parsing the model's generated tool
output. The model emitted a malformed completion call; it did not establish a
successful calculation or verified completion. Ollama's
[Qwen3.5 parser source](https://github.com/ollama/ollama/blob/v0.30.0/model/parsers/qwen35.go)
delegates generated tool content to its tool parser. Escaped organization data
in the input is distinct from this generated-output parsing failure.

The error response contained no usage. The application paused the task for the
missing or incomplete usage receipt, with zero **recorded** tokens. Actual tokens
consumed are unknown. Only one inference request was observed; accounting was
not reset to permit another call. Owned cleanup passed and the experiment ended
with exit code 1.

## Remaining work

The compact encoding is verified; reliable first-task completion on this small
model remains unproven. Tool-support metadata does not qualify a model's output.
Investigate local output failures and an explicit accounting-recovery journey
without inventing usage, executing malformed calls or bypassing effect protection.

Corrupt retry-storage repair and truthful storage feedback remain open. Real
ChatGPT sign-in and plan usage, physical phone access, complete current source/UI
and platform gates, recurring-run acceptance and protected publication also remain
open. Earlier GitHub checks cover their recorded commit, not these local changes.
