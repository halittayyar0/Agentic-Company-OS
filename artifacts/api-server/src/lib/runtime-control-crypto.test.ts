import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptRuntimeEnvelope,
  digestRuntimePayload,
  encryptRuntimeEnvelope,
  runtimeControlKeyMatches,
} from "./runtime-control-crypto";

const key = "runtime-control-test-key-32-bytes-minimum";

test("runtime control envelopes authenticate sensitive payloads without plaintext", () => {
  const payload = {
    action: "type_text",
    text: "OTP-SENTINEL-938201",
    pngBase64: "PNG-SENTINEL",
  };
  const envelope = encryptRuntimeEnvelope(payload, key);
  assert.equal(JSON.stringify(envelope).includes("OTP-SENTINEL"), false);
  assert.equal(JSON.stringify(envelope).includes("PNG-SENTINEL"), false);
  assert.deepEqual(decryptRuntimeEnvelope(envelope, key), payload);
  assert.throws(() =>
    decryptRuntimeEnvelope(envelope, "different-runtime-control-key-32-bytes"),
  );
});

test("runtime control payload digests are keyed and key comparison is exact", () => {
  const payload = { action: "click", x: 10, y: 20 };
  assert.equal(digestRuntimePayload(payload, key).length, 64);
  assert.notEqual(
    digestRuntimePayload(payload, key),
    digestRuntimePayload(payload, "different-runtime-control-key-32-bytes"),
  );
  assert.equal(runtimeControlKeyMatches(key, key), true);
  assert.equal(runtimeControlKeyMatches(`${key}x`, key), false);
});
