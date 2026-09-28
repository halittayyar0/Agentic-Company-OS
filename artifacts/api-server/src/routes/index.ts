import { Router, type IRouter } from "express";
import healthRouter from "./health";
import agentsRouter from "./agents";
import agentRequestsRouter from "./agent-requests";
import tasksRouter from "./tasks";
import activityRouter from "./activity";
import approvalsRouter from "./approvals";
import orgRouter from "./org";
import vmRouter from "./vm";
import settingsRouter from "./settings";
import opsControlRouter from "./ops-control";
import companyChatRouter from "./company-chat";
import workforceBlueprintRouter from "./workforce-blueprints";
import projectMeetingsRouter from "./project-meetings";
import operationsRouter from "./operations";
import skillsRouter from "./skills";
import sourceChangesRouter from "./source-changes";

const router: IRouter = Router();

router.use(healthRouter);
router.use(agentsRouter);
router.use(agentRequestsRouter);
router.use(tasksRouter);
router.use(activityRouter);
router.use(approvalsRouter);
router.use(orgRouter);
router.use(vmRouter);
router.use(settingsRouter);
router.use(opsControlRouter);
router.use(companyChatRouter);
router.use(workforceBlueprintRouter);
router.use(projectMeetingsRouter);
router.use(operationsRouter);
router.use(skillsRouter);
router.use(sourceChangesRouter);

export default router;
