"use strict";

function artifactHostname(value) {
  try {
    if (typeof value !== "string" || value.length > 8192) throw new Error();
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !url.hostname
    )
      throw new Error();
    return url.hostname.toLowerCase();
  } catch {
    throw new Error("artifact_dns_configuration_invalid");
  }
}

function createArtifactLookup({
  lookup,
  hostname,
  retryDelays = [1000, 2000],
  deadlineMs = 75000,
  warn = console.warn,
}) {
  // The allowance belongs to this action process, not each SDK HTTP attempt.
  let remainingRetries = 2;
  return function artifactLookup(host, ...args) {
    const callback = args.at(-1);
    if (
      typeof host !== "string" ||
      host.toLowerCase() !== hostname ||
      typeof callback !== "function"
    )
      return lookup.call(this, host, ...args);
    const receiver = this;
    const deadline = performance.now() + deadlineMs;
    let settled = false;
    let lastError;
    let retryTimer;
    const finish = (...values) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      clearTimeout(retryTimer);
      callback(...values);
    };
    const expire = () =>
      finish(
        lastError ||
          Object.assign(new Error("artifact_dns_deadline"), {
            code: "ETIMEDOUT",
          }),
      );
    const deadlineTimer = setTimeout(expire, deadlineMs);
    const attempt = () => {
      if (settled) return;
      if (performance.now() >= deadline) return expire();
      try {
        return lookup.call(
          receiver,
          host,
          ...args.slice(0, -1),
          (...values) => {
            if (settled) return;
            if (performance.now() >= deadline) return expire();
            const error = values[0];
            if (
              error &&
              ["ENOTFOUND", "EAI_AGAIN"].includes(error.code) &&
              remainingRetries > 0
            ) {
              const wait = retryDelays[2 - remainingRetries];
              lastError = error;
              if (performance.now() + wait < deadline) {
                remainingRetries--;
                warn(`artifact_dns_lookup_retry ${2 - remainingRetries}/2`);
                retryTimer = setTimeout(attempt, wait);
                return;
              }
            }
            finish(...values);
          },
        );
      } catch (error) {
        settled = true;
        clearTimeout(deadlineTimer);
        clearTimeout(retryTimer);
        throw error;
      }
    };
    return attempt();
  };
}

module.exports = { createArtifactLookup, artifactHostname };
