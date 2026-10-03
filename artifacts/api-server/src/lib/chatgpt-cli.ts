import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type {
  ChatGPTRegistrationPublicStatus,
  ChatGPTRegistrationStore,
} from "@workspace/ai-server/chatgpt-plan-types";
import { createRuntimeChatGPTRegistrationStore } from "./chatgpt-connection-runtime";
import { createFileChatGPTRegistrationStore } from "./chatgpt-registration-store";
import { exportChatGPTSession, importChatGPTSession } from "./chatgpt-handoff";
import { createChatGPTSessionManager } from "./chatgpt-session";
import { createChatGPTSignInController } from "./chatgpt-sign-in";

const HELP = `ChatGPT connection (no inference is performed)
  status
  prepare-target
  sign-in --same-computer [--registration UUID] [--enable-plan] [--manual-link]
  export --registration UUID --expected-revision N --target-host URN --transfer-directory ABSOLUTE_PATH
  import --expected-revision N --transfer-directory ABSOLUTE_PATH
  sign-out --registration UUID

Optional on any command: --store-directory ABSOLUTE_PATH (protected local store).
Otherwise use the installation's PostgreSQL authority, or its development local store.
For servers, prepare the target first, sign in on your own computer, export the selected
session, transfer the protected directory over SSH, then import as the runtime owner.
Export retires the source's credentials. The target alone owns later refreshes.
Never send credential files through chat, HTTP, email or Git. Import consumes its copy;
remove other transfer copies once successful. Prepared/consuming crash records cannot
be retried automatically; sign in again. A signed-in target is never overwritten.
Sign-in requires an interactive terminal and a browser on the same computer.
`;

interface CLIOptions {
  store?: () => Promise<ChatGPTRegistrationStore>;
  write?: (value: string) => void;
  writeError?: (value: string) => void;
  fetch?: typeof fetch;
  confirm?: (account: ChatGPTRegistrationPublicStatus) => Promise<boolean>;
  openAuthorization?: (url: string) => Promise<void>;
  signal?: AbortSignal;
}

function openBrowser(url: string): Promise<void> {
  const executable =
    process.platform === "win32"
      ? path.join(
          process.env.SystemRoot ?? "C:\\Windows",
          "System32",
          "rundll32.exe",
        )
      : process.platform === "darwin"
        ? "/usr/bin/open"
        : "xdg-open";
  const args =
    process.platform === "win32"
      ? ["url.dll,FileProtocolHandler", url]
      : process.platform === "darwin"
        ? ["--", url]
        : [url];
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("chatgpt_cli_browser_unavailable"));
    }, 10_000);
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("chatgpt_cli_browser_unavailable"));
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve()
        : reject(new Error("chatgpt_cli_browser_unavailable"));
    });
  });
}

