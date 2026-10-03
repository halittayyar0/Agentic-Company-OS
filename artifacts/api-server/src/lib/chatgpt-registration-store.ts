import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { OwnerPrivateStorage } from "@workspace/ai-server/owner-private-storage";
import type {
  ChatGPTRegistration,
  ChatGPTRegistrationAccess,
  ChatGPTRegistrationInput,
  ChatGPTRegistrationPublicStatus,
  ChatGPTRegistrationStore,
} from "@workspace/ai-server/chatgpt-plan-types";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const HOST =
  /^urn:uuid:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const FILE = "registrations.json";
interface RegistrationEnvelope {
  format: 1;
  revision: number;
  ciphertext: string;
  nonce: string;
  authTag: string;
}
interface RegistrationDocument {
  hostId: string;
  revision: number;
  registrations: ChatGPTRegistration[];
  activeRegistrationId?: string | null;
}

export class ChatGPTRegistrationConflict extends Error {
  constructor() {
    super("chatgpt_registration_revision_conflict");
    this.name = "ChatGPTRegistrationConflict";
  }
}

function boundedText(value: unknown, maximum = 512): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\r\n\0]/u.test(value)
  );
}

function validateInput(
  value: ChatGPTRegistrationInput,
): ChatGPTRegistrationInput {
  if (
    !value ||
    !UUID.test(value.id) ||
    !HOST.test(value.hostId) ||
    !boundedText(value.clientId) ||
    !boundedText(value.accountId) ||
    !boundedText(value.subject) ||
    (value.email !== undefined && !boundedText(value.email)) ||
    (value.displayName !== undefined && !boundedText(value.displayName))
  )
    throw new Error("chatgpt_registration_invalid");
  const credentials = value.credentials;
  if (
    credentials !== null &&
    (!credentials ||
      !boundedText(credentials.accessToken, 16_384) ||
      !boundedText(credentials.idToken, 16_384) ||
      (credentials.refreshToken !== undefined &&
        !boundedText(credentials.refreshToken, 16_384)) ||
      !Number.isSafeInteger(credentials.expiresAt) ||
      credentials.expiresAt <= 0 ||
      (credentials.earliestRefreshAt !== undefined &&
        (!Number.isSafeInteger(credentials.earliestRefreshAt) ||
          credentials.earliestRefreshAt <= 0)) ||
      !Array.isArray(credentials.grants) ||
      credentials.grants.length > 64 ||
      credentials.grants.some(
        (grant) => !boundedText(grant, 256) || /\s/u.test(grant),
      ) ||
      new Set(credentials.grants).size !== credentials.grants.length)
  )
    throw new Error("chatgpt_registration_invalid");
  return structuredClone({
    id: value.id,
    hostId: value.hostId,
    clientId: value.clientId,
    accountId: value.accountId,
    subject: value.subject,
    ...(value.email === undefined ? {} : { email: value.email }),
    ...(value.displayName === undefined
      ? {}
      : { displayName: value.displayName }),
    credentials:
      credentials === null
        ? null
        : {
            accessToken: credentials.accessToken,
            idToken: credentials.idToken,
            grants: credentials.grants,
            expiresAt: credentials.expiresAt,
            ...(credentials.refreshToken === undefined
              ? {}
              : { refreshToken: credentials.refreshToken }),
            ...(credentials.earliestRefreshAt === undefined
              ? {}
              : { earliestRefreshAt: credentials.earliestRefreshAt }),
          },
  });
}

function validateRegistration(value: ChatGPTRegistration): ChatGPTRegistration {
  if (
    !Number.isSafeInteger(value?.revision) ||
    value.revision < 1 ||
    !Number.isSafeInteger(value?.updatedAt) ||
    value.updatedAt <= 0
  )
    throw new Error("chatgpt_registration_invalid");
  return {
    ...validateInput(value),
    revision: value.revision,
    updatedAt: value.updatedAt,
  };
}

