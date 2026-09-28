# Contributing to Agentic Company OS

Thanks for helping build Agentic Company OS. The project is an early, local-first alpha, so useful contributions include product work, tests, documentation, accessibility, security hardening, and careful simplification.

Please read the [Code of Conduct](./CODE_OF_CONDUCT.md) before participating. Security vulnerabilities belong in the private process described in [SECURITY.md](./SECURITY.md), not in a public issue.

## Before opening a pull request

1. Search existing issues and pull requests to avoid duplicate work.
2. For a large feature or architectural change, open an issue first and describe the problem, intended behavior, and security implications.
3. Keep a pull request focused. Unrelated formatting or generated-file churn makes review harder.
4. Never include API keys, browser profiles, runtime configuration, agent workspace contents, customer data, or conversation logs.

## Development setup

Use Node.js 24 and the exact pnpm release declared in the root `package.json` `packageManager` field.

```bash
corepack enable
pnpm --version
pnpm install --frozen-lockfile
```

Run the API and UI in separate terminals as documented in [README.md](./README.md#quick-start). `.env.example` documents variables but is not loaded automatically.

## Repository conventions

- TypeScript is strict. Prefer narrow types and validation at network/process boundaries.
- The OpenAPI contract in `lib/api-spec/openapi.yaml` is the API source of truth.
- Generated API files should be regenerated, not hand-edited.
- Preserve secure defaults: API loopback binding, disabled founder shell, disabled agent process spawning, and the pinned OpenRouter origin.
- Keep user-visible strings and agent behavior explicit. Avoid claims that a workflow control is a security boundary.
- Respect existing line endings and formatting. Do not reformat unrelated files.

### OpenAPI changes

After changing `lib/api-spec/openapi.yaml`:

```bash
pnpm --filter @workspace/api-spec run codegen
pnpm run typecheck
```

Commit the contract and its generated outputs together.

### Default prompt changes

Default prompts are executable product policy. A prompt pull request should explain:

- the behavior being changed and why;
- which templates or runtime prompt layers are affected;
- what tools and permissions the agent can access;
- how the change behaves under prompt injection, missing context, and provider failure;
- whether spending, deletion, publishing, external contact, credentials, or personal data are involved; and
- how the behavior was verified.

Prompt text must not imply that the model has capabilities or enforcement guarantees the runtime does not provide.

### Security-sensitive runtime changes

Changes to authentication, authorization, CORS, provider credentials, browser control, filesystem resolution, process execution, approval handling, or the compliance judge require a threat-model note in the pull request. Include both the expected safe path and at least one abuse case.

## Quality gates

Run the complete local release gate:

```bash
pnpm run verify
```

This checks formatting, the production dependency audit and license policy, every automatically discovered test, a clean PGlite migration, typechecking, the production build, and the frontend bundle budget. CI additionally regenerates the OpenAPI clients, exercises a real PostgreSQL service, tests the Windows-specific runtime path, and builds/smoke-tests the production container. Add or update focused tests when behavior changes, and include concise manual verification for behavior not yet covered. UI pull requests should include before/after screenshots or a short recording when the visual difference is material. Verify keyboard navigation and reduced-motion behavior where relevant.

Use a clean development shell for `pnpm test` and `pnpm run verify`. The general test runner refuses inherited `DATABASE_URL`, `DATABASE_URL_FILE`, `DATABASE_MIGRATIONS_DIR`, PostgreSQL race-test flags, production `NODE_ENV`, or an API/worker `RUNTIME_ROLE` before starting any tests. Its database imports can apply migrations, so passing an existing installation's environment to the suite is unsafe. Unset conflicting values in the test shell; do not modify the installation's configuration. Empty database values, the default combined role and development/test mode are accepted. General tests use independent, process-lifetime PGlite databases.

Native PostgreSQL evidence uses separate disposable-database commands in `.github/workflows/ci.yml` and the endurance documentation. Those checks require their own explicit disposable target and must never use an installation database. Direct `node --test` commands bypass the general runner's preflight; use them only from a clean development shell unless a specific test documents and enforces a disposable PostgreSQL target. The standalone `@workspace/db migrate` command remains an installation command and intentionally uses its configured database.

## Commit and pull request quality

Write commit messages in the imperative mood and explain _why_ when the reason is not obvious. A pull request should contain:

- a short outcome-first summary;
- the user or operator problem it solves;
- implementation and migration notes;
- verification commands and manual checks;
- security, privacy, cost, and compatibility impact; and
- screenshots for visible UI work.

Do not mark a checklist item as complete unless you ran or verified it.

## Review expectations

Maintainers may request smaller scope, additional validation, documentation, or security controls. Approval of a design discussion does not guarantee merge, and merge timing is best-effort during alpha.

By contributing, you agree that your contribution is licensed under the repository's [MIT License](./LICENSE).