export async function runChatGPTConnectionCLI(
  args: string[],
  options: CLIOptions = {},
): Promise<number> {
  const write =
    options.write ?? ((value: string) => process.stdout.write(value + "\n"));
  const writeError =
    options.writeError ??
    ((value: string) => process.stderr.write(value + "\n"));
  if (
    args.length === 0 ||
    (args.length === 1 && ["help", "--help", "-h"].includes(args[0]))
  ) {
    write(HELP);
    return 0;
  }
  const definitions: Record<
    string,
    Record<string, { type: "string" | "boolean" }>
  > = {
    status: {},
    "prepare-target": {},
    "sign-in": {
      registration: { type: "string" },
      "same-computer": { type: "boolean" },
      "manual-link": { type: "boolean" },
      "enable-plan": { type: "boolean" },
    },
    export: {
      registration: { type: "string" },
      "expected-revision": { type: "string" },
      "target-host": { type: "string" },
      "transfer-directory": { type: "string" },
    },
    import: {
      "expected-revision": { type: "string" },
      "transfer-directory": { type: "string" },
    },
    "sign-out": { registration: { type: "string" } },
  };
  const command = args[0];
  let values: Record<string, string | boolean | undefined>,
    expectedRevision = 0;
  try {
    if (!Object.hasOwn(definitions, command)) throw new Error("command");
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        ...definitions[command],
        "store-directory": { type: "string" },
      },
      strict: true,
      allowPositionals: false,
      tokens: true,
    });
    const names = parsed.tokens
      .filter((token) => token.kind === "option")
      .map((token) => token.name);
    if (new Set(names).size !== names.length) throw new Error("duplicate");
    values = parsed.values;
    for (const name of ["store-directory", "transfer-directory"])
      if (
        values[name] !== undefined &&
        (typeof values[name] !== "string" ||
          !path.isAbsolute(values[name]) ||
          /[\r\n\0]/u.test(values[name]))
      )
        throw new Error("absolute_path");
    if (
      values.registration !== undefined &&
      (typeof values.registration !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(
          values.registration,
        ))
    )
      throw new Error("registration");
    if (["export", "import"].includes(command)) {
      if (
        typeof values["expected-revision"] !== "string" ||
        !/^(?:0|[1-9]\d*)$/u.test(values["expected-revision"]) ||
        !values["transfer-directory"]
      )
        throw new Error("revision");
      expectedRevision = Number(values["expected-revision"]);
      if (!Number.isSafeInteger(expectedRevision)) throw new Error("revision");
    }
    if (
      command === "export" &&
      (!values.registration ||
        typeof values["target-host"] !== "string" ||
        !/^urn:uuid:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(
          values["target-host"],
        ))
    )
      throw new Error("target");
    if (
      (command === "sign-out" && !values.registration) ||
      (command === "sign-in" &&
        (values["same-computer"] !== true ||
          (values["enable-plan"] && !values.registration)))
    )
      throw new Error("required");
  } catch {
    writeError(
      "Invalid connection command. Run with --help for supported arguments; paths must be absolute and each option may appear once.",
    );
    return 2;
  }
  let ownsDatabase = false;
  try {
    if (
      command === "sign-in" &&
      !options.confirm &&
      (!process.stdin.isTTY || !process.stdout.isTTY)
    )
      throw new Error("chatgpt_cli_interactive_required");
    const store = await (options.store
      ? options.store()
      : typeof values["store-directory"] === "string"
        ? createFileChatGPTRegistrationStore(values["store-directory"])
        : ((ownsDatabase = true), createRuntimeChatGPTRegistrationStore()));
    if (command === "status") {
      const registrations = await store.listPublicStatus(),
        active = await store.readActiveRegistration();
      write(
        JSON.stringify({
          registrations,
          activeRegistrationId: active?.id ?? null,
        }),
      );
    } else if (command === "prepare-target")
      write(
        JSON.stringify({
          targetHostId: await store.getHostId(),
          registrations: await store.listPublicStatus(),
        }),
      );
    else if (command === "export")
      write(
        JSON.stringify(
          await exportChatGPTSession({
            store,
            registrationId: values.registration as string,
            expectedRevision,
            targetHostId: values["target-host"] as string,
            directory: values["transfer-directory"] as string,
          }),
        ),
      );
    else if (command === "import")
      write(
        JSON.stringify(
          await importChatGPTSession({
            store,
            expectedRevision,
            directory: values["transfer-directory"] as string,
            fetch: options.fetch,
          }),
        ),
      );
    else if (command === "sign-out")
      write(
        JSON.stringify(
          await createChatGPTSessionManager({
            store,
            fetch: options.fetch,
          }).signOut(values.registration as string, options.signal),
        ),
      );
    else {
      const controller = createChatGPTSignInController({
        store,
        fetch: options.fetch,
      });
      try {
        const attempt = await controller.beginSignIn({
          registrationId: values.registration as string | undefined,
          requestPlanPermission: values["enable-plan"] === true,
        });
        if (values["manual-link"]) {
          if (new URL(attempt.authorizeUrl).searchParams.has("id_token_hint"))
            throw new Error("chatgpt_cli_private_link_requires_browser");
          write(attempt.authorizeUrl);
        } else
          await (options.openAuthorization ?? openBrowser)(
            attempt.authorizeUrl,
          );
        write(
          "Complete sign-in in the browser on this computer. Your existing account stays selected until you confirm the new account here.",
        );
        for (;;) {
          options.signal?.throwIfAborted();
          const status = await controller.readSignInStatus(attempt.attemptId);
          if (
            status.state === "review" &&
            status.proposedAccount &&
            status.expectedRevision !== undefined
          ) {
            let confirmed: boolean;
            if (options.confirm)
              confirmed = await options.confirm(status.proposedAccount);
            else {
              const { createInterface } =
                await import("node:readline/promises");
              const prompt = createInterface({
                input: process.stdin,
                output: process.stdout,
              });
              try {
                confirmed = /^y(?:es)?$/iu.test(
                  (
                    await prompt.question(
                      `Use ${status.proposedAccount.email ?? status.proposedAccount.displayName ?? status.proposedAccount.id} (${status.proposedAccount.canUsePlan ? "plan permission granted" : "identity only; plan permission unavailable"})? [y/N] `,
                      { signal: options.signal },
                    )
                  ).trim(),
                );
              } finally {
                prompt.close();
              }
            }
            if (!confirmed) {
              await controller.cancelSignIn(attempt.attemptId);
              write("Sign-in cancelled. Existing selection preserved.");
              return 1;
            }
            write(
              JSON.stringify({
                account: await controller.confirmAccount(
                  attempt.attemptId,
                  status.expectedRevision,
                ),
              }),
            );
            break;
          }
          if (!["pending", "exchanging"].includes(status.state))
            throw new Error("chatgpt_cli_sign_in_incomplete");
          await delay(500, undefined, { signal: options.signal });
        }
      } finally {
        await controller.close();
      }
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const hints: Record<string, string> = {
      chatgpt_cli_interactive_required:
        "Sign-in needs an interactive terminal and local browser. Use protected handoff for a server.",
      chatgpt_cli_browser_unavailable:
        "The local browser could not be opened. New registrations can use --manual-link on the same computer.",
      chatgpt_cli_private_link_requires_browser:
        "Returning sign-in must open directly in the local browser; an ID-token hint cannot be printed.",
      chatgpt_cli_sign_in_incomplete:
        "Sign-in was not completed. Existing account selection was preserved. Start a fresh attempt.",
      chatgpt_registration_revision_conflict:
        "The account changed. Inspect status and use its current revision before retrying.",
      chatgpt_transfer_not_ready:
        "This transfer is not ready or was already consumed. Do not replay a prepared/consuming record; sign in again.",
      chatgpt_transfer_target_host_mismatch:
        "The transfer belongs to another target host. Prepare the intended target and export a fresh session.",
      chatgpt_transfer_target_signed_in:
        "The target already has a signed-in account. Its credentials were preserved.",
      chatgpt_transfer_expired:
        "The transfer expired. Sign in locally and prepare a fresh transfer.",
      chatgpt_transfer_requires_refresh:
        "This session expires too soon to transfer. Sign in again on this computer with the saved registration, then export its new revision.",
    };
    writeError(
      hints[message] ??
        "Connection action could not be confirmed. Existing valid credentials are preserved unless a source export already retired them; inspect status and the protected transfer state before trying again.",
    );
    return 1;
  } finally {
    if (ownsDatabase) {
      const { closeDatabase } = await import("@workspace/db");
      await closeDatabase();
    }
  }
}
