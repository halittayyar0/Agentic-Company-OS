import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod/v4";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  sourceChangesTable,
  agentsTable,
  activityEventsTable,
  codexTaskSessionsTable,
} from "@workspace/db";
import {
  ensureSandbox,
  execArgvInSandbox,
  getSandboxBaseDir,
} from "./vm/sandbox";
import {
  assertExecutionAllowed,
  lockAndAssertExecutionAllowed,
} from "./orchestrator/runtime-emergency-stop";
import { withToolPolicy } from "./execution-policy";
import { createProjectWithinTransaction } from "./create-project";
import { redactAuditText } from "./audit-redaction";

type Change = typeof sourceChangesTable.$inferSelect;
const idSchema = z.uuid();
const prepareSchema = z
  .object({
    id: idSchema,
    agentId: z.number().int().positive(),
    sourcePath: z.string().min(1).max(2048),
    request: z.string().min(1).max(4000),
  })
  .strict();
const commandsSchema = z
  .array(
    z
      .string()
      .max(4096)
      .refine((value) => !value.includes("\0")),
  )
  .min(1)
  .max(64);
const oid = (value: string) => {
  const result = value.trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(result))
    throw new Error("SOURCE_INVALID_COMMIT");
  return result;
};
const identity = (value: string) =>
  process.platform === "win32"
    ? path.resolve(value).toLowerCase()
    : path.resolve(value);

