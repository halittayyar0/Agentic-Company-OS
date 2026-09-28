import { Router, type IRouter, type Response } from "express";
import { z } from "zod/v4";
import { createRateLimiter } from "../lib/rate-limit";
import {
  listSourceChanges,
  prepareSourceChange,
  inspectSourceChange,
  checkSourceChange,
  applySourceChange,
  rollbackSourceChange,
} from "../lib/source-workspaces";
const router: IRouter = Router();
const writeLimit = createRateLimiter({
  namespace: "source-change",
  max: 12,
  windowMs: 60000,
});
const revision = z
  .object({ expectedRevision: z.number().int().positive() })
  .strict();
async function reply(res: Response, action: () => Promise<unknown>) {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    res.json(await action());
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ code: "SOURCE_INVALID" });
      return;
    }
    if (error instanceof Error && /^SOURCE_[A-Z_]+$/.test(error.message)) {
      res
        .status(error.message === "SOURCE_MISSING" ? 404 : 409)
        .json({ code: error.message });
      return;
    }
    throw error;
  }
}
router.get("/source-changes", (_req, res) => reply(res, listSourceChanges));
router.post("/source-changes", writeLimit, (req, res) =>
  reply(res, () => prepareSourceChange(req.body)),
);
router.get("/source-changes/:id", (req, res) =>
  reply(res, () => inspectSourceChange(String(req.params.id))),
);
router.post("/source-changes/:id/check", writeLimit, (req, res) =>
  reply(res, () => {
    const body = revision
      .extend({
        command: z.union([
          z.array(z.string()).min(1).max(64),
          z.array(z.array(z.string()).min(1).max(64)).min(1).max(4),
        ]),
      })
      .parse(req.body);
    return checkSourceChange(
      String(req.params.id),
      body.expectedRevision,
      body.command,
    );
  }),
);
router.post("/source-changes/:id/apply", writeLimit, (req, res) =>
  reply(res, () =>
    applySourceChange(
      String(req.params.id),
      revision.parse(req.body).expectedRevision,
    ),
  ),
);
router.post("/source-changes/:id/rollback", writeLimit, (req, res) =>
  reply(res, () =>
    rollbackSourceChange(
      String(req.params.id),
      revision.parse(req.body).expectedRevision,
    ),
  ),
);
export default router;
