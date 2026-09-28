import type { Agent } from "@workspace/db";

const DEFAULT_MAX_RESPONSE_ATTEMPTS = 6;
// Sequential by default so each selected agent sees already-persisted replies
// in buildChatSystemPrompt and can avoid repeating the room. Operators may opt
// into a small bounded pool when latency matters more than turn-taking.
const DEFAULT_RESPONSE_CONCURRENCY = 1;
const DEFAULT_RESPONSE_MAX_TOKENS = 400;
const DEFAULT_RESPONSE_TOKEN_BUDGET = 2_400;

const STOP_WORDS = new Set([
  "acaba",
  "ama",
  "and",
  "bir",
  "bu",
  "da",
  "de",
  "icin",
  "ile",
  "is",
  "mi",
  "mı",
  "mu",
  "mü",
  "ne",
  "of",
  "olan",
  "olarak",
  "the",
  "ve",
  "veya",
]);

type RoutingAgent = Pick<
  Agent,
  "id" | "name" | "role" | "department" | "systemPrompt" | "isRootCeo"
>;

export type CompanyChatRoutingMode = "mentions" | "relevance";

export type CompanyChatRoutingReason =
  | "mentioned"
  | "role_match"
  | "general_question"
  | "not_mentioned"
  | "not_relevant"
  | "budget_guard";

export type CompanyChatRoutingDecision = {
  agentId: number;
  shouldAttempt: boolean;
  reason: CompanyChatRoutingReason;
  score: number;
};

export type CompanyChatRoutingPlan = {
  mode: CompanyChatRoutingMode;
  decisions: CompanyChatRoutingDecision[];
  candidateAgentIds: number[];
  maxResponseAttempts: number;
  concurrency: number;
  maxTokensPerResponse: number;
  tokenBudget: number;
};

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) return fallback;
  return Math.min(parsed, maximum);
}

export function getCompanyChatRoutingLimits(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const configuredAttempts = boundedInteger(
    environment.COMPANY_CHAT_MAX_RESPONSE_ATTEMPTS,
    DEFAULT_MAX_RESPONSE_ATTEMPTS,
    1,
    32,
  );
  const configuredMaxTokensPerResponse = boundedInteger(
    environment.COMPANY_CHAT_RESPONSE_MAX_TOKENS,
    DEFAULT_RESPONSE_MAX_TOKENS,
    100,
    600,
  );
  const tokenBudget = boundedInteger(
    environment.COMPANY_CHAT_RESPONSE_TOKEN_BUDGET,
    DEFAULT_RESPONSE_TOKEN_BUDGET,
    100,
    19_200,
  );
  const maxTokensPerResponse = Math.min(
    configuredMaxTokensPerResponse,
    tokenBudget,
  );
  const budgetedAttempts = Math.max(
    1,
    Math.floor(tokenBudget / maxTokensPerResponse),
  );
  const maxResponseAttempts = Math.min(configuredAttempts, budgetedAttempts);
  const concurrency = Math.min(
    maxResponseAttempts,
    boundedInteger(
      environment.COMPANY_CHAT_RESPONSE_CONCURRENCY,
      DEFAULT_RESPONSE_CONCURRENCY,
      1,
      8,
    ),
  );

  return {
    maxResponseAttempts,
    concurrency,
    maxTokensPerResponse,
    tokenBudget,
  };
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/ı/gu, "i");
}

// Match Turkish noun inflections without treating arbitrary prefixes as roles.
// The same folding also accommodates keyboards without Turkish characters.
const NOUN_SUFFIX =
  /^(?:i|u|a|e|yi|yu|ya|ye|ni|nu|na|ne|in|un|nin|nun|ini|unu|sini|sunu|si|su|lar|ler|lari|leri|larin|lerin|dan|den|tan|ten|da|de|ta|te|daki|deki|yla|yle)$/u;

type TopicTokens = Map<string, Set<string>>;

function meaningfulTokens(value: string): TopicTokens {
  const tokens = normalize(value).match(/[\p{L}\p{N}]+/gu) ?? [];
  const topics: TopicTokens = new Map();
  for (const token of tokens) {
    if (token.length < 3 || STOP_WORDS.has(token)) continue;
    if (topics.has(token)) continue;
    const aliases = new Set([token]);
    topics.set(token, aliases);
    // At most six suffix checks per word, then O(1) set intersection. Do not
    // multiply message tokens by every prompt token in a large organization.
    for (
      let split = Math.max(4, token.length - 6);
      split < token.length;
      split++
    ) {
      if (!NOUN_SUFFIX.test(token.slice(split))) continue;
      const stem = token.slice(0, split);
      aliases.add(stem);
      if (stem.endsWith("g")) aliases.add(`${stem.slice(0, -1)}k`);
    }
  }
  return topics;
}

