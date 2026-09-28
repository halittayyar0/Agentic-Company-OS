import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { WORKSPACE_LOCALES } from "../lib/workspace-locale";
import { getCapabilityCatalog } from "../lib/capabilities/catalog";

const router: IRouter = Router();
const querySchema = z
  .object({ locale: z.enum(WORKSPACE_LOCALES).default("tr") })
  .strict();
router.get("/skills", (req, res) => {
  const query = querySchema.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "INVALID_SKILL_CATALOG_QUERY" });
    return;
  }
  res.setHeader("Cache-Control", "private, no-store");
  res.json(getCapabilityCatalog(query.data.locale));
});
export default router;
