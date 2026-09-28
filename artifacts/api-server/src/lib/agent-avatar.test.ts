import assert from "node:assert/strict";
import test from "node:test";
import {
  AVATAR_MAX_BINARY_BYTES,
  avatarCacheControl,
  avatarEntityTag,
  validateAvatarDataUrl,
} from "./agent-avatar";

const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("accepts a correctly declared local bitmap data URL", () => {
  const value = `data:image/png;base64,${pngHeader.toString("base64")}`;
  assert.deepEqual(validateAvatarDataUrl(value), {
    ok: true,
    mimeType: "image/png",
    imageBase64: pngHeader.toString("base64"),
  });
});

test("rejects remote, SVG, malformed, and type-confused avatar payloads", () => {
  for (const value of [
    "https://example.com/avatar.png",
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "data:image/png;base64,not valid base64",
    `data:image/jpeg;base64,${pngHeader.toString("base64")}`,
  ]) {
    assert.equal(validateAvatarDataUrl(value).ok, false, value);
  }
});

test("rejects decoded avatar data beyond the binary budget", () => {
  const oversized = Buffer.alloc(AVATAR_MAX_BINARY_BYTES + 1);
  pngHeader.copy(oversized);
  const value = `data:image/png;base64,${oversized.toString("base64")}`;
  assert.equal(validateAvatarDataUrl(value).ok, false);
});

test("versions produce stable ETags and immutable cache only for exact URLs", () => {
  assert.equal(avatarEntityTag(7, "abc123"), '"agent-avatar-7-abc123"');
  assert.equal(
    avatarCacheControl("abc123", "abc123"),
    "private, max-age=31536000, immutable",
  );
  assert.equal(avatarCacheControl(undefined, "abc123"), "private, no-cache");
  assert.equal(avatarCacheControl("old", "abc123"), "private, no-cache");
});
