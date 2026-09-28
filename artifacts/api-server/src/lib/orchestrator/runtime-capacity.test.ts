import assert from "node:assert/strict";
import test from "node:test";
import {
  agentsTable,
  approvalRequestsTable,
  db,
  dbReady,
  messagesTable,
  tasksTable,
} from "@workspace/db";
import {
  assertActiveAgentCapacity,
  assertMessageCapacity,
  assertOutstandingApprovalCapacity,
  assertOutstandingTaskCapacity,
  RuntimeCapacityError,
} from "./runtime-capacity";

test("runtime capacity limits fail closed under the shared control-row lock", async (t) => {
  await dbReady;
  const previous = {
    agents: process.env.MAX_ACTIVE_AGENTS,
    tasks: process.env.MAX_OUTSTANDING_TASKS,
    approvals: process.env.MAX_OUTSTANDING_APPROVALS,
    messages: process.env.MAX_MESSAGES_PER_AGENT,
  };
  process.env.MAX_ACTIVE_AGENTS = "1";
  process.env.MAX_OUTSTANDING_TASKS = "1";
  process.env.MAX_OUTSTANDING_APPROVALS = "1";
  process.env.MAX_MESSAGES_PER_AGENT = "1";
  t.after(() => {
    restore("MAX_ACTIVE_AGENTS", previous.agents);
    restore("MAX_OUTSTANDING_TASKS", previous.tasks);
    restore("MAX_OUTSTANDING_APPROVALS", previous.approvals);
    restore("MAX_MESSAGES_PER_AGENT", previous.messages);
  });

  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Capacity test agent",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Capacity test task",
      brief: "Consumes the only outstanding slot.",
      ownerAgentId: agent.id,
      status: "blocked",
      createdByUser: true,
    })
    .returning();
  await db.insert(approvalRequestsTable).values({
    taskId: task.id,
    agentId: agent.id,
    category: "other",
    title: "Capacity test approval",
    description: "Consumes the only pending approval slot.",
    status: "pending",
  });
  await db.insert(messagesTable).values({
    agentId: agent.id,
    role: "user",
    content: "Consumes the only message slot.",
  });

  for (const assertion of [
    (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) =>
      assertActiveAgentCapacity(tx),
    (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) =>
      assertOutstandingTaskCapacity(tx),
    (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) =>
      assertOutstandingApprovalCapacity(tx),
    (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) =>
      assertMessageCapacity(tx, agent.id, 1),
  ]) {
    await assert.rejects(
      db.transaction(assertion),
      (error: unknown) =>
        error instanceof RuntimeCapacityError &&
        error.code === "RUNTIME_CAPACITY_EXCEEDED" &&
        error.limit === 1,
    );
  }
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
