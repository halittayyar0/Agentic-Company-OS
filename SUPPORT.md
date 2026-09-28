# Support

Agentic Company OS is community-maintained alpha software. Support is best-effort; there is no uptime, response-time, compatibility, or security-fix SLA.

## Start here

- Setup and product overview: [README.md](./README.md)
- Architecture: [docs/architecture.md](./docs/architecture.md)
- Security and known limits: [docs/security-model.md](./docs/security-model.md)
- Private self-hosting: [docs/self-hosting.md](./docs/self-hosting.md)
- Contribution workflow: [CONTRIBUTING.md](./CONTRIBUTING.md)

## Asking for help

Use a GitHub issue for a reproducible bug or a scoped feature request. Use GitHub Discussions if the repository has enabled it and the topic is an open-ended usage or design question.

Include:

- the commit SHA or release tag;
- operating system and architecture;
- `node --version` and `pnpm --version`;
- whether PostgreSQL, PGlite, OpenRouter, or Replit AI is in use;
- the command that failed and the smallest reproducible steps;
- expected and actual behavior; and
- sanitized logs or screenshots.

Remove API keys, authorization headers, database URLs, personal data, browser session information, prompt content that contains confidential data, and workspace files before posting.

## Security issues

Do not use a support issue for a suspected vulnerability. Follow the private reporting process in [SECURITY.md](./SECURITY.md).

## Unsupported configurations

The maintainers cannot support:

- an unauthenticated public-internet deployment;
- founder shell or agent process execution on a shared/untrusted host;
- unofficial forks or old commits without a minimal reproduction on current `main`;
- provider-specific outages, billing disputes, or model-output guarantees; or
- recovery of leaked credentials, deleted host data, or ephemeral PGlite state.

Commercial support is not currently offered by this repository.