function status(
  registration: ChatGPTRegistration,
): ChatGPTRegistrationPublicStatus {
  const credentials = registration.credentials;
  return {
    id: registration.id,
    accountId: registration.accountId,
    ...(registration.email === undefined ? {} : { email: registration.email }),
    ...(registration.displayName === undefined
      ? {}
      : { displayName: registration.displayName }),
    revision: registration.revision,
    signedIn: credentials !== null,
    canUsePlan:
      credentials !== null &&
      credentials.grants.includes("resource.invoke") &&
      credentials.grants.includes("chatgpt.tokens.use.direct"),
    expiresAt: credentials?.expiresAt ?? null,
  };
}

function keyBytes(secret: string): Buffer {
  if (!boundedText(secret, 4096) || secret.length < 32)
    throw new Error("registration_storage_key_invalid");
  return createHash("sha256")
    .update("agentic-company-os/chatgpt-registration/key/v1\0")
    .update(secret)
    .digest();
}

function encrypt(
  value: unknown,
  revision: number,
  key: Buffer,
  context: string,
): RegistrationEnvelope {
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(
    Buffer.from(
      `agentic-company-os/chatgpt-registration/v1/${context}/${revision}`,
    ),
  );
  const plaintext = Buffer.from(JSON.stringify(value));
  if (plaintext.length > 90_000)
    throw new Error("chatgpt_registration_storage_full");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    format: 1,
    revision,
    ciphertext: ciphertext.toString("base64url"),
    nonce: nonce.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
  };
}

function decrypt<T>(
  value: RegistrationEnvelope,
  key: Buffer,
  context: string,
): T {
  try {
    if (
      !value ||
      value.format !== 1 ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 0 ||
      !boundedText(value.ciphertext, 125_000) ||
      !boundedText(value.nonce, 64) ||
      !boundedText(value.authTag, 64)
    )
      throw new Error("envelope");
    const nonce = Buffer.from(value.nonce, "base64url"),
      tag = Buffer.from(value.authTag, "base64url");
    if (nonce.length !== 12 || tag.length !== 16) throw new Error("envelope");
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(
      Buffer.from(
        `agentic-company-os/chatgpt-registration/v1/${context}/${value.revision}`,
      ),
    );
    decipher.setAuthTag(tag);
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(value.ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8"),
    ) as T;
  } catch {
    throw new Error("registration_storage_invalid");
  }
}

function assertReplacement(
  current: ChatGPTRegistration | null,
  expectedRevision: number,
  input: ChatGPTRegistrationInput,
  hostId: string,
): ChatGPTRegistration {
  if (
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0 ||
    expectedRevision >= Number.MAX_SAFE_INTEGER ||
    (current?.revision ?? 0) !== expectedRevision
  )
    throw new ChatGPTRegistrationConflict();
  const candidate = validateInput(input);
  if (
    candidate.hostId !== hostId ||
    (current &&
      (current.clientId !== candidate.clientId ||
        current.accountId !== candidate.accountId ||
        current.subject !== candidate.subject ||
        current.hostId !== candidate.hostId))
  )
    throw new Error("chatgpt_registration_identity_conflict");
  return {
    ...candidate,
    revision: expectedRevision + 1,
    updatedAt: Date.now(),
  };
}

