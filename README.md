<div align="center">

# Agentic Company OS

### Give it work. See the progress. Keep control.

An open-source workspace for AI agents that work with tools, keep task records, and follow the permissions you choose.

[**Get started**](#quick-start) · [**Explore the workspace**](#find-your-way-around) · [**Website**](https://halittayyar0.github.io/Agentic-Company-OS/)

[English](./README.md) · [Türkçe](./README.tr.md) · [Deutsch](./README.de.md) · [Русский](./README.ru.md) · [简体中文](./README.zh-CN.md) · [繁體中文](./README.zh-TW.md) · [العربية](./README.ar.md)

**Windows · macOS · Linux** &nbsp; / &nbsp; **7 languages** &nbsp; / &nbsp; **MIT licensed**

</div>

![The real Agentic Company OS workspace, with agents, projects and activity](./docs/assets/dashboard.png)

## A workspace for getting work done

Give an agent a defined job, or assign a responsibility that repeats on a schedule. It can use the tools you allow, save its results, and ask for missing information or approval. You can follow the work, inspect what happened, and stop execution from the same interface.

Each installation is a **private workspace for one operator**, running on your computer or server. You choose the model provider and keep your own credentials. The public website is a starting point for installation; your tasks run in your own workspace.

Before installing, you can [try three browser tools](https://halittayyar0.github.io/Agentic-Company-OS/#try): check a CSV for missing values and duplicate rows, map a JSON file's structure, or compare two lists. They run locally in the tab with no account, model or upload. Download the report, then copy a follow-up task into your private workspace if you want an agent to investigate further. [What the checks do and their limits →](./docs/quick-tools.md)

The same checks are available under **Skills & tools** after installation. They give you a local result even if you chose to connect a model later; agent tasks still require a working model provider.

| Start with a job                                      | Or make it a responsibility                                  |
| ----------------------------------------------------- | ------------------------------------------------------------ |
| Compare three products using linked sources.          | Check a public page every day and record meaningful changes. |
| Inspect a CSV and report missing or duplicate values. | Review a recurring report on a schedule.                     |
| Review a repository and propose a tested change.      | Repeat a defined checklist and retain each cycle's result.   |

These are example requests, not guaranteed outcomes. Results depend on the model, available tools, permissions and the information you provide.

## Quick start

### 1. Choose how to install

|                       | Ready-made container package                                                                                                       | Native installation from source                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Best for**          | Starting with the prebuilt application                                                                                             | Working directly with the source and host tools                                          |
| **Prepare**           | Node.js 24 + Docker running a Linux engine with Compose v2                                                                         | Git, Node.js 24, pinned pnpm, PostgreSQL; Chromium for browser tools                     |
| **Application build** | Downloaded automatically as a pinned image                                                                                         | Built on your machine                                                                    |
| **Start here**        | [Download the setup ZIP](https://github.com/halittayyar0/Agentic-Company-OS/releases/latest/download/Agentic-Company-OS-setup.zip) | [Native setup guide](./docs/self-hosting.md#guided-installation-windows-linux-and-macos) |

The container package includes PostgreSQL and Chromium. It does not require Git, pnpm or a source build. Local AI models need additional hardware; requirements depend on the model you choose.

### 2. Open the installer

Extract the setup ZIP, then start it from the extracted folder:

| Your system   | What to run                          |
| ------------- | ------------------------------------ |
| Windows       | Double-click `START.cmd`             |
| macOS / Linux | Run `sh START.command` in a terminal |

Open the **private local link** printed in the terminal. Choose your language, model provider, permissions and tool packs. The wizard creates the database and checks that the workspace is ready.

**Keep the extracted bundle and the printed installation directory.** They are used to restart or resume your installation. [Restart, backups and server setup →](./docs/self-hosting.md)

### 3. Give it a clear first job

Create a project, choose an agent and describe the result you want. Start with something you can easily check:

> Compare three options for [topic]. Use primary sources, include links and dates, and save a one-page comparison. Reuse one agent unless independent work is necessary. Ask me if essential information is missing.

For recurring work, include both the interval and what should count as a finished cycle:

> Every 24 hours, check [public page] for meaningful changes. Save a dated summary when something changes. Complete each cycle and wait for the next scheduled time. Do not contact anyone or publish externally.

**A useful brief includes:** the input, the expected output, how to verify it, and any limits on actions or spending.

## Find your way around

| Place                          | What you use it for                                                            |
| ------------------------------ | ------------------------------------------------------------------------------ |
| **Home**                       | See your agents, current work and recent activity.                             |
| **Projects**                   | Keep the brief, conversations, delegated work, meetings and results together.  |
| **Experts & Team Studio**      | Edit agent roles and model choices, or start from a team blueprint.            |
| **Skills & tools**             | Browse work guides, inspect tool requirements and create a project draft.      |
| **Approvals**                  | Review actions that need your decision before they proceed.                    |
| **Operations & Run Inspector** | Inspect execution records, tool activity, interruptions and recovery.          |
| **Company Room**               | Talk with selected agents; use mentions to address specific participants.      |
| **Settings**                   | Configure model connections, language, execution policy and source workspaces. |

A **skill** is a guide for doing a job. A **tool** performs an action, such as inspecting data or using a browser. An **agent** combines instructions, a model and permitted tools to work on a task.

The Run Inspector can also download a narrow, [shareable evidence packet](./docs/shareable-evidence.md) for the selected activity page. It leaves out task text and raw tool data. The setup ZIP includes an offline checksum verifier that needs no Git or pnpm.

## Useful tools, room to grow

The built-in library covers **research, software, data, documents and operations**. It includes work guides, capability tools and runtime tools. Agents can discover guides and load their instructions when needed.

- **Bring your own guidance.** Create, edit, import or export personal skills and utility presets.
- **Add executable tools.** Define Node tools through the editor; execution follows the configured permission and approval rules. [Tool authoring →](./docs/personal-programs.md)
- **Work on source code.** Connect a Git repository, let an agent propose changes in an isolated copy, inspect the diff and run checks before applying it. Deployment is a separate step. [Source workflow →](./docs/source-workspaces.md)

[Browse the skills and tools guide →](./docs/skills-and-tools.md)

## Work that fits its size

Routine tasks start on the economical route. Additional tool definitions load on demand. Existing agents can be reused, and delegation is checked by the server: the default limit is **four active tasks per task family**, including the parent.

A parent waiting for active children makes no model calls. Recurring work waits between scheduled cycles. Usage checks include execution and review calls, using per-task/cycle limits and a rolling daily allowance for recurring work.

Before finishing, the existing reviewer compares the agent's report with a short record of tool results and child-task states. This adds no extra review call; recorded execution still does not guarantee output quality. [Completion review and privacy →](./docs/completion-review.md)

**You control model costs.** Cloud providers bill your own account; local models use your hardware. Explicit free or local selections do not silently fall back to paid models. Reported usage limits can overshoot by an in-flight request, and missing cost remains unknown. Use provider-side limits for a billing ceiling.

[Routing, delegation and budget settings →](./docs/efficient-work.md)

## Your workspace, your access choices

Choose **read-only, approval-based, full access or a custom policy** during setup or in Settings. Full access permits more actions within enabled tools; host execution still has its own configuration and controls. Review the [security model](./docs/security-model.md) before enabling broad host access.

**On your phone:** open the same responsive interface through private HTTPS. The optional setup path uses an existing Tailscale connection; a self-managed VPN is also documented. The host must remain online. [Phone access guide →](./docs/mobile-access.md)

**In your language:** English · Türkçe · Deutsch · Русский · 简体中文 · 繁體中文 · العربية. Arabic supports right-to-left layout. Your custom instructions, external output and historical records retain their original text. [Translation coverage →](./docs/localization.md)

> [!NOTE]
> The application currently supports one trusted operator per installation. Shared multi-user accounts and tenant isolation are not included. Keep remote access private and protected with HTTPS and operator authentication.

## What has been verified

Each portable release pins a Linux amd64/arm64 image and publishes the setup bundle with a checksum. The [latest release](https://github.com/halittayyar0/Agentic-Company-OS/releases/latest) identifies its exact source, automated checks and distribution run. The [0.2.0 acceptance record](./docs/verification/2026-09-29-efficient-autonomy.md) documents the earlier source, browser, platform, container and bounded live-model checks; those counts do not describe later commits.

A 24-hour soak, physical-phone/carrier acceptance and native-speaker review are still outstanding. Open-ended tasks may need your input; completion of every possible job is not guaranteed.

[Latest release](https://github.com/halittayyar0/Agentic-Company-OS/releases/latest) · [Current CI](https://github.com/halittayyar0/Agentic-Company-OS/actions) · [Verification scope](./docs/verification/2026-09-29-efficient-autonomy.md)

## Go deeper

| I want to…                                                 | Read this                                                                   |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| Install, restart or back up a workspace                    | [Self-hosting](./docs/self-hosting.md)                                      |
| Configure environment variables or run development servers | [Operator & developer reference](./docs/operator-reference.md)              |
| Understand the API, workers and database                   | [Architecture](./docs/architecture.md)                                      |
| Understand permissions and remaining risks                 | [Security model](./docs/security-model.md)                                  |
| Follow changes and planned work                            | [Changelog](./CHANGELOG.md) · [Roadmap](./docs/roadmap.md)                  |
| Contribute code, docs or translations                      | [Contributing](./CONTRIBUTING.md) · [Code of conduct](./CODE_OF_CONDUCT.md) |
| Report a security vulnerability privately                  | [Security reporting](./SECURITY.md)                                         |

Small, focused contributions are welcome: a reproducible bug report, a clearer translation, a useful guide or a tested fix.

---

**Open source under the [MIT License](./LICENSE).** Bundled IBM Plex fonts use SIL Open Font License 1.1; see [third-party notices](./artifacts/agentic-company-os/public/THIRD_PARTY_NOTICES.txt).
