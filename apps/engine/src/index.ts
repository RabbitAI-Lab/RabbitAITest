import { startWorker } from "./runner/worker.js";
import { startLoadController } from "./load/controller.js";

startWorker();
startLoadController();
