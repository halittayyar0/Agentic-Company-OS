import OpenAI from "openai";

function createClient(): OpenAI {
  if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
    throw new Error(
      "AI_INTEGRATIONS_OPENAI_BASE_URL must be set. Did you forget to provision the OpenAI AI integration?",
    );
  }

  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    throw new Error(
      "AI_INTEGRATIONS_OPENAI_API_KEY must be set. Did you forget to provision the OpenAI AI integration?",
    );
  }

  return new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
}

let _instance: OpenAI | null = null;

/**
 * Lazily-initialized Replit AI Integrations client.
 *
 * Behaves exactly like a static OpenAI instance at call time; construction
 * (and therefore env validation) only happens on first use so that servers
 * running against other providers (e.g. OpenRouter) can still boot.
 */
export const openai: OpenAI = new Proxy({} as OpenAI, {
  get(_target, prop, receiver) {
    _instance ??= createClient();
    const value = Reflect.get(_instance as object, prop, receiver);
    return typeof value === "function" ? value.bind(_instance) : value;
  },
});
