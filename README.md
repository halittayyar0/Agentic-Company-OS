<div align="center">

# Agentic Company OS

### Give it work. See the progress. Keep control.

An open-source workspace for AI agents that work with tools, keep task records, and follow the permissions you choose.

[**Get started**](#quick-start) · [**Explore the workspace**](#find-your-way-around) · [**Website**](https://halittayyar0.github.io/Agentic-Company-OS/)

[English](./README.md) · [Türkçe](./README.tr.md) · [Deutsch](./README.de.md) · [Русский](./README.ru.md) · [简体中文](./README.zh-CN.md) · [繁體中文](./README.zh-TW.md) · [العربية](./README.ar.md)

**Windows · macOS · Linux** &nbsp; / &nbsp; **7 languages** &nbsp; / &nbsp; **MIT licensed**

</div>

![English Home preview before connecting a model, with the Get it done approach selected](./docs/assets/dashboard.png)

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

### 1. Download the native package

Choose the **v0.5.4** archive for your computer from [Releases](https://github.com/halittayyar0/Agentic-Company-OS/releases/latest). Check the version and checksum before downloading. Node.js, PostgreSQL and the built application are included; you do not need to install Node.js, Docker, pnpm, Git or PostgreSQL separately.

| System              | Archive                                  |
| ------------------- | ---------------------------------------- |
| Windows x64         | `Agentic-Company-OS-win32-x64.zip`       |
| macOS Intel         | `Agentic-Company-OS-darwin-x64.tar.gz`   |
| macOS Apple Silicon | `Agentic-Company-OS-darwin-arm64.tar.gz` |
| Linux x64           | `Agentic-Company-OS-linux-x64.tar.gz`    |
| Linux ARM64         | `Agentic-Company-OS-linux-arm64.tar.gz`  |

Targets: Windows 10 (1903+)/11 x64, macOS 15 on Intel or Apple Silicon, and Ubuntu 24.04 on x64 or ARM64. Linux packages use the matching Ubuntu 24.04/glibc build floor; older glibc and Alpine/musl are not supported targets. Windows ARM64 is not a native target. Windows and macOS downloads are unsigned; notarization and SmartScreen reputation are not provided. Review normal OS trust prompts and the release checksum without disabling system security.

### 2. Open the workspace

Extract the **whole archive** into a folder. In that folder, double-click `START.cmd` on Windows; on macOS open `START.command`, or run `./START.command` in a macOS/Linux terminal. Keep all package files together.

The launcher opens a private local browser link and prints a fallback link. Choose one of seven languages, review permissions and connect a model. The app binds to loopback (`127.0.0.1`) by default. Keep the terminal open; **Ctrl+C** stops the app, workers and private database. For headless use, run `START.cmd --no-browser` or `./START.command --no-browser`.

Data and credentials stay outside the extracted package in a private installation directory. Keep that directory and the original package. Starting the same package again at its original location resumes its recorded installation. Moving data to a different package or upgrading it is not automated; retain a verified backup and follow the [upgrade guidance](./docs/self-hosting.md#upgrades).

Model weights and provider access are not included. AI jobs need a configured Ollama model or an available provider connection; cloud providers may charge your account. Local utility checks can run without a paid provider.

**Advanced options:** the separate [Docker package](./docs/self-hosting.md#portable-container-installer) and [source installation](./docs/self-hosting.md#source-installation-prerequisites) retain their own requirements.

### 3. Give it a clear first job

On **Home**, describe the result you want and choose **Get it done**. A suitable existing agent starts the job. Small jobs stay with the same agent; independent work or necessary specialist help can use existing experts within your execution limits. Start with something you can easily check:

> Compare three options for [topic]. Use primary sources, include links and dates, and save a one-page comparison. Reuse one agent unless independent work is necessary. Ask me if essential information is missing.

For recurring work, include both the interval and what should count as a finished cycle:

> Every 24 hours, check [public page] for meaningful changes. Save a dated summary when something changes. Complete each cycle and wait for the next scheduled time. Do not contact anyone or publish externally.

**A useful brief includes:** the input, the expected output, how to verify it, and any limits on actions or spending.

The saved **Delivery summary** appears directly above the project workspace. Open **Review evidence** to inspect recorded activity and checks. The summary is the agent's report; it is not independent proof that every claim is correct. For recurring work, it shows the latest saved delivery, while the current responsibility status stays visible above it. Converting a finished one-off job to recurring work retains its previous delivery until a new one is saved.

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

The Run Inspector can also download a narrow, [shareable evidence packet](./docs/shareable-evidence.md) for the selected activity page. It leaves out task text and raw tool data. The release packages include an offline checksum verifier that needs no Git or pnpm.

## Useful tools, room to grow

The built-in library covers **research, software, data, documents and operations**. It includes work guides, capability tools and runtime tools. Agents can discover guides and load their instructions when needed.

- **Bring your own guidance.** Create, edit, import or export personal skills and utility presets.
- **Add executable tools.** Define Node tools through the editor; execution follows the configured permission and approval rules. [Tool authoring →](./docs/personal-programs.md)
- **Work on source code.** Connect a Git repository, let an agent propose changes in an isolated copy, inspect the diff and run checks before applying it. Deployment is a separate step. [Source workflow →](./docs/source-workspaces.md)

[Browse the skills and tools guide →](./docs/skills-and-tools.md)

### Reuse a brief you have already written

Since v0.5.0, a project's **Saved brief** offers **Use brief
again** and **Prepare personal guide**. Review and save the guide, then choose
**Prepare a project** when you need that brief again. Existing drafts are kept
until you choose to replace them. Preparing text starts no work; **Start project**
creates a separate job using your current settings.

This copies your saved instructions; it does not extract a proven method from an
agent's result. Use a v0.5.0 or later setup bundle for this workflow.
[Workflow and recovery details →](./docs/skills-and-tools.md#reuse-a-saved-project-brief)

## Work that fits its size

Routine tasks start on the economical route. Additional tool definitions load on demand. Existing agents can be reused, and delegation is checked by the server: the default limit is **four active tasks per task family**, including the parent.

A parent waiting for active children makes no model calls. Recurring work waits between scheduled cycles. Usage checks include execution and review calls, using per-task limits, a shared allowance for the parent and its subtasks, and rolling daily allowances for recurring work.

If a usage limit pauses work, the project page can check the allowance and resume eligible tasks together. Checking uses no model tokens, retains usage and provides a saved receipt if the connection drops. [Usage limits and safe resumption →](./docs/efficient-work.md#resume-after-a-usage-pause)

Before finishing, the existing reviewer compares the agent's report with a short record of tool results and child-task states. This adds no extra review call; recorded execution still does not guarantee output quality. [Completion review and privacy →](./docs/completion-review.md)

Small calculator runs can attach their actual numeric inputs and result to that
review. The runtime checks the arithmetic and exact operation binding; this helps
the reviewer distinguish a reported answer from the calculation that ran. Up to
eight operands are deliberately retained; [scope and privacy](./docs/completion-review.md#bounded-calculator-evidence)
explain the limits.

For work that must use a particular tool, choose optional **completion conditions** before starting. The server requires a recorded success for each selected operation in the current cycle, without granting permissions or adding a review call. The project shows missing success and unavailable capabilities in your chosen language. [Choose conditions and understand their limits →](./docs/completion-review.md#choose-completion-conditions)

**You control model costs.** Cloud providers bill your own account; local models use your hardware. Explicit free or local selections do not silently fall back to paid models. Reported usage limits can overshoot by an in-flight request, and missing cost remains unknown. Use provider-side limits for a billing ceiling.

[Routing, delegation and budget settings →](./docs/efficient-work.md)

## Your workspace, your access choices

Choose **read-only, approval-based, full access or a custom policy** during setup or in Settings. Full access permits more actions within enabled tools; host execution still has its own configuration and controls. Review the [security model](./docs/security-model.md) before enabling broad host access.

**On your phone:** open the same responsive interface through private HTTPS. The optional setup path uses an existing Tailscale connection; a self-managed VPN is also documented. The host must remain online. [Phone access guide →](./docs/mobile-access.md)

**In your language:** English · Türkçe · Deutsch · Русский · 简体中文 · 繁體中文 · العربية. Arabic supports right-to-left layout. Your custom instructions, external output and historical records retain their original text. [Translation coverage →](./docs/localization.md)

> [!NOTE]
> The application currently supports one trusted operator per installation. Shared multi-user accounts and tenant isolation are not included. Keep remote access private and protected with HTTPS and operator authentication.

## What has been verified

Use the [latest release](https://github.com/halittayyar0/Agentic-Company-OS/releases/latest) for the exact source revision, archive checksums and available verification receipts. A listed target is not a claim that its current release checks have passed. The [0.2.0 acceptance record](./docs/verification/2026-09-29-efficient-autonomy.md) documents earlier source, browser, platform, container and bounded live-model checks; those counts do not describe later commits or the new native packages.

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

**Model connection, v0.4.0 and later:** the [connection walkthrough](./docs/model-connections.md) explains local models, ChatGPT, API keys and keeping your first-job draft. Earlier setup bundles do not include this flow.

**Local model privacy:** Ollama 0.18.0 or later exposes separate local/cloud choices. Cloud use requires explicit permission for that server; unverified models are unavailable. [Private addresses, version guidance and cloud controls →](./docs/local-models.md)

Open **Model usage records** on a project or agent to inspect a request after an interruption. Checking spends no model tokens and never resends the request; unknown usage is not treated as zero. [Reading usage records →](./docs/inference-accounting.md)

---

**Open source under the [MIT License](./LICENSE).** Bundled IBM Plex fonts use SIL Open Font License 1.1; see [third-party notices](./artifacts/agentic-company-os/public/THIRD_PARTY_NOTICES.txt).
