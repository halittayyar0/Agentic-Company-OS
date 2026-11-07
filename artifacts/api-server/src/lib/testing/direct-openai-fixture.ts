/**
 * Keep protocol tests on a loopback peer while exercising the real direct
 * OpenAI adapter. Production endpoint and credential handling stay pinned.
 */
export function redirectDirectOpenAIForTest(port: number): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (url.origin !== "https://api.openai.com") {
      return originalFetch(input, init);
    }
    if (url.pathname !== "/v1/chat/completions" || url.search) {
      throw new Error("Unexpected direct OpenAI fixture request");
    }
    return originalFetch(new URL(url.pathname, `http://127.0.0.1:${port}`), {
      ...init,
      redirect: "error",
    });
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}
