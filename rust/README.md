# Agentic Company OS Rust workbench

This preview provides an independent Rust application for running a text task, viewing its saved result, and downloading the result as text. The workbench uses Axum, embedded server-rendered pages, and a separate SQLite database.

## Run locally

Use Rust 1.99.1, the toolchain checked in CI. Windows source builds use the MSVC C++ build tools. From the repository root:

```sh
cargo run --locked --manifest-path rust/Cargo.toml
```

Open the loopback URL printed in the terminal. Enter the username `operator` and the temporary password printed for this run in the browser's sign-in prompt. Keep the terminal open and press Ctrl+C to stop. Use the printed `127.0.0.1` address.

1. Choose Ollama, OpenRouter, or direct OpenAI.
2. Enter a model ID and describe the text result you need.
3. Choose an output token limit. For a cloud provider, explicitly approve sending the instructions to that provider.
4. Start the task and use **Refresh task** to see its outcome. Finished results are available on the task page and as a plain text download.

### Providers

| Provider      | What to configure                                                                                                                                                | Example model ID                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Ollama        | Start a stable Ollama 0.40.3 or newer on `127.0.0.1:11434` and install a local text model. The workbench checks model metadata and requests the `:local` source. | `qwen3.5:2b`                                                  |
| OpenRouter    | Set `ACOS_RUST_OPENROUTER_API_KEY` in the process environment and restart.                                                                                       | `vendor/model`, using the ID shown in the provider catalog    |
| Direct OpenAI | Set `ACOS_RUST_OPENAI_API_KEY` in the process environment and restart.                                                                                           | An ID from your OpenAI account that supports Chat Completions |

Set `ACOS_RUST_PORT` to change the default workbench port of 4711, or `ACOS_RUST_OLLAMA_PORT` to change the local Ollama port. Provider URLs are fixed by the app. A cloud task can incur provider charges. The maximum output token setting limits requested output tokens. Provider-account limits control dollar spending.

### Local storage

The default location is in your operating system's per-user application data directory. Set `ACOS_RUST_DATA_DIR` to choose a separate private directory. Task instructions, model IDs, states, usage and results are stored in `workbench.sqlite3`. Keep the directory private and stop the workbench before making a file copy. Provider keys stay in the process environment.

The workbench admits one task at a time. A repeated submission of the same form refers to the same record. A task interrupted by a restart is marked **Interrupted**, since its provider may already have received it. To run it again, submit a new task after reviewing the old record.

### Migration status

The current application continues to serve existing installations and data. This preview has a separate schema and task store. ChatGPT Plan authentication and accounting, multi-agent orchestration, tools and approvals, recurring jobs, and native installers remain in the current application while those workflows are ported. This preview exposes a loopback-only browser interface. Hosted and phone access use the current application's supported deployment paths.

The preview follows the palette, status semantics, and responsive conventions in the root [design contract](../DESIGN.md). Its pages use `templates/workbench.css` as their runtime token source and ship without network assets. The task journey is available in English, Turkish, German, Russian, Simplified Chinese, Traditional Chinese, and Arabic.

## Check locally

```sh
cargo fmt --manifest-path rust/Cargo.toml --check
cargo clippy --locked --manifest-path rust/Cargo.toml --all-targets -- -D warnings
cargo test --locked --manifest-path rust/Cargo.toml
cargo build --locked --release --manifest-path rust/Cargo.toml
```

The tests exercise a controlled loopback Ollama peer, task admission and restart recovery, browser host and origin checks, and construction of fixed-destination cloud requests. They use fixture credentials and never invoke a paid provider.

For a browser smoke test, install the repository's existing Playwright development dependencies and Chromium. Build the release binary, then run `node rust/tests/browser-smoke.mjs` from the repository root. Pass the binary path if you use a custom Cargo target directory. The test submits a real form to a separate workbench process, checks the seven languages at 320 and 1024 pixels, downloads the fixture result, and verifies it after restarting. It creates its own data directory under `.tmp`.
