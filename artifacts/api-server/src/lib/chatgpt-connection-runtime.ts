import path from "node:path";
import { homedir } from "node:os";
import type { ChatGPTRegistrationStore } from "@workspace/ai-server/chatgpt-plan-types";
import {
  createFileChatGPTRegistrationStore,
  createPostgresChatGPTRegistrationStore,
} from "./chatgpt-registration-store";
import { createChatGPTSessionManager } from "./chatgpt-session";
import { createChatGPTSignInController } from "./chatgpt-sign-in";
import { readRuntimeControlKey } from "./runtime-control-crypto";

/** Lazy so a normal installation creates no credential files or OAuth listeners. */
export function createChatGPTConnectionRuntime(options: {
  store(): Promise<ChatGPTRegistrationStore>;
  fetch?: typeof fetch;
  now?: () => number;
}) {
  let closed = false;
  let storePromise: Promise<ChatGPTRegistrationStore> | undefined;
  let controllerPromise:
    Promise<ReturnType<typeof createChatGPTSignInController>> | undefined;
  let sessionPromise:
    Promise<ReturnType<typeof createChatGPTSessionManager>> | undefined;
  let closing: Promise<void> | undefined;
  function assertOpen() {
    if (closed) throw new Error("chatgpt_connection_runtime_closed");
  }
  async function store(): Promise<ChatGPTRegistrationStore> {
    assertOpen();
    storePromise ??= options.store().catch((error) => {
      storePromise = undefined;
      throw error;
    });
    const value = await storePromise;
    assertOpen();
    return value;
  }
  return {
    store,
    async controller() {
      assertOpen();
      controllerPromise ??= store()
        .then((value) => {
          assertOpen();
          return createChatGPTSignInController({ ...options, store: value });
        })
        .catch((error) => {
          controllerPromise = undefined;
          throw error;
        });
      return controllerPromise;
    },
    async sessions() {
      assertOpen();
      sessionPromise ??= store()
        .then((value) => {
          assertOpen();
          return createChatGPTSessionManager({ ...options, store: value });
        })
        .catch((error) => {
          sessionPromise = undefined;
          throw error;
        });
      return sessionPromise;
    },
    close(): Promise<void> {
      closed = true;
      closing ??= (async () => {
        const controller = await controllerPromise?.catch(() => undefined);
        await controller?.close();
      })();
      return closing;
    },
  };
}

export async function createRuntimeChatGPTRegistrationStore(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ChatGPTRegistrationStore> {
  const { db, dbReady, databaseBackend } = await import("@workspace/db");
  await dbReady;
  if (databaseBackend === "postgresql")
    return createPostgresChatGPTRegistrationStore(
      db,
      readRuntimeControlKey(environment),
    );
  if (
    environment.NODE_ENV === "production" ||
    environment.RUNTIME_ROLE === "api" ||
    environment.RUNTIME_ROLE === "worker"
  )
    throw new Error("chatgpt_registration_durable_database_required");
  const configured = environment.CHATGPT_STORAGE_DIRECTORY;
  if (
    configured !== undefined &&
    (!path.isAbsolute(configured) || configured !== configured.trim())
  )
    throw new Error("chatgpt_registration_directory_invalid");
  return createFileChatGPTRegistrationStore(
    configured ?? path.join(homedir(), ".agentic-company-os-chatgpt"),
  );
}

export const chatgptConnectionRuntime = createChatGPTConnectionRuntime({
  store: () => createRuntimeChatGPTRegistrationStore(),
});
