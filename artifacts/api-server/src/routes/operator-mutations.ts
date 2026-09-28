import { Router, type Request, type Response } from "express";
import {
  ExecVmCommandBody,
  ExecVmCommandResponse,
  GetOperatorRequestResponse,
  NavigateBrowserBody,
  SendBrowserInputBody,
  CloseBrowserSessionBody,
  UpdateBrowserControlBody,
  UpdateBrowserControlResponse,
  NavigateBrowserResponse,
  SendBrowserInputResponse,
  CloseBrowserSessionResponse,
  GetBrowserControlResponse,
  GetBrowserViewResponse,
  DeleteVmFileResponse,
} from "@workspace/api-zod";
import type {
  OperatorRequestKind,
  OperatorRequestFailureCode,
} from "@workspace/db";
import {
  beforeOperatorEffect,
  operatorEffectGuard,
  completeOperatorRequest,
  failOperatorRequest,
  readOperatorRequest,
  reserveOperatorRequest,
  OperatorRequestError,
  type OperatorRequestOwner,
  type OperatorReceipt,
} from "../lib/operator-requests";
import {
  execFounderShell,
  execInSandbox,
  getSandboxRoot,
  isFounderShellEnabled,
  type VmExecOutcome,
} from "../lib/vm/sandbox";
import {
  captureView,
  closeSession,
  heartbeatBrowserControl,
  navigateTo,
  releaseBrowserControl,
  sendRawInput,
  takeOverBrowserControl,
  BrowserActionOutcomeUnknownError,
  type RawInputPayload,
} from "../lib/vm/browser";
import { BrowserControlError } from "../lib/vm/browser-control";
import { EmergencyStopError } from "../lib/orchestrator/runtime-emergency-stop";
import { LocalEmergencyStopError } from "../lib/orchestrator/local-emergency-epoch";
import {
  dispatchBrowserRuntimeCommand,
  noBrowserSessionResponse,
  RuntimeControlUnavailableError,
} from "../lib/runtime-control-api";
import type { OperatorActivityHandle } from "./vm";
import type { WorkspaceLocale } from "../lib/workspace-locale";
import { getTerminalCopy } from "../lib/vm/terminal-localization";

type ActivityHooks = {
  begin(
    agentId: number,
    surface: "browser" | "terminal",
    tool: string,
    detail?: Record<string, unknown>,
  ): Promise<OperatorActivityHandle>;
  finish(
    handle: OperatorActivityHandle,
    summary: string,
    status: "succeeded" | "failed" | "blocked" | "unknown",
    detail?: Record<string, unknown>,
    severity?: "info" | "warning" | "critical",
  ): Promise<void>;
};
const requestIdPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function scope(req: Request, res: Response): number | null {
  const raw = req.params.agentId;
  const id = Number(raw);
  if (
    typeof raw !== "string" ||
    !/^[1-9]\d*$/.test(raw) ||
    !Number.isInteger(id) ||
    id > 2147483647 ||
    Object.keys(req.query).length
  ) {
    res.status(400).json({
      code: "OPERATOR_INVALID_REQUEST",
      error: "An exact request scope is required.",
    });
    return null;
  }
  return id;
}
function failure(error: unknown): {
  status: number;
  code: string;
  reason: OperatorRequestFailureCode;
} {
  if (error instanceof OperatorRequestError) {
    const status =
      error.code === "invalid_request"
        ? 400
        : error.code === "execution_blocked"
          ? 423
          : error.code === "agent_missing"
            ? 404
            : error.code === "key_unavailable"
              ? 503
              : 409;
    return {
      status,
      code: `OPERATOR_${error.code.toUpperCase()}`,
      reason:
        error.code === "execution_blocked"
          ? "execution_blocked"
          : error.code === "key_unavailable"
            ? "authority_unavailable"
            : "execution_error",
    };
  }
  if (
    error instanceof EmergencyStopError ||
    error instanceof LocalEmergencyStopError
  )
    return {
      status: 423,
      code: "EMERGENCY_STOP_ACTIVE",
      reason: "execution_blocked",
    };
  if (error instanceof BrowserControlError)
    return {
      status: 409,
      code: "BROWSER_CONTROL_CONFLICT",
      reason: "invalid_session",
    };
  if (error instanceof BrowserActionOutcomeUnknownError)
    return {
      status: 503,
      code: "BROWSER_RUNTIME_OUTCOME_UNKNOWN",
      reason: "execution_error",
    };
  if (error instanceof RuntimeControlUnavailableError)
    return {
      status: error.status,
      code: error.code,
      reason: "transport_unavailable",
    };
  if (error instanceof HostAuthorityUnavailable)
    return {
      status: 403,
      code: "OPERATOR_AUTHORITY_UNAVAILABLE",
      reason: "authority_unavailable",
    };
  return {
    status: 503,
    code: "OPERATOR_REQUEST_UNAVAILABLE",
    reason: "execution_error",
  };
}
class HostAuthorityUnavailable extends Error {}

