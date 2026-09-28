import { Router, type IRouter } from "express";
import { eq, and, desc, lt } from "drizzle-orm";
import {
  db,
  activityEventsTable,
  activityEventSeverityValues,
} from "@workspace/db";
import { ListActivityResponse } from "@workspace/api-zod";
import {
  parseCursorPage,
  parseOptionalEnum,
  parsePositiveInteger,
  setNextCursor,
} from "../lib/http-params";

const router: IRouter = Router();

router.get("/activity", async (req, res): Promise<void> => {
  const agentId = parsePositiveInteger(req.query.agentId, "agentId", {
    optional: true,
  });
  const taskId = parsePositiveInteger(req.query.taskId, "taskId", {
    optional: true,
  });
  const severity = parseOptionalEnum(
    req.query.severity,
    "severity",
    activityEventSeverityValues,
  );
  const page = parseCursorPage(req.query);
  if (!agentId.ok) {
    res.status(400).json({ error: agentId.error });
    return;
  }
  if (!taskId.ok) {
    res.status(400).json({ error: taskId.error });
    return;
  }
  if (!severity.ok) {
    res.status(400).json({ error: severity.error });
    return;
  }
  if (!page.ok) {
    res.status(400).json({ error: page.error });
    return;
  }

  const conditions = [];
  if (agentId.value !== undefined)
    conditions.push(eq(activityEventsTable.agentId, agentId.value));
  if (taskId.value !== undefined)
    conditions.push(eq(activityEventsTable.taskId, taskId.value));
  if (severity.value !== undefined) {
    conditions.push(eq(activityEventsTable.severity, severity.value));
  }
  if (page.value.beforeId !== undefined) {
    conditions.push(lt(activityEventsTable.id, page.value.beforeId));
  }

  const rows = await db
    .select()
    .from(activityEventsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    // The cursor is an event ID. Event time can arrive out of order, so it
    // cannot determine page membership without skipping existing records.
    .orderBy(desc(activityEventsTable.id))
    .limit(page.value.limit + 1);

  const hasMore = rows.length > page.value.limit;
  const events = rows.slice(0, page.value.limit);
  setNextCursor(res, events, hasMore);
  res.json(ListActivityResponse.parse(events));
});

export default router;
