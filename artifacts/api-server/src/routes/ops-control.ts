import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  getEmergencyStopStatus,
  setEmergencyStop,
} from "../lib/orchestrator/runtime-emergency-stop";

const router: IRouter = Router();

const UpdateControlBody = z.discriminatedUnion("emergencyStopEnabled", [
  z.object({
    emergencyStopEnabled: z.literal(true),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    emergencyStopEnabled: z.literal(false),
    reason: z.string().trim().max(500).nullish(),
  }),
]);

router.get("/ops/control", async (_req, res): Promise<void> => {
  res.json(await getEmergencyStopStatus());
});

router.put("/ops/control", async (req, res): Promise<void> => {
  const parsed = UpdateControlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const state = await setEmergencyStop({
    enabled: parsed.data.emergencyStopEnabled,
    reason: parsed.data.reason ?? null,
    updatedBy: "operator",
  });
  res.json(state);
});

export default router;