export function createOperatorMutationRouter(activity: ActivityHooks) {
  const router = Router();
  const split = process.env.RUNTIME_ROLE === "api";
  async function run(
    res: Response,
    input: {
      agentId: number;
      requestId: string;
      kind: OperatorRequestKind;
      input: unknown;
      locale?: WorkspaceLocale;
    },
    execute: (owner: OperatorRequestOwner) => Promise<unknown>,
    parse: (value: unknown) => unknown,
  ) {
    let owner: OperatorRequestOwner | null = null;
    let handle: OperatorActivityHandle | null = null;
    const terminal = input.kind.startsWith("terminal_");
    const copy = input.locale ? getTerminalCopy(input.locale) : null;
    try {
      const claim = await reserveOperatorRequest(input);
      if (!claim.admitted) {
        res.json(
          parse({
            receipt: claim.receipt,
            result: terminal ? claim.receipt.result : null,
          }),
        );
        return;
      }
      owner = claim.owner;
      handle = await activity.begin(
        input.agentId,
        terminal ? "terminal" : "browser",
        input.kind,
        { requestId: input.requestId, contentStored: false },
      );
      const result = await execute(owner);
      const receipt = await completeOperatorRequest(
        owner,
        terminal ? (result as VmExecOutcome) : undefined,
      );
      await activity.finish(
        handle,
        copy?.operatorComplete ?? "Operator request completed.",
        receipt.terminal?.ok === false ? "failed" : "succeeded",
        { requestId: input.requestId },
        input.kind === "terminal_host" ? "critical" : "info",
      );
      res.json(parse({ receipt, result }));
    } catch (error) {
      const failed = failure(error);
      let receipt: OperatorReceipt | null = null;
      if (owner) {
        try {
          receipt = await failOperatorRequest(owner, failed.reason);
        } catch {
          receipt = await readOperatorRequest(
            input.agentId,
            input.requestId,
          ).catch(() => null);
        }
      }
      if (handle)
        await activity.finish(
          handle,
          copy?.operatorReview ?? "Operator request outcome requires review.",
          receipt?.state === "unknown" ? "unknown" : "blocked",
          {
            requestId: input.requestId,
            failureCode: receipt?.failureCode ?? failed.reason,
          },
          "warning",
        );
      res.status(receipt?.state === "unknown" ? 503 : failed.status).json({
        code: failed.code,
        error:
          "The request could not be confirmed. Inspect its receipt before starting another action.",
        ...(receipt ? { receipt } : {}),
      });
    }
  }
  function invalid(res: Response) {
    res.status(400).json({
      code: "OPERATOR_INVALID_REQUEST",
      error: "A valid action with its original request identity is required.",
    });
  }
  router.get(
    "/agents/:agentId/operator-requests/:requestId",
    async (req, res) => {
      const agentId = scope(req, res);
      if (agentId === null) return;
      if (
        typeof req.params.requestId !== "string" ||
        !requestIdPattern.test(req.params.requestId)
      ) {
        invalid(res);
        return;
      }
      try {
        const receipt = await readOperatorRequest(
          agentId,
          req.params.requestId,
        );
        if (!receipt) {
          res.status(404).json({
            code: "OPERATOR_REQUEST_NOT_FOUND",
            error: "No accepted request exists in this scope.",
          });
          return;
        }
        res.setHeader("Cache-Control", "no-store");
        res.json(GetOperatorRequestResponse.parse(receipt));
      } catch {
        res.status(503).json({
          code: "OPERATOR_RECEIPT_UNAVAILABLE",
          error: "The receipt could not be read.",
        });
      }
    },
  );
  router.post("/agents/:agentId/vm/exec", async (req, res) => {
    const agentId = scope(req, res);
    if (agentId === null) return;
    if (req.body?.as === "agent_sudo") {
      res.status(403).json({
        code: "OPERATOR_AUTHORITY_UNAVAILABLE",
        error: "Agent sudo requires a separate exact-command approval.",
      });
      return;
    }
    const parsed = ExecVmCommandBody.strict().safeParse(req.body);
    if (!parsed.success || !parsed.data.command.trim()) {
      invalid(res);
      return;
    }
    const { requestId, command, locale } = parsed.data;
    const authority = parsed.data.as ?? "sandbox";
    await run(
      res,
      {
        agentId,
        requestId,
        kind: authority === "founder" ? "terminal_host" : "terminal_sandbox",
        // Preserve the exact legacy hash when locale was not part of the intent.
        input: {
          command,
          as: authority,
          ...(locale === undefined ? {} : { locale }),
        },
        locale: locale ?? "tr",
      },
      async (owner) => {
        const guard = operatorEffectGuard(owner);
        if (authority === "founder") {
          if (!isFounderShellEnabled()) throw new HostAuthorityUnavailable();
          return execFounderShell(
            command,
            getSandboxRoot(agentId),
            guard,
            locale,
          );
        }
        return execInSandbox(agentId, command, undefined, guard, locale);
      },
      (value) => ExecVmCommandResponse.parse(value),
    );
  });
  router.post("/agents/:agentId/browser/control", async (req, res) => {
    const agentId = scope(req, res);
    if (agentId === null) return;
    const parsed = UpdateBrowserControlBody.strict().safeParse(req.body);
    if (!parsed.success) {
      invalid(res);
      return;
    }
    const { action, leaseId, requestId } = parsed.data;
    if (action === "heartbeat") {
      if (!leaseId || requestId !== undefined) {
        invalid(res);
        return;
      }
      try {
        const result = GetBrowserControlResponse.parse(
          split
            ? await dispatchBrowserRuntimeCommand({
                kind: "browser_heartbeat",
                agentId,
                leaseId,
              })
            : await heartbeatBrowserControl(agentId, leaseId),
        );
        res.json(UpdateBrowserControlResponse.parse({ receipt: null, result }));
      } catch (error) {
        const failed = failure(error);
        res.status(failed.status).json({
          code: failed.code,
          error: "Browser control could not be refreshed.",
        });
      }
      return;
    }
    if (
      !requestId ||
      (action === "release" && !leaseId) ||
      (action === "take_over" && leaseId != null)
    ) {
      invalid(res);
      return;
    }
    const kind =
      action === "take_over" ? "browser_take_over" : "browser_release";
    await run(
      res,
      { agentId, requestId, kind, input: { action, leaseId: leaseId ?? null } },
      async (owner) => {
        const result = split
          ? await dispatchBrowserRuntimeCommand(
              action === "take_over"
                ? { kind: "browser_take_over", agentId, operatorOwner: owner }
                : {
                    kind: "browser_release",
                    agentId,
                    leaseId: leaseId!,
                    operatorOwner: owner,
                  },
              { allowSessionAllocation: action === "take_over" },
            )
          : action === "take_over"
            ? await takeOverBrowserControl(agentId, undefined, () =>
                beforeOperatorEffect(owner),
              )
            : await releaseBrowserControl(agentId, leaseId!, () =>
                beforeOperatorEffect(owner),
              );
        return GetBrowserControlResponse.parse(result);
      },
      (value) => UpdateBrowserControlResponse.parse(value),
    );
  });
  router.post("/agents/:agentId/browser/navigate", async (req, res) => {
    const agentId = scope(req, res);
    if (agentId === null) return;
    const parsed = NavigateBrowserBody.strict().safeParse(req.body);
    if (!parsed.success) {
      invalid(res);
      return;
    }
    const { requestId, url, leaseId } = parsed.data;
    await run(
      res,
      { agentId, requestId, kind: "browser_navigate", input: { url, leaseId } },
      async (owner) => {
        if (split)
          return GetBrowserViewResponse.parse(
            await dispatchBrowserRuntimeCommand({
              kind: "browser_navigate",
              agentId,
              url,
              leaseId,
              operatorOwner: owner,
            }),
          );
        await navigateTo(agentId, url, "operator", leaseId, () =>
          beforeOperatorEffect(owner),
        );
        return GetBrowserViewResponse.parse(await captureView(agentId));
      },
      (value) => NavigateBrowserResponse.parse(value),
    );
  });
  router.post("/agents/:agentId/browser/input", async (req, res) => {
    const agentId = scope(req, res);
    if (agentId === null) return;
    const parsed = SendBrowserInputBody.strict().safeParse(req.body);
    if (!parsed.success) {
      invalid(res);
      return;
    }
    const { requestId, leaseId, ...input } = parsed.data;
    if (!requestId || !validBrowserInput(input)) {
      invalid(res);
      return;
    }
    await run(
      res,
      {
        agentId,
        requestId,
        kind: "browser_input",
        input: { ...input, leaseId },
      },
      async (owner) => {
        if (split)
          return DeleteVmFileResponse.parse(
            await dispatchBrowserRuntimeCommand({
              kind: "browser_input",
              agentId,
              leaseId,
              input,
              operatorOwner: owner,
            }),
          );
        await sendRawInput(agentId, input, leaseId, undefined, () =>
          beforeOperatorEffect(owner),
        );
        return { path: input.action, deleted: true };
      },
      (value) => SendBrowserInputResponse.parse(value),
    );
  });
  router.delete("/agents/:agentId/browser/close", async (req, res) => {
    const agentId = scope(req, res);
    if (agentId === null) return;
    const parsed = CloseBrowserSessionBody.strict().safeParse(req.body);
    if (!parsed.success) {
      invalid(res);
      return;
    }
    const { requestId, leaseId } = parsed.data;
    await run(
      res,
      { agentId, requestId, kind: "browser_close", input: { leaseId } },
      async (owner) => {
        if (split) {
          if (await noBrowserSessionResponse(agentId))
            return { path: "browser-session", deleted: false };
          return DeleteVmFileResponse.parse(
            await dispatchBrowserRuntimeCommand({
              kind: "browser_close",
              agentId,
              leaseId,
              operatorOwner: owner,
            }),
          );
        }
        return {
          path: "browser-session",
          deleted: await closeSession(
            agentId,
            leaseId ?? undefined,
            undefined,
            () => beforeOperatorEffect(owner),
          ),
        };
      },
      (value) => CloseBrowserSessionResponse.parse(value),
    );
  });
  return router;
}
function validBrowserInput(input: RawInputPayload) {
  const point = (...keys: (keyof RawInputPayload)[]) =>
    keys.every((key) => typeof input[key] === "number");
  switch (input.action) {
    case "click":
    case "dblclick":
    case "move":
      return point("x", "y");
    case "drag":
      return point("x", "y", "toX", "toY");
    case "wheel":
      return point("deltaX", "deltaY");
    case "keydown":
      return (
        typeof input.key === "string" &&
        /^[A-Za-z0-9+_-]{1,64}$/.test(input.key)
      );
    case "type_text":
      return (
        typeof input.text === "string" &&
        input.text.length > 0 &&
        input.text.length <= 4096 &&
        !input.text.includes("\0") &&
        Buffer.from(input.text, "utf8").toString("utf8") === input.text
      );
    default:
      return false;
  }
}