export async function createFileChatGPTRegistrationStore(
  directory: string,
): Promise<ChatGPTRegistrationStore> {
  const storage = new OwnerPrivateStorage(directory);
  await storage.initialize();
  const secret = await storage.withLock(async () => {
    let key = await storage.read("registration.key");
    if (!key) {
      if (await storage.read(FILE))
        throw new Error("registration_storage_key_missing");
      key = randomBytes(32).toString("base64url");
      await storage.write("registration.key", key);
    }
    const keyBuffer = keyBytes(key);
    if (!(await storage.read(FILE)))
      await storage.write(
        FILE,
        JSON.stringify(
          encrypt(
            {
              hostId: `urn:uuid:${randomUUID()}`,
              revision: 0,
              registrations: [],
              activeRegistrationId: null,
            },
            0,
            keyBuffer,
            "file",
          ),
        ),
      );
    return keyBuffer;
  });

  async function readDocument(): Promise<RegistrationDocument> {
    try {
      const raw = await storage.read(FILE);
      if (!raw) throw new Error("missing");
      const envelope = JSON.parse(raw) as RegistrationEnvelope;
      const document = decrypt<RegistrationDocument>(envelope, secret, "file");
      if (
        !HOST.test(document.hostId) ||
        document.revision !== envelope.revision ||
        !Array.isArray(document.registrations) ||
        document.registrations.length > 64
      )
        throw new Error("document");
      document.registrations = document.registrations.map(validateRegistration);
      if (
        document.activeRegistrationId !== undefined &&
        document.activeRegistrationId !== null &&
        (!UUID.test(document.activeRegistrationId) ||
          !document.registrations.some(
            (entry) => entry.id === document.activeRegistrationId,
          ))
      )
        throw new Error("active_identity");
      if (
        document.registrations.some(
          (entry) => entry.hostId !== document.hostId,
        ) ||
        new Set(document.registrations.map((entry) => entry.id)).size !==
          document.registrations.length ||
        new Set(document.registrations.map((entry) => entry.accountId)).size !==
          document.registrations.length
      )
        throw new Error("identity");
      return document;
    } catch {
      throw new Error("registration_storage_invalid");
    }
  }

  const hostId = (await readDocument()).hostId;
  function access(
    locked: boolean,
    assertLock = () => {},
  ): ChatGPTRegistrationAccess {
    return {
      getHostId: async () => {
        assertLock();
        if ((await readDocument()).hostId !== hostId)
          throw new Error("registration_storage_invalid");
        return hostId;
      },
      readRegistration: async (id) => {
        assertLock();
        return structuredClone(
          (await readDocument()).registrations.find(
            (entry) => entry.id === id,
          ) ?? null,
        );
      },
      readPublicStatus: async (id) => {
        assertLock();
        const record = (await readDocument()).registrations.find(
          (entry) => entry.id === id,
        );
        return record ? status(record) : null;
      },
      readActiveRegistration: async () => {
        assertLock();
        const document = await readDocument();
        return structuredClone(
          document.registrations.find(
            (entry) => entry.id === document.activeRegistrationId,
          ) ?? null,
        );
      },
      activateRegistration: async (id, expectedRevision) => {
        assertLock();
        const activate = async () => {
          const document = await readDocument(),
            registration = document.registrations.find(
              (entry) => entry.id === id,
            );
          if (
            !registration ||
            registration.revision !== expectedRevision ||
            !Number.isSafeInteger(expectedRevision)
          )
            throw new ChatGPTRegistrationConflict();
          if (!registration.credentials)
            throw new Error("chatgpt_registration_sign_in_required");
          if (document.revision >= Number.MAX_SAFE_INTEGER)
            throw new Error("chatgpt_registration_storage_full");
          const next = {
            ...document,
            activeRegistrationId: id,
            revision: document.revision + 1,
          };
          assertLock();
          await storage.write(
            FILE,
            JSON.stringify(encrypt(next, next.revision, secret, "file")),
          );
        };
        return locked ? activate() : storage.withLock(activate);
      },
      listPublicStatus: async () => {
        assertLock();
        return (await readDocument()).registrations.map(status);
      },
      replaceRegistration: async (expectedRevision, input) => {
        assertLock();
        const replace = async () => {
          const document = await readDocument(),
            current =
              document.registrations.find((entry) => entry.id === input.id) ??
              null;
          const replacement = assertReplacement(
            current,
            expectedRevision,
            input,
            hostId,
          );
          if (
            document.registrations.some(
              (entry) =>
                entry.id !== replacement.id &&
                entry.accountId === replacement.accountId,
            )
          )
            throw new Error("chatgpt_registration_account_exists");
          const registrations = current
            ? document.registrations.map((entry) =>
                entry.id === replacement.id ? replacement : entry,
              )
            : [...document.registrations, replacement];
          if (
            registrations.length > 64 ||
            document.revision >= Number.MAX_SAFE_INTEGER
          )
            throw new Error("chatgpt_registration_storage_full");
          const next = {
            ...document,
            revision: document.revision + 1,
            registrations,
          };
          assertLock();
          await storage.write(
            FILE,
            JSON.stringify(encrypt(next, next.revision, secret, "file")),
          );
          return structuredClone(replacement);
        };
        return locked ? replace() : storage.withLock(replace);
      },
    };
  }
  return {
    ...access(false),
    withRegistrationRefreshLock: async (id, action, signal) => {
      if (!UUID.test(id)) throw new Error("chatgpt_registration_invalid");
      return storage.withLock(async () => {
        let active = true;
        const guard = () => {
          if (!active) throw new Error("registration_lock_closed");
          signal?.throwIfAborted();
        };
        try {
          const result = await action(access(true, guard));
          guard();
          return result;
        } finally {
          active = false;
        }
      }, signal);
    },
  };
}

