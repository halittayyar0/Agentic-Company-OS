# Competitive benchmark

Last reviewed: 29 September 2026

This benchmark converts public product patterns into engineering requirements. It is not a claim of feature parity, and it does not copy proprietary UI or implementation details.

## What the category leaders teach

| Product                                                                                                             | Strong pattern                                                                                                                                                             | Applied in Agentic Company OS                                                                                                                                                                                                                                                           | Remaining gap                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [Atoms agent team and project workspace](https://help.atoms.dev/tr/articles/12129380-your-agents-team)              | A project chat keeps mode, agents, files, preview, terminal, console, and editor in one working context; team mode delegates among named specialists and `@` selects one.  | Project Studio keeps project chat, delegated work, meetings, transcripts, decisions, actions, and delivery evidence together; its computer panel exposes the coordinator's agent-scoped workspace. Company Room keeps separate persistent membership and mention-aware group semantics. | Project-isolated files/worktrees, Atoms branding, proprietary UI, hosted builder, and its code-generation stack are not reproduced. |
| [Relevance AI Workforces](https://relevanceai.com/docs/get-started/core-concepts/workforces)                        | A visible workforce graph joins triggers, agents, tools, conditions, and controlled handoffs; operators inspect work in a task view.                                       | Workforce Studio provides versioned crew graphs, explicit `ai`, `next`, and `review` handoff contracts, atomic installation, and an optional root outcome.                                                                                                                              | Arbitrary persisted node editing, connector triggers, publish/rollback, and reusable standalone tool chains.                        |
| [CrewAI Crews and Flows](https://docs.crewai.com/en/concepts/flows)                                                 | Crews model role-based collaboration while Flows make state, routing, and event-driven control explicit. Traces and human-in-the-loop controls make execution inspectable. | The Run Inspector exposes `intake → plan → route → execute → review → deliver` from real records, including delegation, tools, approvals, judge outcomes, fallback, and recovery.                                                                                                       | Durable flow versions, replay, deployment environments, native eval suites, and OpenTelemetry export.                               |
| [Salesforce Agentforce multi-agent orchestration](https://www.salesforce.com/agentforce/multi-agent-orchestration/) | A primary agent routes work to specialists under shared governance; each agent is defined through role, data, actions, guardrails, and channel.                            | Managers install specialist hierarchies; agent settings now surface a capability contract separating prompt intent from runtime permissions and channels.                                                                                                                               | Shared enterprise knowledge, tenant identity/ACLs, connector action registry, and policy administration at enterprise scale.        |

## Product principle

The category is no longer won by adding another chat surface. The core loop is:

```text
Definition → Version → Trigger → Run → Trace → Human review
```

This release closes one production-shaped vertical slice of that loop:

1. Choose a versioned workforce definition.
2. Bind it to a live manager whose authority is checked on the server.
3. Optionally start a finite or continuous root outcome.
4. Let the leased scheduler and normal agent runtime execute it.
5. Inspect the run through sanitized, persisted evidence.
6. Stop or approve at the existing runtime gates.

## Deliberate boundaries

- Blueprint installation cannot grant permissions the selected parent does not have.
- It cannot create a second root CEO or enable sudo/root authority.
- Emergency stop and fleet/task capacity checks fail closed before writes.
- A database failure rolls back the complete install.
- Trace export omits raw commands, browser form text, credentials, URL query/fragment data, arbitrary nested payloads, and private model reasoning.
- The product remains a local-first, trusted-single-operator alpha; it is not an enterprise multi-tenant control plane.

## Next parity milestones

1. Persist workflow drafts and published revisions with immutable run-version binding and rollback.
2. Add schedule, webhook, and connector trigger nodes plus idempotent replay.
3. Add eval datasets and release gates for prompts, tools, handoffs, and completion behavior.
4. Move browser/process execution into disposable workers and export traces through OpenTelemetry.
5. Add principals, roles, tenant boundaries, knowledge-source ACLs, and policy administration.

The exact risk and release ordering lives in [the roadmap](./roadmap.md), while runtime boundaries live in [the architecture](./architecture.md) and [security model](./security-model.md).

## September 2026 product check

Recent official documentation reinforced three practical gaps:

| Observed pattern                                                                                                                                                                                                                                    | Current project position                                                                                                                                                              | Next concrete step                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [OpenClaw onboarding](https://docs.openclaw.ai/start/getting-started) verifies an existing model connection with a real completion before opening the dashboard.                                                                                    | Setup checks runtime readiness; Settings has a separately confirmed paid provider test.                                                                                               | Add an optional first-run connection check with a clear cost preview, or an offline local-model check, without silently making paid requests. |
| [OpenAI Agents SDK tracing](https://openai.github.io/openai-agents-python/tracing/) and [agent evaluations](https://developers.openai.com/api/docs/guides/agent-evals) link runs, tool calls, handoffs and guardrails to repeatable quality checks. | The Run Inspector and durable receipts expose selected evidence; there is no representative eval set or release gate for completion claims.                                           | Add fixed adversarial fixtures and a prompt/tool-policy release gate before broader autonomy claims.                                          |
| [LangGraph persistence](https://langchain-ai.github.io/langgraphjs/how-tos/cross-thread-persistence-functional/) and [Temporal durable execution](https://docs.temporal.io/) emphasize checkpointed continuation after interruption.                | Task leases and operation receipts recover several interruption cases, while external effects remain at-least-once or outcome-unknown unless the destination supports reconciliation. | Extend idempotency and failure-injection coverage for each connector before automatic replay.                                                 |

This update adds a [shareable evidence packet](./shareable-evidence.md) for one loaded activity page. It removes free-form text and raw tool data before download and can be checked locally without a model call. It is deliberately a bounded review aid, not an execution certificate or a substitute for the missing eval and replay work.
