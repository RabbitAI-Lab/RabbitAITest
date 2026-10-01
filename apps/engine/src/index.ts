import { startWorker } from "./runner/worker.js";
import { startLoadController } from "./load/controller.js";
import { startRunnerWorker } from "./uit/runner-jobs.js";
import { logBuiltinSelfCheck } from "./uit/runner-env.js";

startWorker();
startLoadController();
startRunnerWorker();
void logBuiltinSelfCheck();
