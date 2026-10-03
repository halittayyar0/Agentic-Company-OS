import { z } from "zod";
import { OwnerPrivateStorage } from "@workspace/ai-server/owner-private-storage";
import type {
  ChatGPTRegistrationInput,
  ChatGPTRegistrationStore,
} from "@workspace/ai-server/chatgpt-plan-types";
import { createChatGPTIdentityVerifier } from "./chatgpt-identity";
import { ChatGPTRegistrationConflict } from "./chatgpt-registration-store";

const FILE = "session-transfer.json";
const host = z
  .string()
  .regex(
    /^urn:uuid:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u,
  );
const bounded = (maximum = 512) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => !/[\r\n\0]/u.test(value));
const instant = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const registration = z
  .object({
    id: z.string().uuid(),
    hostId: host,
    clientId: bounded(),
    accountId: bounded(),
    subject: bounded(),
    email: bounded().optional(),
    displayName: bounded().optional(),
    credentials: z
      .object({
        accessToken: bounded(16_384),
        refreshToken: bounded(16_384).optional(),
        idToken: bounded(16_384),
        grants: z
          .array(bounded(256).refine((value) => !/\s/u.test(value)))
          .max(64),
        expiresAt: instant,
        earliestRefreshAt: instant.optional(),
      })
      .strict(),
  })
  .strict();
const parcel = z
  .object({
    format: z.literal(1),
    state: z.literal("ready"),
    targetHostId: host,
    expiresAt: instant,
    sourceRevision: z.number().int().positive(),
    registration,
  })
  .strict();

/** Explicit credential transfer, not logout: do not revoke the session the target will own. */
export async function exportChatGPTSession(input: {
  store: ChatGPTRegistrationStore;
  registrationId: string;
  expectedRevision: number;
  targetHostId: string;
  directory: string;
  now?: () => number;
}): Promise<{ sourceSignedOut: true; transferReady: true; expiresAt: number }> {
  const targetHostId = host.parse(input.targetHostId);
  const storage = new OwnerPrivateStorage(input.directory);
  await storage.initialize(true);
  return storage.withLock(async () => {
    const prepared = await input.store.withRegistrationRefreshLock(
      input.registrationId,
      async (locked) => {
        const record = await locked.readRegistration(input.registrationId);
        if (!record || record.revision !== input.expectedRevision)
          throw new ChatGPTRegistrationConflict();
        if (!record.credentials)
          throw new Error("chatgpt_transfer_sign_in_required");
        if (
          record.credentials.expiresAt <=
          (input.now?.() ?? Date.now()) + 60_000
        )
          throw new Error("chatgpt_transfer_requires_refresh");
        if (record.hostId === targetHostId)
          throw new Error("chatgpt_transfer_distinct_host_required");
        const {
          revision: _revision,
          updatedAt: _updatedAt,
          ...selected
        } = record;
        const value = {
          format: 1 as const,
          state: "ready" as const,
          targetHostId,
          expiresAt: (input.now?.() ?? Date.now()) + 10 * 60_000,
          sourceRevision: record.revision + 1,
          registration: selected,
        };
        parcel.parse(value);
        // A crash before source commit leaves an explicitly unimportable record.
        await storage.write(
          FILE,
          JSON.stringify({ ...value, state: "prepared" }),
        );
        await locked.replaceRegistration(record.revision, {
          ...selected,
          credentials: null,
        });
        return value;
      },
    );
    // PostgreSQL must commit the retirement before any transferable record is ready.
    await storage.write(FILE, JSON.stringify(prepared));
    return {
      sourceSignedOut: true,
      transferReady: true,
      expiresAt: prepared.expiresAt,
    };
  });
}

/** Import only an owner-protected, ready record addressed to this existing target host. */
export async function importChatGPTSession(input: {
  store: ChatGPTRegistrationStore;
  directory: string;
  expectedRevision: number;
  fetch?: typeof fetch;
  now?: () => number;
}) {
  const storage = new OwnerPrivateStorage(input.directory);
  // Never create or silently repair an incoming directory's protection.
  return storage.withLock(async () => {
    let decoded: unknown;
    try {
      decoded = JSON.parse((await storage.read(FILE)) ?? "null");
    } catch {
      throw new Error("chatgpt_transfer_invalid");
    }
    if (
      !decoded ||
      typeof decoded !== "object" ||
      !("state" in decoded) ||
      decoded.state !== "ready"
    )
      throw new Error("chatgpt_transfer_not_ready");
    const parsed = parcel.safeParse(decoded);
    if (!parsed.success) throw new Error("chatgpt_transfer_invalid");
    const value = parsed.data,
      now = input.now?.() ?? Date.now();
    if (
      now >= value.expiresAt ||
      value.expiresAt > now + 10 * 60_000 ||
      value.registration.credentials.expiresAt <= now
    )
      throw new Error("chatgpt_transfer_expired");
    const targetHostId = await input.store.getHostId();
    if (
      value.targetHostId !== targetHostId ||
      value.registration.hostId === targetHostId
    )
      throw new Error("chatgpt_transfer_target_host_mismatch");
    const identity = await createChatGPTIdentityVerifier({
      fetch: input.fetch,
      now: input.now,
    })(value.registration.credentials.idToken, value.registration.clientId, {
      subject: value.registration.subject,
    });
    if (identity.accountId !== value.registration.accountId)
      throw new Error("chatgpt_transfer_identity_mismatch");
    const account = await input.store.withRegistrationRefreshLock(
      value.registration.id,
      async (locked) => {
        const existing = (await locked.listPublicStatus()).find(
          (entry) => entry.accountId === identity.accountId,
        );
        const id = existing?.id ?? value.registration.id;
        const current = await locked.readRegistration(id);
        if (
          (current?.revision ?? 0) !== input.expectedRevision ||
          (current && current.accountId !== identity.accountId)
        )
          throw new ChatGPTRegistrationConflict();
        if (current?.credentials)
          throw new Error("chatgpt_transfer_target_signed_in");
        const replacement: ChatGPTRegistrationInput = {
          id,
          hostId: targetHostId,
          clientId: value.registration.clientId,
          accountId: identity.accountId,
          subject: identity.subject,
          ...(identity.email ? { email: identity.email } : {}),
          ...(identity.displayName
            ? { displayName: identity.displayName }
            : {}),
          credentials: value.registration.credentials,
        };
        // Consume before the DB write. A crash/failed commit refuses automatic replay;
        // a successful import can never overwrite a later rotating token with this copy.
        await storage.write(
          FILE,
          JSON.stringify({ ...value, state: "consuming" }),
        );
        const saved = await locked.replaceRegistration(
          input.expectedRevision,
          replacement,
        );
        await locked.activateRegistration(saved.id, saved.revision);
        return (await locked.readPublicStatus(saved.id))!;
      },
    );
    let transferFileCleared = false;
    try {
      await storage.write(
        FILE,
        JSON.stringify({
          format: 1,
          state: "consumed",
          targetHostId,
          registrationId: account.id,
        }),
      );
      transferFileCleared = true;
    } catch {
      /* Report a committed import separately from unsuccessful file cleanup. */
    }
    return { account, transferFileCleared };
  });
}
