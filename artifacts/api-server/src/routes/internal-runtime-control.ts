import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  acknowledgeRuntimeControl,
  pollRuntimeControl,
  RuntimeControlUnavailableError,
} from "../lib/runtime-control-api";
import { runtimeControlKeyMatches } from "../lib/runtime-control-crypto";

const router: IRouter = Router();

const SessionSchema = z.object({
  agentId: z.number().int().positive(),
  sessionId: z.string().min(1).max(256),
  sessionEpoch: z.number().int().positive(),
});

const EnvelopeSchema = z.object({
  ciphertext: z
    .string()
    .min(1)
    .max(12 * 1024 * 1024),
  nonce: z.string().min(16).max(64),
  authTag: z.string().min(16).max(64),
});

const PollSchema = z.object({
  runtimeId: z.string().uuid(),
  startedAt: z.string().datetime({ offset: true }),
  sessions: z.array(SessionSchema).max(64),
});

const AckSchema = z.object({
  runtimeId: z.string().uuid(),
  id: z.string().uuid(),
  ok: z.boolean(),
  resultEnvelope: EnvelopeSchema.optional(),
  failureKind: z.string().min(1).max(128).optional(),
  sanitizedError: z.string().min(1).max(1024).optional(),
  session: SessionSchema.nullable(),
});

router.use((req, res, next) => {
  if (
    process.env.RUNTIME_ROLE !== "api" ||
    !runtimeControlKeyMatches(req.header("x-runtime-control-key"))
  ) {
    res.status(401).json({ error: "Runtime control authentication failed" });
    return;
  }
  next();
});

router.post("/poll", async (req, res): Promise<void> => {
  const parsed = PollSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid runtime control poll" });
    return;
  }
  try {
    const delivery = await pollRuntimeControl({
      runtimeId: parsed.data.runtimeId,
      startedAt: new Date(parsed.data.startedAt),
      sessions: parsed.data.sessions,
    });
    if (!delivery) {
      res.status(204).end();
      return;
    }
    res.json(delivery);
  } catch (error) {
    if (error instanceof RuntimeControlUnavailableError) {
      res.status(error.status).json({ code: error.code, error: error.message });
      return;
    }
    res.status(503).json({ error: "Runtime control poll unavailable" });
  }
});

router.post("/ack", async (req, res): Promise<void> => {
  const parsed = AckSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid runtime control acknowledgement" });
    return;
  }
  await acknowledgeRuntimeControl(parsed.data.runtimeId, parsed.data);
  res.status(204).end();
});

export default router;
