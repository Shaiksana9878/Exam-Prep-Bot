import { Router, type IRouter } from "express";
import healthRouter from "./health";
import anthropicRouter from "./anthropic";
import prepmindRouter from "./prepmind";

const router: IRouter = Router();

router.use(healthRouter);
router.use(anthropicRouter);
router.use(prepmindRouter);

export default router;
