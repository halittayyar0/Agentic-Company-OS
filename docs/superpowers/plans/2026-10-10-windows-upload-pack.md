# Windows reviewed source transfer implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, followed by one fresh whole-branch review.

**Goal:** Make the real checked source snapshot apply/rollback journey work when its Git pack path exceeds Windows MAX_PATH.

**Spec:** `docs/superpowers/specs/2026-10-10-windows-upload-pack-design.md`.

## Global constraints

- Start at exact `5657c542025ca5c5b180a44882c69b98efe47287` in the attached isolated worktree. Preserve the dirty primary checkout.
- Preserve all seven existing workflow cases, release test counts and skip expectations.
- Keep source, revision, permission, before-effect, ownership, clean-root and timeout protections intact.
- No user/global/repository config mutation, external destination, authentication or paid call.
- Ordinary push is authorized. Do not mark the failed previous candidate ready or merge before all new candidate gates pass.

## Review focus

- The canonical pack filename includes 40 hexadecimal characters; the fixture must exercise the pack boundary as well as the branch lock, on short Windows roots.
- The subprocess command must be constant and apply only to local source snapshot fetch on Windows.
- Existing apply and rollback assertions must actually execute, including preservation of later agent and original-source edits.
- No workaround may weaken the managed Git/sandbox authority or accept a different reviewed commit.
- Fresh candidate full local and hosted evidence must be collected independently of older hosted successes.

## Task 1: Regression and managed transfer fix

**Files:** `artifacts/api-server/src/lib/source-workspaces.test.ts`, `artifacts/api-server/src/lib/source-workspaces.ts`, `docs/chatgpt-connection.md`.

**Interfaces:** Existing source workspace APIs and `execArgvInSandbox` stay unchanged. Static Windows-only fetch argument; no public API, locale, configuration or schema addition.

- [ ] Pad the owned Windows fixture to reach both the review branch lock and a canonical `.git/objects/pack/pack-<40 hex>.pack` path of at least 260 characters. Preserve existing case names and assertions.
- [ ] Run all seven real source journeys against unchanged production using Node 24, tsx and the repository's prepared local test environment. Expected: actual fetch failure in the two apply journeys, with no weaker substitute test.
- [ ] Add constant `--upload-pack=git -c core.longpaths=true upload-pack` only on Windows to the managed local candidate fetch.
- [ ] Run the same seven journeys. Expected: seven pass, zero failures/skips; actual check/apply/rollback and concurrent-edit fences executed.
- [ ] Describe per-command subprocess support in the existing source-change guide.
- [ ] Run adjacent source/native coding authority and lifetime tests, workspace typecheck, changed-file Prettier and staged Gitleaks. Expected: all passing, no changed permission behavior.
- [ ] Commit the tested correction, finish the task with its final real source/adjacent test command, then obtain one fresh whole-branch review. Resolve any important findings with RED/GREEN.

## Task 2: Fresh candidate release acceptance

**Files:** Owned ignored release receipts and the existing PR 49; no additional product changes.

**Interfaces:** Exact head/tree/merge identity and original attempt-one producer evidence; source must remain frozen through acceptance.

- [ ] Fast-forward the existing PR 49 head to the reviewed corrected commit, freeze the new source and launch fresh complete local/original hosted release gates. Expected: new candidate acceptance remains pending until all gates finish; retain older failed candidates and exact public readback.
- [ ] Verify every original required context and native/source/UI/security artifact, run strict candidate admission, perform ordinary protected merge and verify original new-main producers and anonymous public main. Expected: no acceptance until every applicable original gate proves the exact tested source.