function overlapScore(left: TopicTokens, right: TopicTokens): number {
  let overlap = 0;
  const index = new Set<string>();
  for (const aliases of right.values()) {
    for (const alias of aliases) index.add(alias);
  }
  for (const aliases of left.values()) {
    // One original content word contributes at most once, regardless of how
    // many of its spelling/inflection aliases match the same expert.
    for (const alias of aliases) {
      if (index.has(alias)) {
        overlap += 1;
        break;
      }
    }
  }
  return overlap;
}

function relevanceScore(contentTokens: TopicTokens, agent: RoutingAgent) {
  const nameScore = overlapScore(contentTokens, meaningfulTokens(agent.name));
  const roleScore = overlapScore(contentTokens, meaningfulTokens(agent.role));
  const departmentScore = overlapScore(
    contentTokens,
    meaningfulTokens(agent.department ?? ""),
  );
  const expertiseScore = Math.min(
    3,
    overlapScore(
      contentTokens,
      meaningfulTokens(agent.systemPrompt.slice(0, 4_000)),
    ),
  );
  return nameScore * 12 + roleScore * 8 + departmentScore * 6 + expertiseScore;
}

function looksLikeGeneralQuestion(content: string): boolean {
  const normalized = normalize(content);
  return (
    content.includes("?") ||
    /\b(ne düşün|ne dusun|fikrin|öneri|oneri|durum|what do you think|any thoughts)\b/u.test(
      normalized,
    )
  );
}

/**
 * Evaluates every active room member without performing model calls. Explicit
 * mentions are authoritative. In ambient group mode, lexical role/expertise
 * overlap selects likely contributors and a single leadership fallback handles
 * genuinely general questions. The model still gets a final NO_REPLY gate.
 */
export function planCompanyChatRouting(input: {
  content: string;
  agents: RoutingAgent[];
  mentionedAgentIds: number[];
  environment?: NodeJS.ProcessEnv;
}): CompanyChatRoutingPlan {
  const limits = getCompanyChatRoutingLimits(input.environment);
  const mentioned = new Set(input.mentionedAgentIds);
  const mode: CompanyChatRoutingMode =
    mentioned.size > 0 ? "mentions" : "relevance";
  const tokens =
    mode === "mentions"
      ? new Map<string, Set<string>>()
      : meaningfulTokens(input.content);
  const scores = new Map(
    input.agents.map((agent) => [
      agent.id,
      mode === "mentions" ? 0 : relevanceScore(tokens, agent),
    ]),
  );

  let rankedIds: number[];
  if (mode === "mentions") {
    const memberIds = new Set(input.agents.map((agent) => agent.id));
    rankedIds = [...mentioned].filter((id) => memberIds.has(id));
  } else {
    rankedIds = input.agents
      .filter((agent) => (scores.get(agent.id) ?? 0) > 0)
      .sort(
        (left, right) =>
          (scores.get(right.id) ?? 0) - (scores.get(left.id) ?? 0) ||
          left.id - right.id,
      )
      .map((agent) => agent.id);

    if (rankedIds.length === 0 && looksLikeGeneralQuestion(input.content)) {
      const leader =
        input.agents.find((agent) => agent.isRootCeo) ?? input.agents[0];
      if (leader) rankedIds = [leader.id];
    }
  }

  const candidateAgentIds = rankedIds.slice(0, limits.maxResponseAttempts);
  const candidates = new Set(candidateAgentIds);
  const overBudget = new Set(rankedIds.slice(limits.maxResponseAttempts));
  const generalFallback =
    mode === "relevance" &&
    rankedIds.length === 1 &&
    (scores.get(rankedIds[0]!) ?? 0) === 0;

  const decisions = input.agents.map((agent) => {
    const score = scores.get(agent.id) ?? 0;
    let reason: CompanyChatRoutingReason;
    if (candidates.has(agent.id)) {
      reason =
        mode === "mentions"
          ? "mentioned"
          : generalFallback
            ? "general_question"
            : "role_match";
    } else if (overBudget.has(agent.id)) {
      reason = "budget_guard";
    } else if (mode === "mentions") {
      reason = "not_mentioned";
    } else {
      reason = "not_relevant";
    }
    return {
      agentId: agent.id,
      shouldAttempt: candidates.has(agent.id),
      reason,
      score,
    };
  });

  return {
    mode,
    decisions,
    candidateAgentIds,
    ...limits,
  };
}

/** A result-order-preserving worker pool used for bounded room fan-out. */
export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (values.length === 0) return [];
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, values.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= values.length) return;
        results[index] = await worker(values[index]!, index);
      }
    }),
  );

  return results;
}
