# Node 24 GitHub Actions maintenance

The old Node 20 artifact action emits a deprecation warning even when a job
succeeds. This update replaces 22 references in six workflows with immutable
commits from official Node 24 action releases. Pages uses the maintained
composite uploader, whose nested upload action also declares Node 24.

| Action                          | Release |
| ------------------------------- | ------- |
| `actions/upload-artifact`       | v7.0.2  |
| `actions/upload-pages-artifact` | v5.0.0  |
| `actions/configure-pages`       | v6.0.0  |
| `actions/deploy-pages`          | v5.0.1  |
| `docker/setup-buildx-action`    | v4.4.1  |
| `docker/setup-qemu-action`      | v4.4.0  |

Local structural verification parsed all eight workflows and checked all 22
updated references against official action inputs. Permissions, concurrency,
timeouts, step commands, artifact names, paths and retention settings are
unchanged. Artifact uploads retain their ZIP default. The removed Buildx inputs
are unused here. Checkout, setup-node, pnpm and CodeQL already declare Node 24.

The original updated PR and main checks must pass before integration is called
verified. Native artifact production, container builds and the next Pages
deployment exercise the upgraded actions; local YAML checks alone cannot prove
that remote uploads or deployments succeed.

Historical run [39911831368](https://github.com/halittayyar0/Agentic-Company-OS/actions/runs/39911831368)
belongs to PR #80. Its linked Windows job succeeded. Its cancellation annotation
records a newer request in the same concurrency group; it is separate from the
Node warning and from that run's failed Linux UI step. Existing concurrency
continues to cancel superseded PR runs. Historical annotations are retained.

References: [GitHub Node 20 deprecation](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/),
[official upload action](https://github.com/actions/upload-artifact/releases/tag/v7.0.2).
