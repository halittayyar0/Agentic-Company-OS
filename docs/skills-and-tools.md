# Built-in skills and tools

Open **Skills & tools** in the navigation or command palette. The library contains
30 versioned work guides and ten new local helper tools, alongside the original
22 runtime tools. An agent sees only the tools allowed by its current permissions
and task context.

## Use a skill

1. Search by title, outcome, area, or stable ID such as `csv-quality`.
2. Expand the guide to review inputs, access requirements, procedure and checks.
3. Choose **Create project draft**. Review the populated title and scope, add the
   actual data or source locations, and choose project settings.
4. Submit through the normal project form when ready. Opening a guide or creating
   its draft never starts an agent, grants permission or creates a task.

The library supports Turkish, English, German, Russian, Simplified Chinese,
Traditional Chinese and Arabic. It follows the selected workspace language and
supports Arabic right-to-left layout. Editing a draft changes ordinary project
text; a guide does not silently replace the operator's scope.

## The 30 work guides

| Area                  | Guides                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Research              | Source-backed brief, competitor map, claim verification, product comparison, literature map, interview plan          |
| Software              | Code review, bug triage, test plan, API contract review, release readiness, dependency review                        |
| Data                  | CSV quality report, JSON structure audit, metric report, data dictionary, record reconciliation, experiment analysis |
| Documents and content | Document outline, copy editing, translation review, FAQ draft, changelog draft, meeting actions                      |
| Operations            | Project plan, incident review, operating runbook, risk register, process map, work handoff                           |

These are first-party procedural guides, not separately installed integrations or
guarantees of model performance. Each combines a specific acceptance target with
domain steps and source/verification checks. Research uses the existing browser;
repository and file work uses the agent's existing workspace access. Missing
inputs or unavailable tools must be disclosed. An agent can discover a guide with
`list_skills` and load its complete instructions with `read_skill`; the latter
also reports which referenced tools are unavailable in the current context.

## The ten new tools

| Tool               | Behavior and limits                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list_skills`      | Search the built-in library by an optional keyword (120 characters) and one of five areas. Returns up to the complete 30-guide catalog.                                                                                                                                                                                                                                                                |
| `read_skill`       | Load a known stable ID, procedure, inputs, checks and current missing-tool list. Rejects unknown IDs.                                                                                                                                                                                                                                                                                                  |
| `calculate`        | Add, subtract, multiply, divide, mean, min, max and percentage over 1–1,000 finite numbers. Percentage requires `[part, whole]`. Uses IEEE-754 arithmetic; rejects division by zero and nonfinite results. No expression evaluation.                                                                                                                                                                   |
| `analyze_text`     | Count UTF-8 bytes, code points, graphemes, locale-segmented words and lines. Counts depend on the stated segmentation locale.                                                                                                                                                                                                                                                                          |
| `compare_text`     | Compare line positions, with at most 100 changed positions and 80-character excerpts per side. Reports excerpt/list truncation and line-ending-only differences. This is not a minimal diff algorithm.                                                                                                                                                                                                 |
| `inspect_json`     | Parse JSON and optionally follow an exact RFC 6901 pointer. Own properties only; invalid escapes and missing paths fail. Values over 8,000 characters return an explicitly truncated serialized preview.                                                                                                                                                                                               |
| `profile_csv`      | Parse comma, semicolon or tab data with quoted/multiline fields. First row is a header. At most 2,000 data rows and 128 columns. Reports duplicate headers, ragged rows and indexed per-column empty/distinct/numeric statistics. Numeric summaries ignore nonnumeric cells and disclose the numeric count. Formula text is never evaluated. Header names over 120 characters are marked as truncated. |
| `convert_datetime` | Require a valid ISO timestamp with an explicit `Z` or numeric offset, and a valid IANA target time zone. Returns UTC, epoch milliseconds and a localized display. No ambiguous local-date guessing.                                                                                                                                                                                                    |
| `inspect_url`      | Parse a supplied HTTP(S) address up to 4,096 characters. Rejects embedded credentials. Performs no network request and makes no availability or safety claim.                                                                                                                                                                                                                                          |
| `hash_text`        | SHA-256 of exact supplied UTF-8 text. A fingerprint is neither encryption nor a signature or proof of origin.                                                                                                                                                                                                                                                                                          |

Text inputs are limited to 48,000 UTF-16 code units per field. JSON pointers are
limited to 1,024 characters. Unknown argument fields are rejected. CSV data is
profiled, not rewritten; textual values and whitespace remain source evidence.

### Numeric fidelity

`inspect_json` rejects numeric tokens whose decimal value would change during
parsing and serialization. This includes rounded large identifiers, overflow,
underflow, and negative zero whose sign would be lost. It does not return a
silently altered number or replace overflow with `null`.

CSV numeric summaries use approximate IEEE-754 arithmetic. Per-column
`unrepresentableNumeric` counts numeric-looking cells excluded because they
cannot retain their source value; textual distinct/empty counts still include
those cells. `sumOverflow` explicitly flags a nonfinite sum, represented as
`null`. The `numeric` count gives the actual denominator of numeric summaries.

These tools add no package installation, external service or subscription. They
perform bounded in-process computations on data explicitly supplied to them.
They cannot read files, access the network, run commands or change permissions.
Existing agent/model execution still uses the operator's configured provider and
may incur its normal model usage charges.

## Runtime and API integration

All ten tools pass through the production dispatcher, active-agent checks,
emergency stop, explicit per-turn tool restrictions, task/agent leases and the
existing read-only durable operation receipt protocol. Retrying a completed
logical call follows the existing deferred/replay behavior. Raw utility output
is not stored as receipt result data. Source-bearing results stay inside the
existing untrusted-data envelope; their contents never become system authority.

`GET /api/skills?locale=en` returns the versioned catalog. It uses normal operator
authentication (when configured), rejects unsupported or repeated locales and
unknown query fields, and sets `Cache-Control: private, no-store`. The endpoint
and generated clients are described in `lib/api-spec/openapi.yaml`. It has no
mutation endpoint and needs no database migration.

## Contributing a guide or tool

Guide IDs and group/tool metadata live under
`artifacts/api-server/src/lib/capabilities/catalog.ts`. Localized procedures and
outcomes live in the seven `capabilities/locales/` files. Keep IDs stable, bump
the guide version when its contract changes, and supply all languages. A guide
must state its inputs, concrete result, required access and verification steps.

New executable tools need more than a catalog entry: implement a strict schema,
bounded handler, side-effect classification, dispatch integration, presentation
locale boundary and meaningful success/failure tests. Do not add a network or
filesystem capability to a tool described as local data processing. Changes to
the public catalog schema require OpenAPI regeneration.

## Verification limits

Local processor tests, actual dispatcher/receipt integration, authenticated API
checks and production Chromium fixtures cover this feature. They do not prove
live-model quality for every guide, native-speaker acceptance, physical-phone
HTTPS access or native Safari behavior. See the dated verification record for
the exact commands, counts and build evidence; broader release readiness remains
a separate gate.
