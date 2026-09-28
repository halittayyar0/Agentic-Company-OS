import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ENVELOPE_AAD = Buffer.from("agentic-company-os/runtime-control/v1");

export interface RuntimeEncryptedEnvelope {
  ciphertext: string;
  nonce: string;
  authTag: string;
}

export function readRuntimeControlKey(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const value = environment.RUNTIME_CONTROL_KEY;
  if (
    !value ||
    value.length < 32 ||
    value.length > 4096 ||
    value !== value.trim()
  ) {
    throw new Error(
      "RUNTIME_CONTROL_KEY must contain 32 to 4096 characters and no leading or trailing whitespace.",
    );
  }
  return value;
}

function deriveKey(secret: string): Buffer {
  return createHash("sha256")
    .update("agentic-company-os/runtime-control/key/v1\0")
    .update(secret, "utf8")
    .digest();
}

export function encryptRuntimeEnvelope(
  value: unknown,
  secret = readRuntimeControlKey(),
): RuntimeEncryptedEnvelope {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), nonce);
  cipher.setAAD(ENVELOPE_AAD);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64url"),
    nonce: nonce.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
  };
}

export function decryptRuntimeEnvelope<T>(
  envelope: RuntimeEncryptedEnvelope,
  secret = readRuntimeControlKey(),
): T {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(secret),
    Buffer.from(envelope.nonce, "base64url"),
  );
  decipher.setAAD(ENVELOPE_AAD);
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

export function digestRuntimePayload(
  value: unknown,
  secret = readRuntimeControlKey(),
): string {
  return createHmac("sha256", deriveKey(secret))
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

export function runtimeControlKeyMatches(
  candidate: string | undefined,
  secret = readRuntimeControlKey(),
): boolean {
  if (!candidate) return false;
  const candidateDigest = createHash("sha256").update(candidate).digest();
  const expectedDigest = createHash("sha256").update(secret).digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}