type RegistrationDatabase = typeof import("@workspace/db").db;
type RegistrationTransaction = Parameters<
  Parameters<RegistrationDatabase["transaction"]>[0]
>[0];

export async function createPostgresChatGPTRegistrationStore(
  database: RegistrationDatabase,
  secret: string,
): Promise<ChatGPTRegistrationStore> {
  const {
    chatgptRegistrationsTable: records,
    chatgptRegistrationLocksTable: locks,
  } = await import("@workspace/db/schema");
  const { and, eq, sql } = await import("drizzle-orm");
  const key = keyBytes(secret);
  await database
    .insert(locks)
    .values({ singletonId: 1, hostId: `urn:uuid:${randomUUID()}` })
    .onConflictDoNothing();
  const [host] = await database
    .select()
    .from(locks)
    .where(eq(locks.singletonId, 1))
    .limit(1);
  if (!host || !HOST.test(host.hostId))
    throw new Error("registration_storage_invalid");
  const hostId = host.hostId;
  const accountDigest = (accountId: string) =>
    createHmac("sha256", key)
      .update("chatgpt/account/v1\0")
      .update(hostId)
      .update("\0")
      .update(accountId)
      .digest("hex");

  function decode(row: typeof records.$inferSelect): ChatGPTRegistration {
    try {
      const registration = validateRegistration(
        decrypt<ChatGPTRegistration>(
          { ...row, format: 1 },
          key,
          `postgres/${row.id}`,
        ),
      );
      if (
        registration.id !== row.id ||
        registration.revision !== row.revision ||
        registration.hostId !== hostId ||
        accountDigest(registration.accountId) !== row.accountDigest
      )
        throw new Error("identity");
      return registration;
    } catch {
      throw new Error("registration_storage_invalid");
    }
  }

  async function withLock<T>(
    action: (tx: RegistrationTransaction, guard: () => void) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    return database.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '30s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '45s'`);
      await tx.execute(
        sql`SET LOCAL idle_in_transaction_session_timeout = '30s'`,
      );
      await tx
        .select()
        .from(locks)
        .where(eq(locks.singletonId, 1))
        .for("update");
      let active = true;
      const guard = () => {
        if (!active) throw new Error("registration_lock_closed");
        signal?.throwIfAborted();
      };
      try {
        guard();
        const result = await action(tx, guard);
        guard();
        return result;
      } finally {
        active = false;
      }
    });
  }

  function access(
    executor: RegistrationDatabase | RegistrationTransaction,
    locked: boolean,
    guard = () => {},
  ): ChatGPTRegistrationAccess {
    const readRegistration = async (
      id: string,
    ): Promise<ChatGPTRegistration | null> => {
      guard();
      if (!UUID.test(id)) throw new Error("chatgpt_registration_invalid");
      const [row] = await executor
        .select()
        .from(records)
        .where(eq(records.id, id))
        .limit(1);
      return row ? decode(row) : null;
    };
    return {
      getHostId: async () => {
        guard();
        return hostId;
      },
      readRegistration,
      readActiveRegistration: async () => {
        guard();
        const [selection] = await executor
          .select()
          .from(locks)
          .where(eq(locks.singletonId, 1))
          .limit(1);
        if (!selection || selection.hostId !== hostId)
          throw new Error("registration_storage_invalid");
        if (!selection.activeRegistrationId) return null;
        const active = await readRegistration(selection.activeRegistrationId);
        if (!active) throw new Error("registration_storage_invalid");
        return active;
      },
      activateRegistration: async (id, expectedRevision) => {
        guard();
        const activate = async (
          tx: RegistrationDatabase | RegistrationTransaction,
          assertLock: () => void,
        ) => {
          const registration = await access(
            tx,
            true,
            assertLock,
          ).readRegistration(id);
          if (
            !registration ||
            registration.revision !== expectedRevision ||
            !Number.isSafeInteger(expectedRevision)
          )
            throw new ChatGPTRegistrationConflict();
          if (!registration.credentials)
            throw new Error("chatgpt_registration_sign_in_required");
          assertLock();
          await tx
            .update(locks)
            .set({ activeRegistrationId: id })
            .where(eq(locks.singletonId, 1));
        };
        return locked
          ? activate(executor, guard)
          : withLock((tx, assertLock) => activate(tx, assertLock));
      },
      readPublicStatus: async (id) => {
        const record = await readRegistration(id);
        return record ? status(record) : null;
      },
      listPublicStatus: async () => {
        guard();
        return (
          await executor
            .select()
            .from(records)
            .orderBy(records.updatedAt, records.id)
        ).map((row) => status(decode(row)));
      },
      replaceRegistration: async (expectedRevision, input) => {
        guard();
        const replace = async (
          tx: RegistrationDatabase | RegistrationTransaction,
          assertLock: () => void,
        ) => {
          assertLock();
          const current = await access(tx, true, assertLock).readRegistration(
            input.id,
          );
          const replacement = assertReplacement(
            current,
            expectedRevision,
            input,
            hostId,
          );
          const digest = accountDigest(replacement.accountId);
          const [existing] = await tx
            .select({ id: records.id })
            .from(records)
            .where(eq(records.accountDigest, digest))
            .limit(1);
          if (existing && existing.id !== replacement.id)
            throw new Error("chatgpt_registration_account_exists");
          const envelope = encrypt(
            replacement,
            replacement.revision,
            key,
            `postgres/${replacement.id}`,
          );
          assertLock();
          const values = {
            id: replacement.id,
            accountDigest: digest,
            revision: replacement.revision,
            ciphertext: envelope.ciphertext,
            nonce: envelope.nonce,
            authTag: envelope.authTag,
            updatedAt: new Date(replacement.updatedAt),
          };
          let saved;
          if (current)
            saved = await tx
              .update(records)
              .set(values)
              .where(
                and(
                  eq(records.id, replacement.id),
                  eq(records.revision, expectedRevision),
                ),
              )
              .returning({ id: records.id });
          else
            saved = await tx
              .insert(records)
              .values(values)
              .onConflictDoNothing()
              .returning({ id: records.id });
          if (saved.length !== 1) throw new ChatGPTRegistrationConflict();
          return structuredClone(replacement);
        };
        return locked
          ? replace(executor, guard)
          : withLock((tx, assertLock) => replace(tx, assertLock));
      },
    };
  }
  return {
    ...access(database, false),
    withRegistrationRefreshLock: async (id, action, signal) => {
      if (!UUID.test(id)) throw new Error("chatgpt_registration_invalid");
      return withLock((tx, guard) => action(access(tx, true, guard)), signal);
    },
  };
}
