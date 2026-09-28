import { agentsTable, db, type Agent } from "@workspace/db";
import { eq } from "drizzle-orm";

export type RootCeoIdentity = Pick<
  Agent,
  "depth" | "parentAgentId" | "templateKey" | "isRootCeo"
>;

/**
 * Sudo authority is bound to the server-derived stock root CEO identity, not
 * merely to a mutable permission bit. This prevents a nested or custom agent
 * from gaining host execution if canUseSudo is patched accidentally.
 */
export function isRootCeo(agent: RootCeoIdentity): boolean {
  return (
    agent.isRootCeo === true &&
    agent.depth === 0 &&
    agent.parentAgentId === null &&
    agent.templateKey === "ceo"
  );
}

/**
 * Also proves that the marker is globally singular in the live database. A
 * corrupt/imported database with multiple marked rows fails closed.
 */
export async function isCanonicalRootCeo(
  agent: Pick<Agent, "id"> & RootCeoIdentity,
): Promise<boolean> {
  if (!isRootCeo(agent)) return false;
  const marked = await db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(eq(agentsTable.isRootCeo, true))
    .orderBy(agentsTable.id)
    .limit(2);
  return marked.length === 1 && marked[0]?.id === agent.id;
}
