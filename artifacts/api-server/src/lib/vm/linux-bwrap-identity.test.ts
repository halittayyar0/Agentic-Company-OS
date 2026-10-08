import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptsLinuxBwrapIdentity,
  PINNED_CODEX_BWRAP_SHA256,
} from "./linux-bwrap-identity";

const help = "    --argv0 VALUE    Set argv[0]\n";
test("pinned Codex Bubblewrap needs its exact bytes, architecture and argv0 capability", () => {
  const identity = {
    version: "bubblewrap built for Codex\n",
    help,
    sha256: PINNED_CODEX_BWRAP_SHA256,
    architecture: "x64",
  };
  assert.equal(acceptsLinuxBwrapIdentity(identity), true);
  assert.equal(
    acceptsLinuxBwrapIdentity({ ...identity, sha256: "0".repeat(64) }),
    false,
  );
  assert.equal(
    acceptsLinuxBwrapIdentity({ ...identity, architecture: "arm64" }),
    false,
  );
  assert.equal(
    acceptsLinuxBwrapIdentity({ ...identity, help: "--help" }),
    false,
  );
  assert.equal(
    acceptsLinuxBwrapIdentity({ ...identity, version: "unknown vendor build" }),
    false,
  );
});
test("distribution Bubblewrap retains its version and actual argv0 requirement", () => {
  const identity = {
    version: "bubblewrap 0.9.0\n",
    help,
    sha256: "0".repeat(64),
    architecture: "arm64",
  };
  assert.equal(acceptsLinuxBwrapIdentity(identity), true);
  assert.equal(
    acceptsLinuxBwrapIdentity({
      ...identity,
      version: "bubblewrap 0.8.0\n",
      help: "--help",
    }),
    false,
  );
  assert.equal(
    acceptsLinuxBwrapIdentity({ ...identity, version: "bubblewrap 0.5.0\n" }),
    false,
  );
});
