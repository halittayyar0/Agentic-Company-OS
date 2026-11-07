# Rust migration

The Rust workbench is a separate preview of Agentic Company OS. It owns its web server, task execution and storage. See [the Rust workbench guide](../rust/README.md) for setup. Existing installations continue to use the documented Node.js application.

The preview covers the first text task. It offers explicit Ollama, OpenRouter and direct OpenAI routes, stores the task and outcome in a separate SQLite database, and provides seven interface languages. Cloud requests need an explicitly configured key and consent for each submission. A task interrupted during inference is recorded without automatic replay.

Before switching the default application, the Rust release must meet these existing product contracts:

| Area              | Required before switching                                                                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing data     | Import backed-up PostgreSQL and PGlite workspaces with verified task, agent, approval and audit history. Prove upgrade and recovery without modifying the source installation.                |
| Model connections | Preserve OpenRouter, direct OpenAI and Ollama behavior, including model discovery, free and local boundaries, and task accounting. Port the ChatGPT plan connection and its account boundary. |
| Autonomous work   | Port projects, team roles, delegation, recurring responsibilities, leases, the emergency stop, reviews and durable tool outcomes.                                                             |
| Access and tools  | Preserve operator roles, permission checks, approvals, remote access controls and isolated browser, filesystem and command tools.                                                             |
| Delivery          | Preserve result discovery and exports, seven-language UI, native packages, container deployment and backup and restore.                                                                       |

Preview tests exercise controlled providers without personal accounts or paid calls. The existing product tests remain the reference for behavior during the migration. Build and test the Rust preview independently on Windows, macOS and Linux.
