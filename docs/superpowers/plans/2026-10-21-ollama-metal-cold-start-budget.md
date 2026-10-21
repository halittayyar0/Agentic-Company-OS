# Pinned Ollama Metal cold startup budget

> Execute inline with `superpowers:executing-plans`; use TDD and request review
> before integration. This is a bounded continuation of native installer release
> qualification, authorized by the user's instruction to finish without routine
> approval questions.

**Goal:** Let the owned minimum-version privacy fixture finish its dependency's
documented cold Metal initialization, while retaining a finite HTTP deadline.

**Architecture:** Change only Darwin ARM64's fixture startup deadline from 20 to
35 seconds. The pinned server allows 30 seconds for its bootstrap runner; Metal
does not take the second CUDA/ROCm validation phase. Add five seconds for HTTP
serving. Keep 20 seconds on all other hosts. This changes a test harness deadline,
not the product's installation performance contract or Ollama's behavior.

**Tech stack:** Node 24, TypeScript, node:test, unchanged Ollama 0.18.0.

**Spec:** Existing
`docs/superpowers/specs/2026-10-20-native-upgrade-preservation-design.md`.

## Evidence and limits

- Original main `eaca08da7a261f590b866290305a472b3fc909d5` platform run
  [39562340346](https://github.com/halittayyar0/Agentic-Company-OS/actions/runs/39562340346),
  job `119096327848`, failed its 20-second HTTP deadline. Embedded Metal source
  was selected, but library completion and HTTP readiness were not observed.
  Original failure log SHA-256:
  `04d4876989dda5b10d95ac73ce03084b1c64c4ddc598a94e1bc40ffb6ee4675f`.
- One separate diagnostic on the unchanged fixture, run
  [39651643385](https://github.com/halittayyar0/Agentic-Company-OS/actions/runs/39651643385),
  captured exact owned runner stacks at five and fifteen seconds. Both showed
  `newLibraryWithSource` waiting synchronously for the Metal compiler over XPC.
  HTTP became ready at 18.107 seconds; all seven protocol observations, two
  positive controls, zero owned remote requests and cleanup passed. Sampling
  perturbs timing. This supports, but does not prove, the original failure's
  exact stack. It neither replaces original-main acceptance nor proves inference.
  Diagnostic artifact `12368883726`, SHA-256:
  `c1fa94dc7f3acaa9741dce22f95ec048740df2e810a6c416fd34b4191abf029a`.
- Pinned upstream [bootstrap budget and validation condition](https://github.com/ollama/ollama/blob/v0.18.0/discover/runner.go#L82-L143),
  [CUDA/ROCm-only second validation](https://github.com/ollama/ollama/blob/v0.18.0/ml/device.go#L500-L507),
  [embedded source compilation](https://github.com/ollama/ollama/blob/v0.18.0/ml/backend/ggml/ggml/src/ggml-metal/ggml-metal-device.m#L126-L251)
  and [GPU discovery before serving HTTP](https://github.com/ollama/ollama/blob/v0.18.0/server/routes.go#L1782-L1838)
  explain why the fixture's former 20 seconds could preempt legitimate bootstrap.

## Constraints

- Preserve the original failed main receipt; do not rerun it into acceptance.
- Keep archive/version hashes, GPU discovery, fresh HOME/cache/TMP, private proxy,
  cloud disable, selectors, requests and cleanup unchanged. No warming caches.
- Keep HTTP poll requests at 500 ms, protocol requests at 5 seconds and poll
  interval at 100 ms. Only HTTP success can establish readiness.
- Never infer successful GPU initialization, inference or startup performance
  from this metadata/privacy fixture. Fresh Qwen task proof remains separate.
- No diagnostic script/workflow is merged into main with this repair.
- Update the four platform source censuses only for new unconditional tests;
  preserve every named skip, source/UI/security and native release gate.

## Inline tasks

- [x] Add regressions: cold readiness after 20 seconds within the supported
      bootstrap window succeeds; never-ready still fails at the finite budget;
      other host deadlines remain unchanged. Use the real supervisor poll loop
      with a virtual clock, without downloading or executing models.
- [x] Observe the regressions fail, then extract fixed readiness options and use
      them in the existing native fixture. No other startup/probe logic changes.
- [ ] Run targeted source tests, typecheck, formatting, secret scan and review.
- [ ] Send the repair PR; run fresh full local and original PR gates. Integrate
      ordinarily only after strict acceptance, then qualify exact actual main.
- [ ] Resume finite installer/model/update/release/public-readback acceptance
      with new identities. Keep all earlier failures and proof scopes truthful.

## Review focus

- Exported policy must actually be used by the native fixture.
- Mac Intel, Linux and Windows must retain their existing 20-second deadlines.
- A hung startup must still time out; logs cannot establish HTTP readiness.
- Virtual clock regressions must execute the real polling loop and reset timers.
- Metadata/privacy evidence cannot be described as successful model inference.
