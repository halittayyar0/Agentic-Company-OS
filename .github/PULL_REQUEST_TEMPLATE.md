## Outcome

<!-- Lead with what changes for the operator or contributor. -->

## Why

<!-- Link the issue and explain the problem, not only the implementation. -->

## Changes

-

## Verification

<!-- Include exact commands and focused manual checks. Do not claim commands you did not run. -->

- [ ] `pnpm test`
- [ ] `pnpm run typecheck`
- [ ] `pnpm run build`
- [ ] Focused manual verification described below

## Security, privacy, and cost

<!-- Cover auth, permissions, prompts, browser/terminal authority, secrets, stored data, provider calls, and model cost. Write "No material change" only after checking. -->

## Visual evidence

<!-- Add before/after screenshots or a short recording for material UI changes. -->

## Contributor checklist

- [ ] The change is focused and contains no unrelated generated or formatting churn.
- [ ] No secret, runtime config, browser profile, private prompt, user data, or agent workspace content is included.
- [ ] Documentation and `.env.example` are updated when configuration or behavior changes.
- [ ] OpenAPI changes include regenerated clients and schemas.
- [ ] Default prompt changes describe permissions, failure modes, and injection risk.
- [ ] New powerful behavior is opt-in and preserves local-first defaults.
