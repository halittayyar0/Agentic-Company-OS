// Download destinations are reviewed code constants. The pin file supplies
// checksums/provenance, but cannot add URL paths, queries or another host.
// A Node upgrade must update this closed set together with native-runtimes.json.
const downloads = Object.freeze({
  "win32-x64": "https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip",
  "darwin-x64":
    "https://nodejs.org/dist/v24.21.0/node-v24.21.0-darwin-x64.tar.gz",
  "darwin-arm64":
    "https://nodejs.org/dist/v24.21.0/node-v24.21.0-darwin-arm64.tar.gz",
  "linux-x64":
    "https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.gz",
  "linux-arm64":
    "https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-arm64.tar.gz",
});

export function nodeArchiveDownloadUrl(target, pin) {
  const destination = Object.hasOwn(downloads, target)
    ? downloads[target]
    : undefined;
  if (!destination || pin?.version !== "24.21.0" || pin.url !== destination)
    throw new Error(
      "Node pin does not match the reviewed download destination",
    );
  return destination;
}
