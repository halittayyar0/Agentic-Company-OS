"use strict";

const dns = require("node:dns");
const { syncBuiltinESMExports } = require("node:module");
const {
  createArtifactLookup,
  artifactHostname,
} = require("./artifact-dns-retry.cjs");

// This preload is scoped to the macOS upload action steps, never the application.
dns.lookup = createArtifactLookup({
  lookup: dns.lookup,
  hostname: artifactHostname(process.env.ACTIONS_RESULTS_URL),
});
syncBuiltinESMExports();
