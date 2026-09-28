import assert from "node:assert/strict";
import test from "node:test";
import { AVATAR_INPUT_MAX_BYTES, avatarFileError } from "./avatar-image";

test("avatar file guard accepts supported bitmap formats", () => {
  for (const type of ["image/png", "image/jpeg", "image/webp"]) {
    assert.equal(avatarFileError({ type, size: 1024 }), null);
  }
});

test("avatar file guard rejects unsafe formats and oversized inputs", () => {
  assert.match(
    avatarFileError({ type: "image/svg+xml", size: 1024 }) ?? "",
    /PNG/,
  );
  assert.match(
    avatarFileError({
      type: "image/png",
      size: AVATAR_INPUT_MAX_BYTES + 1,
    }) ?? "",
    /5 MB/,
  );
  assert.match(avatarFileError({ type: "image/png", size: 0 }) ?? "", /boş/);
});
