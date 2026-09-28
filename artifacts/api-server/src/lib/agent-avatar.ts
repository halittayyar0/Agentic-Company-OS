const DATA_URL_PATTERN =
  /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/u;

export const AVATAR_MAX_BINARY_BYTES = 64 * 1024;
export const AVATAR_MAX_DATA_URL_LENGTH = 90_000;

type AvatarValidationResult =
  | { ok: true; mimeType: string; imageBase64: string }
  | { ok: false; error: string };

function hasExpectedSignature(mime: string, bytes: Buffer): boolean {
  if (mime === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    );
  }
  if (mime === "image/jpeg") {
    return (
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    );
  }
  return (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  );
}

/**
 * Validate the complete persisted avatar payload. SVG and remote URLs are
 * intentionally unsupported so a self-hosted install has no external image
 * dependency or scriptable image surface.
 */
export function validateAvatarDataUrl(value: string): AvatarValidationResult {
  if (value.length > AVATAR_MAX_DATA_URL_LENGTH) {
    return { ok: false, error: "Avatar image exceeds the 64 KiB limit." };
  }

  const match = DATA_URL_PATTERN.exec(value);
  if (!match) {
    return {
      ok: false,
      error: "Avatar must be a base64 PNG, JPEG, or WebP data URL.",
    };
  }

  const [, mime, encoded] = match;
  const bytes = Buffer.from(encoded, "base64");
  const canonicalPayload = bytes.toString("base64").replace(/=+$/u, "");
  if (
    bytes.length === 0 ||
    bytes.length > AVATAR_MAX_BINARY_BYTES ||
    canonicalPayload !== encoded.replace(/=+$/u, "")
  ) {
    return {
      ok: false,
      error: "Avatar image payload is invalid or too large.",
    };
  }
  if (!hasExpectedSignature(mime, bytes)) {
    return {
      ok: false,
      error: "Avatar image content does not match its declared file type.",
    };
  }

  return { ok: true, mimeType: mime, imageBase64: encoded };
}

export function avatarEntityTag(agentId: number, version: string): string {
  return `"agent-avatar-${agentId}-${version}"`;
}

export function avatarCacheControl(
  requestedVersion: unknown,
  currentVersion: string,
): string {
  return requestedVersion === currentVersion
    ? "private, max-age=31536000, immutable"
    : "private, no-cache";
}
