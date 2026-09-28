import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { WORKSPACE_LOCALES } from "../lib/workspace-locale";
import { getCapabilityCatalog } from "../lib/capabilities/catalog";
import {
  listExtensions,
  saveExtension,
  exportExtension,
  readCapabilityPacks,
  setCapabilityPacks,
  CapabilityConflict,
} from "../lib/capabilities/extension-store";
import { createRateLimiter } from "../lib/rate-limit";

const router: IRouter = Router();
const writeLimit = createRateLimiter({
  namespace: "capability-save",
  max: 30,
  windowMs: 60000,
});
router.get("/skills/extensions", async (_req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.json(await listExtensions());
});
router.put("/skills/extensions", writeLimit, async (req, res) => {
  try {
    res.json(await saveExtension(req.body));
  } catch (error) {
    if (error instanceof CapabilityConflict) {
      res.status(409).json({ code: "CAPABILITY_REVISION_CONFLICT" });
      return;
    }
    if (
      error instanceof z.ZodError ||
      (error instanceof Error &&
        ["EXTENSION_TOO_LARGE", "EXTENSION_CAPACITY_REACHED"].includes(
          error.message,
        ))
    ) {
      res.status(400).json({ code: "CAPABILITY_INVALID" });
      return;
    }
    throw error;
  }
});
router.get("/skills/extensions/:id/export", async (req, res) => {
  try {
    const manifest = await exportExtension(String(req.params.id));
    res.setHeader("Cache-Control", "private, no-store");
    res.json(manifest);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ code: "CAPABILITY_INVALID" });
      return;
    }
    if (error instanceof Error && error.message === "EXTENSION_MISSING") {
      res.status(404).json({ code: "CAPABILITY_MISSING" });
      return;
    }
    throw error;
  }
});
router.get("/skills/packs", async (_req, res) => {
  res.json(await readCapabilityPacks());
});
router.put("/skills/packs", writeLimit, async (req, res) => {
  try {
    res.json(await setCapabilityPacks(req.body));
  } catch (error) {
    if (error instanceof CapabilityConflict) {
      res.status(409).json({ code: "CAPABILITY_REVISION_CONFLICT" });
      return;
    }
    if (error instanceof z.ZodError) {
      res.status(400).json({ code: "CAPABILITY_INVALID" });
      return;
    }
    throw error;
  }
});
const querySchema = z
  .object({ locale: z.enum(WORKSPACE_LOCALES).default("tr") })
  .strict();
router.get("/skills", async (req, res) => {
  const query = querySchema.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "INVALID_SKILL_CATALOG_QUERY" });
    return;
  }
  res.setHeader("Cache-Control", "private, no-store");
  const catalog = getCapabilityCatalog(query.data.locale),
    packs = await readCapabilityPacks();
  const groups = {
    research: "web",
    engineering: "code",
    data: "data",
    content: "documents",
    operations: "planning",
  };
  catalog.skills = catalog.skills.filter((skill) =>
    packs.enabledPacks.includes(groups[skill.group]),
  );
  res.json(catalog);
});
export default router;
