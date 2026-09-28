import type { BrowserSessionIdentity, RawInputPayload } from "./vm/browser";
import type { RuntimeEncryptedEnvelope } from "./runtime-control-crypto";
import type { OperatorRequestOwner } from "./operator-requests";

export interface RuntimeBrowserSessionAdvertisement extends BrowserSessionIdentity {
  agentId: number;
}

interface BrowserCommandBase {
  agentId: number;
  expectedSession: BrowserSessionIdentity | null;
  /** Required for effectful operator actions; transported only in the encrypted envelope. */
  operatorOwner?: OperatorRequestOwner;
}

export type RuntimeBrowserCommand =
  | (BrowserCommandBase & { kind: "browser_control_state" })
  | (BrowserCommandBase & { kind: "browser_take_over" })
  | (BrowserCommandBase & {
      kind: "browser_heartbeat" | "browser_release";
      leaseId: string;
    })
  | (BrowserCommandBase & { kind: "browser_view" })
  | (BrowserCommandBase & {
      kind: "browser_navigate";
      leaseId: string;
      url: string;
    })
  | (BrowserCommandBase & {
      kind: "browser_input";
      leaseId: string;
      input: RawInputPayload;
    })
  | (BrowserCommandBase & {
      kind: "browser_close";
      leaseId: string | null;
    });

export type RuntimeBrowserCommandInput = RuntimeBrowserCommand extends infer C
  ? C extends RuntimeBrowserCommand
    ? Omit<C, "expectedSession">
    : never
  : never;

export interface RuntimeControlDelivery {
  id: string;
  envelope: RuntimeEncryptedEnvelope;
}

export interface RuntimeControlAck {
  id: string;
  ok: boolean;
  resultEnvelope?: RuntimeEncryptedEnvelope;
  failureKind?: string;
  sanitizedError?: string;
  session: RuntimeBrowserSessionAdvertisement | null;
}
