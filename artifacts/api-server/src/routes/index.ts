import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sessionsRouter from "./sessions";
import participantsRouter from "./participants";

const router: IRouter = Router();

router.use(healthRouter);
router.use(sessionsRouter);
router.use(participantsRouter);

export default router;