async function exactDirectory(value: string) {
  if (!path.isAbsolute(value) || value.startsWith("\\\\"))
    throw new Error("SOURCE_INVALID_PATH");
  const resolved = path.resolve(value),
    stat = await lstat(resolved);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    identity(await realpath(resolved)) !== identity(resolved)
  )
    throw new Error("SOURCE_REDIRECTED_PATH");
  return resolved;
}
async function getChange(id: string): Promise<Change> {
  idSchema.parse(id);
  const [row] = await db
    .select()
    .from(sourceChangesTable)
    .where(eq(sourceChangesTable.id, id));
  if (!row) throw new Error("SOURCE_MISSING");
  return row;
}
async function workDirectory(row: Pick<Change, "id" | "agentId">) {
  const root = await exactDirectory(await ensureSandbox(row.agentId));
  return path.join(root, "source-changes", row.id);
}
function effectFor(agentId: number) {
  const validate = async () => {
    await assertExecutionAllowed();
    const [agent] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId));
    if (!agent?.isActive || !agent.permissions?.canUseTerminal)
      throw new Error("SOURCE_AGENT_UNAVAILABLE");
  };
  return Object.assign(validate, { revalidate: validate });
}
async function git(
  agentId: number,
  directory: string,
  args: string[],
  allowFailure = false,
) {
  await exactDirectory(directory);
  const result = await execArgvInSandbox(
    agentId,
    [
      "git",
      "-c",
      "core.hooksPath=" + (process.platform === "win32" ? "NUL" : "/dev/null"),
      "-c",
      "core.fsmonitor=false",
      ...(process.platform === "win32" ? ["-c", "core.longpaths=true"] : []),
      "-c",
      "credential.helper=",
      "-c",
      "protocol.ext.allow=never",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=Agentic Company OS",
      "-c",
      "user.email=source-change@localhost",
      "-C",
      directory,
      ...args,
    ],
    120000,
    effectFor(agentId),
    "en",
  );
  if (result.stdout.length >= 48 * 1024 || result.stderr.length >= 48 * 1024)
    throw new Error("SOURCE_OUTPUT_TOO_LARGE");
  if (!result.ok && !allowFailure) throw new Error("SOURCE_COMMAND_FAILED");
  return result;
}
async function cleanRoot(agentId: number, source: string) {
  const root = await exactDirectory(source);
  if (
    identity(
      (
        await git(agentId, root, ["rev-parse", "--show-toplevel"])
      ).stdout.trim(),
    ) !== identity(root)
  )
    throw new Error("SOURCE_REPOSITORY_ROOT_REQUIRED");
  if (
    (
      await git(agentId, root, [
        "status",
        "--porcelain",
        "--untracked-files=all",
      ])
    ).stdout.trim()
  )
    throw new Error("SOURCE_DIRTY");
  return oid((await git(agentId, root, ["rev-parse", "HEAD"])).stdout);
}
async function saveState(id: string, values: Partial<Change>) {
  return db.transaction(async (tx) => {
    const [saved] = await tx
      .update(sourceChangesTable)
      .set({
        ...values,
        revision: sql`${sourceChangesTable.revision}+1`,
        updatedAt: new Date(),
      })
      .where(eq(sourceChangesTable.id, id))
      .returning();
    await tx.insert(activityEventsTable).values({
      type: "operations_changed",
      summary: "Source change state updated",
      severity: saved.state === "unknown" ? "warning" : "info",
      detail: {
        kind: "source_change",
        id,
        state: saved.state,
        revision: saved.revision,
      },
    });
    return saved;
  });
}
async function claim(
  id: string,
  revision: number,
  states: string[],
  next: string,
) {
  z.number().int().positive().parse(revision);
  return db.transaction(async (tx) => {
    await lockAndAssertExecutionAllowed(tx);
    const [current] = await tx
      .select({ taskId: sourceChangesTable.taskId })
      .from(sourceChangesTable)
      .where(
        and(
          eq(sourceChangesTable.id, idSchema.parse(id)),
          eq(sourceChangesTable.revision, revision),
          inArray(sourceChangesTable.state, states),
        ),
      )
      .for("update");
    if (!current) throw new Error("SOURCE_REVISION_CONFLICT");
    if (current.taskId !== null) {
      const [native] = await tx
        .select({
          state: codexTaskSessionsTable.state,
          cleanupState: codexTaskSessionsTable.cleanupState,
        })
        .from(codexTaskSessionsTable)
        .where(eq(codexTaskSessionsTable.taskId, current.taskId))
        .for("update");
      if (
        native &&
        (native.state === "running" || native.cleanupState === "unknown")
      )
        throw new Error("SOURCE_CODING_ACTIVE");
    }
    const [saved] = await tx
      .update(sourceChangesTable)
      .set({
        state: next,
        revision: sql`${sourceChangesTable.revision}+1`,
        updatedAt: new Date(),
        error: null,
      })
      .where(
        and(
          eq(sourceChangesTable.id, idSchema.parse(id)),
          eq(sourceChangesTable.revision, revision),
          inArray(sourceChangesTable.state, states),
        ),
      )
      .returning();
    if (!saved) throw new Error("SOURCE_REVISION_CONFLICT");
    return saved;
  });
}
export async function listSourceChanges() {
  return db
    .select()
    .from(sourceChangesTable)
    .orderBy(desc(sourceChangesTable.createdAt))
    .limit(100);
}
export async function prepareSourceChange(input: unknown): Promise<Change> {
  const body = prepareSchema.parse(input);
  return withToolPolicy("vm_run_command", async () => {
    await assertExecutionAllowed();
    const existing = await db
      .select()
      .from(sourceChangesTable)
      .where(eq(sourceChangesTable.id, body.id));
    if (existing[0]) {
      const row = existing[0];
      if (
        row.agentId !== body.agentId ||
        identity(row.sourcePath) !== identity(body.sourcePath) ||
        row.request !== body.request
      )
        throw new Error("SOURCE_REVISION_CONFLICT");
      return row;
    }
    const [agent] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, body.agentId));
    if (!agent?.isActive || !agent.permissions?.canUseTerminal)
      throw new Error("SOURCE_AGENT_UNAVAILABLE");
    const source = await exactDirectory(body.sourcePath);
    const sandboxBase = identity(getSandboxBaseDir()),
      original = identity(source);
    if (original === sandboxBase || original.startsWith(sandboxBase + path.sep))
      throw new Error("SOURCE_OVERLAPPING_ROOT");
    const baseCommit = await cleanRoot(body.agentId, source);
    const [row] = await db.transaction(async (tx) => {
      await lockAndAssertExecutionAllowed(tx);
      return tx
        .insert(sourceChangesTable)
        .values({ ...body, sourcePath: source, baseCommit })
        .onConflictDoNothing()
        .returning();
    });
    if (!row) return prepareSourceChange(body);
    try {
      const target = await workDirectory(row),
        parent = path.dirname(target);
      await mkdir(parent, { recursive: true });
      await exactDirectory(parent);
      if (await lstat(target).catch(() => null))
        throw new Error("SOURCE_COPY_EXISTS");
      await git(row.agentId, parent, [
        "clone",
        "--no-local",
        "--depth",
        "1",
        "--no-checkout",
        source,
        target,
      ]);
      await git(row.agentId, target, [
        "checkout",
        "-b",
        `codex/source-${row.id}`,
        baseCommit,
      ]);
      if ((await cleanRoot(row.agentId, source)) !== baseCommit)
        throw new Error("SOURCE_BASE_CHANGED");
      return db.transaction(async (tx) => {
        await lockAndAssertExecutionAllowed(tx);
        const task = await createProjectWithinTransaction(tx, {
          title: "Source change",
          ownerAgentId: row.agentId,
          brief: `${row.request}\n\nWork only in your isolated copy: source-changes/${row.id}. Inspect repository instructions, make the requested change, and run relevant checks. Show changed files and evidence. The original repository is not your working directory. Source application and rollback use the operator's reviewed source-change workflow.`,
        });
        const [saved] = await tx
          .update(sourceChangesTable)
          .set({
            state: "draft",
            taskId: task.id,
            revision: sql`${sourceChangesTable.revision}+1`,
            updatedAt: new Date(),
          })
          .where(eq(sourceChangesTable.id, row.id))
          .returning();
        return saved;
      });
    } catch (error) {
      await saveState(row.id, {
        state: "failed",
        error: "SOURCE_PREPARATION_FAILED",
      });
      throw error;
    }
  });
}
export async function inspectSourceChange(id: string) {
  return withToolPolicy("vm_read_file", async () => {
    const row = await getChange(id),
      target = await workDirectory(row);
    if (!(await lstat(target).catch(() => null)))
      return {
        ...row,
        workspace: `source-changes/${row.id}`,
        diff: "",
        status: "",
      };
    const diff = await git(row.agentId, target, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      row.baseCommit,
    ]);
    const status = await git(row.agentId, target, [
      "status",
      "--porcelain",
      "--untracked-files=all",
    ]);
    return {
      ...row,
      workspace: `source-changes/${row.id}`,
      diff: redactAuditText(diff.stdout, 48000, true),
      status: redactAuditText(status.stdout, 48000, true),
    };
  });
}
export async function checkSourceChange(
  id: string,
  revision: number,
  input: unknown,
) {
  const commands = z
    .union([
      commandsSchema.transform((command) => [command]),
      z.array(commandsSchema).min(1).max(4),
    ])
    .parse(input);
  return withToolPolicy("vm_run_command", async () => {
    const row = await claim(id, revision, ["draft", "verified"], "checking");
    try {
      const target = await workDirectory(row);
      // Freeze a committed snapshot, then check a separate copy that normal VM
      // file tools cannot edit. Later working-copy edits do not change delivery.
      await git(row.agentId, target, ["add", "--all"]);
      const staged = await git(row.agentId, target, [
        "diff",
        "--cached",
        "--name-only",
      ]);
      for (const name of staged.stdout.split(/\r?\n/).filter(Boolean))
        if (
          /(^|\/)(?:\.env(?:\.(?!example$|sample$)[^/]*)?|secrets?|agent-sandboxes|node_modules)(\/|$)|\.(?:pem|p12|key)$/i.test(
            name,
          )
        )
          throw new Error("SOURCE_PRIVATE_FILE_REJECTED");
      if (staged.stdout.trim())
        await git(row.agentId, target, [
          "commit",
          "-m",
          `Source change ${row.id}`,
        ]);
      const commit = oid(
        (await git(row.agentId, target, ["rev-parse", "HEAD"])).stdout,
      );
      if (commit === row.baseCommit) throw new Error("SOURCE_NO_CHANGES");
      // Include already committed edits, not just files staged by this request.
      const changed = await git(row.agentId, target, [
        "diff",
        "--name-only",
        "-z",
        row.baseCommit,
        commit,
      ]);
      for (const name of changed.stdout.split("\0").filter(Boolean)) {
        if (
          /(^|\/)(?:\.env(?:\.(?!example$|sample$)[^/]*)?|secrets?|agent-sandboxes|node_modules)(\/|$)|\.(?:pem|p12|key)$/i.test(
            name,
          )
        )
          throw new Error("SOURCE_PRIVATE_FILE_REJECTED");
      }
      const entries = await git(row.agentId, target, [
        "diff",
        "--raw",
        "--no-renames",
        "-z",
        row.baseCommit,
        commit,
      ]);
      if (
        entries.stdout
          .split("\0")
          .some((entry) => /^:[0-9]{6} (120000|160000) /.test(entry))
      )
        throw new Error("SOURCE_LINK_REJECTED");
      await git(row.agentId, target, [
        "merge-base",
        "--is-ancestor",
        row.baseCommit,
        commit,
      ]);
      if (
        (
          await git(row.agentId, target, [
            "rev-list",
            "--merges",
            `${row.baseCommit}..${commit}`,
          ])
        ).stdout.trim()
      )
        throw new Error("SOURCE_LINEAR_HISTORY_REQUIRED");
      const privateRoot = path.join(getSandboxBaseDir(), ".source-reviews");
      await mkdir(privateRoot, { recursive: true });
      await exactDirectory(privateRoot);
      const candidatePath = path.join(privateRoot, `${row.id}-${randomUUID()}`);
      await git(row.agentId, privateRoot, [
        "clone",
        "--no-local",
        "--no-checkout",
        target,
        candidatePath,
      ]);
      await git(row.agentId, candidatePath, ["checkout", "--detach", commit]);
      let output = "",
        exitCode: number | null = null,
        ok = true;
      for (const command of commands) {
        const args = command.map((argument) =>
          argument.replaceAll("{workspace}", candidatePath),
        );
        const result = await execArgvInSandbox(
          row.agentId,
          args,
          1200000,
          effectFor(row.agentId),
          "en",
        );
        output = (
          output +
          "\n" +
          JSON.stringify(command) +
          "\n" +
          result.stdout +
          "\n" +
          result.stderr
        ).slice(-48000);
        exitCode = result.exitCode;
        if (!result.ok) {
          ok = false;
          break;
        }
      }
      const unchanged = await cleanRoot(row.agentId, candidatePath).then(
        (head) => head === commit,
        () => false,
      );
      const passed = ok && unchanged;
      return saveState(row.id, {
        state: passed ? "verified" : "draft",
        candidateCommit: commit,
        candidatePath,
        check: {
          command: commands[commands.length - 1],
          commands,
          exitCode,
          output: redactAuditText(output, 48000, true),
          passed,
        },
        error: passed ? null : "SOURCE_CHECK_FAILED",
      });
    } catch (error) {
      await saveState(row.id, {
        state: "draft",
        check: null,
        error: "SOURCE_CHECK_FAILED",
      });
      throw error;
    }
  });
}
export async function applySourceChange(id: string, revision: number) {
  return withToolPolicy("vm_run_command", async () => {
    let row = await getChange(id);
    if (row.state === "applied") return row;
    if (
      row.state !== "verified" ||
      !row.check?.passed ||
      !row.candidateCommit ||
      !row.candidatePath
    )
      throw new Error("SOURCE_NOT_VERIFIED");
    await assertExecutionAllowed();
    if ((await cleanRoot(row.agentId, row.sourcePath)) !== row.baseCommit)
      throw new Error("SOURCE_BASE_CHANGED");
    if (
      (await cleanRoot(row.agentId, row.candidatePath)) !== row.candidateCommit
    )
      throw new Error("SOURCE_CANDIDATE_CHANGED");
    row = await claim(id, revision, ["verified"], "applying");
    try {
      await git(row.agentId, row.sourcePath, [
        "fetch",
        "--no-tags",
        row.candidatePath!,
        row.candidateCommit!,
      ]);
      if ((await cleanRoot(row.agentId, row.sourcePath)) !== row.baseCommit)
        throw new Error("SOURCE_BASE_CHANGED");
      await git(row.agentId, row.sourcePath, [
        "merge",
        "--ff-only",
        row.candidateCommit!,
      ]);
      if (
        (await cleanRoot(row.agentId, row.sourcePath)) !== row.candidateCommit
      )
        throw new Error("SOURCE_APPLY_UNCONFIRMED");
      return saveState(id, {
        state: "applied",
        appliedCommit: row.candidateCommit,
      });
    } catch (error) {
      await saveState(id, {
        state: "unknown",
        error: "SOURCE_APPLY_OUTCOME_UNKNOWN",
      });
      throw error;
    }
  });
}
export async function rollbackSourceChange(id: string, revision: number) {
  return withToolPolicy("vm_run_command", async () => {
    let row = await getChange(id);
    if (row.state === "rolled_back") return row;
    if (row.state !== "applied" || !row.appliedCommit)
      throw new Error("SOURCE_NOT_APPLIED");
    await assertExecutionAllowed();
    if ((await cleanRoot(row.agentId, row.sourcePath)) !== row.appliedCommit)
      throw new Error("SOURCE_BASE_CHANGED");
    row = await claim(id, revision, ["applied"], "rolling_back");
    try {
      await git(row.agentId, row.sourcePath, [
        "revert",
        "--no-commit",
        `${row.baseCommit}..${row.appliedCommit}`,
      ]);
      await git(row.agentId, row.sourcePath, [
        "commit",
        "-m",
        `Rollback source change ${row.id}`,
      ]);
      const currentTree = (
        await git(row.agentId, row.sourcePath, ["rev-parse", "HEAD^{tree}"])
      ).stdout.trim();
      const baseTree = (
        await git(row.agentId, row.sourcePath, [
          "rev-parse",
          `${row.baseCommit}^{tree}`,
        ])
      ).stdout.trim();
      if (currentTree !== baseTree)
        throw new Error("SOURCE_ROLLBACK_UNCONFIRMED");
      return saveState(id, { state: "rolled_back" });
    } catch (error) {
      await saveState(id, {
        state: "unknown",
        error: "SOURCE_ROLLBACK_OUTCOME_UNKNOWN",
      });
      throw error;
    }
  });
}
