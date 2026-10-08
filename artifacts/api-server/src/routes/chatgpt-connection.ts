import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { PlanInferenceError } from "@workspace/ai-server";
import { retryChatGPTPlanQuota } from "../lib/chatgpt-plan-admission";
import type { ChatGPTRegistrationStore } from "@workspace/ai-server/chatgpt-plan-types";
import { ChatGPTRegistrationConflict } from "../lib/chatgpt-registration-store";
import {
  ChatGPTSessionError,
  type createChatGPTSessionManager,
} from "../lib/chatgpt-session";
import type { createChatGPTSignInController } from "../lib/chatgpt-sign-in";

const uuid = z.string().uuid();
const revision = z
  .object({
    expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
const begin = z
  .object({
    callbackLocation: z.literal("same-computer"),
    registrationId: uuid.optional(),
    retryAttemptId: uuid.optional(),
    requestPlanPermission: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      !(value.registrationId && value.retryAttemptId) &&
      !(
        value.requestPlanPermission &&
        !value.registrationId &&
        !value.retryAttemptId
      ),
  );
const retryPlan = revision.extend({ pauseId: uuid }).strict();

export interface ChatGPTConnectionDependencies {
  store(): Promise<ChatGPTRegistrationStore>;
  controller(): Promise<ReturnType<typeof createChatGPTSignInController>>;
  sessions(): Promise<ReturnType<typeof createChatGPTSessionManager>>;
}

function localCallbackRequest(req: Request): boolean {
  const hostname = req.hostname.toLowerCase();
  return (
    ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname) &&
    ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      req.socket.remoteAddress ?? "",
    ) &&
    !req.header("forwarded") &&
    !req.header("x-forwarded-for") &&
    !req.header("x-forwarded-host")
  );
}

/** Mounted only behind the application's operator authentication and origin guard. */
export function createChatGPTConnectionRouter(
  dependencies: ChatGPTConnectionDependencies,
): IRouter {
  const router: IRouter = Router();
  function failure(res: Response, error: unknown): void {
    if (error instanceof ChatGPTRegistrationConflict) {
      res.status(409).json({ error: "registration_changed" });
      return;
    }
    if (error instanceof ChatGPTSessionError) {
      res
        .status(error.kind === "temporary" ? 503 : 409)
        .json({ error: error.kind });
      return;
    }
    if (error instanceof PlanInferenceError) {
      res
        .status(error.kind === "temporary" ? 503 : 409)
        .json({ error: error.kind });
      return;
    }
    const message = error instanceof Error ? error.message : "";
    const missing = [
      "chatgpt_sign_in_attempt_missing",
      "chatgpt_registration_missing",
    ].includes(message);
    const conflict = [
      "chatgpt_sign_in_review_required",
      "chatgpt_sign_in_confirmation_in_progress",
      "chatgpt_sign_in_retry_unavailable",
      "chatgpt_registration_not_signed_in",
    ].includes(message);
    if (missing) res.status(404).json({ error: "connection_not_found" });
    else if (conflict)
      res.status(409).json({
        error: message.replace(/^chatgpt_(?:sign_in_|registration_)/u, ""),
      });
    else if (message === "chatgpt_sign_in_attempt_limit")
      res.status(429).json({ error: "attempt_limit" });
    else res.status(503).json({ error: "connection_unavailable" });
  }
  const base = "/connections/chatgpt";
  router.get(base, async (_req, res) => {
    try {
      const store = await dependencies.store();
      const registrations = await store.listPublicStatus();
      const active = await store.readActiveRegistration();
      res.json({ registrations, activeRegistrationId: active?.id ?? null });
    } catch (error) {
      failure(res, error);
    }
  });
  router.post(`${base}/sign-in`, async (req, res) => {
    const parsed = begin.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_connection_request" });
      return;
    }
    // A phone or remote browser cannot reach this process's private callback.
    // Loopback plus explicit acknowledgement is required; server installs use CLI handoff.
    if (!localCallbackRequest(req)) {
      res.status(422).json({ error: "protected_handoff_required" });
      return;
    }
    try {
      const controller = await dependencies.controller();
      res.status(201).json(await controller.beginSignIn(parsed.data));
    } catch (error) {
      failure(res, error);
    }
  });
  router.get(`${base}/sign-in/:attemptId`, async (req, res) => {
    const id = uuid.safeParse(req.params.attemptId);
    if (!id.success) {
      res.status(400).json({ error: "invalid_connection_request" });
      return;
    }
    try {
      res.json(
        await (await dependencies.controller()).readSignInStatus(id.data),
      );
    } catch (error) {
      failure(res, error);
    }
  });
  router.delete(`${base}/sign-in/:attemptId`, async (req, res) => {
    const id = uuid.safeParse(req.params.attemptId);
    if (!id.success) {
      res.status(400).json({ error: "invalid_connection_request" });
      return;
    }
    try {
      await (await dependencies.controller()).cancelSignIn(id.data);
      res.status(204).end();
    } catch (error) {
      failure(res, error);
    }
  });
  router.post(`${base}/sign-in/:attemptId/confirm`, async (req, res) => {
    const id = uuid.safeParse(req.params.attemptId),
      parsed = revision.safeParse(req.body);
    if (!id.success || !parsed.success) {
      res.status(400).json({ error: "invalid_connection_request" });
      return;
    }
    try {
      res.json(
        await (
          await dependencies.controller()
        ).confirmAccount(id.data, parsed.data.expectedRevision),
      );
    } catch (error) {
      failure(res, error);
    }
  });
  router.post(`${base}/accounts/:registrationId/select`, async (req, res) => {
    const id = uuid.safeParse(req.params.registrationId),
      parsed = revision.safeParse(req.body);
    if (!id.success || !parsed.success) {
      res.status(400).json({ error: "invalid_connection_request" });
      return;
    }
    try {
      const store = await dependencies.store();
      const status = await store.withRegistrationRefreshLock(
        id.data,
        async (locked) => {
          const registration = await locked.readRegistration(id.data);
          if (!registration) throw new Error("chatgpt_registration_missing");
          if (registration.revision !== parsed.data.expectedRevision)
            throw new ChatGPTRegistrationConflict();
          if (!registration.credentials)
            throw new Error("chatgpt_registration_not_signed_in");
          await locked.activateRegistration(
            id.data,
            parsed.data.expectedRevision,
          );
          return (await locked.readPublicStatus(id.data))!;
        },
      );
      res.json(status);
    } catch (error) {
      failure(res, error);
    }
  });
  router.delete(
    `${base}/accounts/:registrationId/session`,
    async (req, res) => {
      const id = uuid.safeParse(req.params.registrationId);
      if (!id.success) {
        res.status(400).json({ error: "invalid_connection_request" });
        return;
      }
      try {
        res.json(await (await dependencies.sessions()).signOut(id.data));
      } catch (error) {
        failure(res, error);
      }
    },
  );
  router.post(
    `${base}/accounts/:registrationId/plan/retry`,
    async (req, res) => {
      const id = uuid.safeParse(req.params.registrationId),
        parsed = retryPlan.safeParse(req.body);
      if (!id.success || !parsed.success) {
        res.status(400).json({ error: "invalid_connection_request" });
        return;
      }
      try {
        res.json(
          await retryChatGPTPlanQuota(
            await dependencies.store(),
            id.data,
            parsed.data.expectedRevision,
            parsed.data.pauseId,
          ),
        );
      } catch (error) {
        failure(res, error);
      }
    },
  );
  return router;
}
