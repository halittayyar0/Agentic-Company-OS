import { setTimeout as delay } from "node:timers/promises";

// Download destinations are reviewed code constants. The pin file supplies
// checksums/provenance, but cannot add URL paths, queries or another host.
// A Node upgrade must update this closed set together with native-runtimes.json.
const downloads = Object.freeze({
  "win32-x64": "https://nodejs.org/dist/v24.22.1/node-v24.22.1-win-x64.zip",
  "darwin-x64":
    "https://nodejs.org/dist/v24.22.1/node-v24.22.1-darwin-x64.tar.gz",
  "darwin-arm64":
    "https://nodejs.org/dist/v24.22.1/node-v24.22.1-darwin-arm64.tar.gz",
  "linux-x64":
    "https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-x64.tar.gz",
  "linux-arm64":
    "https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-arm64.tar.gz",
});

export function nodeArchiveDownloadUrl(target, pin) {
  const destination = Object.hasOwn(downloads, target)
    ? downloads[target]
    : undefined;
  if (!destination || pin?.version !== "24.22.1" || pin.url !== destination)
    throw new Error(
      "Node pin does not match the reviewed download destination",
    );
  return destination;
}

const retryableConnections = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
]);

/** Only retry immutable, reviewed GET acquisition before receiving a response. */
export async function fetchPinnedNodeArchive(
  target,
  pin,
  {
    fetchImpl = globalThis.fetch,
    timeoutSignal = (ms) => AbortSignal.timeout(ms),
    wait = (ms, signal) => delay(ms, undefined, { signal }),
  } = {},
) {
  const url = nodeArchiveDownloadUrl(target, pin);
  // One deadline covers every attempt, backoff and the returned response body.
  const signal = timeoutSignal(120_000);
  for (let attempt = 1; attempt <= 3; attempt++) {
    signal.throwIfAborted();
    let response;
    try {
      response = await fetchImpl(url, { signal, redirect: "error" });
    } catch (error) {
      signal.throwIfAborted();
      const code = error?.cause?.code ?? error?.code;
      if (!retryableConnections.has(code)) throw error;
      if (attempt === 3)
        throw new Error("Pinned Node connection failed after 3 attempts", {
          cause: new Error(code),
        });
      await wait(250 * attempt, signal);
      continue;
    }
    signal.throwIfAborted();
    if (!response.ok || !response.body)
      throw new Error("Pinned Node download failed");
    return response;
  }
}

export function postgresSourceDownloadUrl(pin) {
  const destination =
    "https://ftp.postgresql.org/pub/source/v17.11/postgresql-17.11.tar.bz2";
  if (pin?.version !== "17.11" || pin.url !== destination)
    throw new Error(
      "PostgreSQL pin does not match the reviewed PostgreSQL source",
    );
  return destination;
}
