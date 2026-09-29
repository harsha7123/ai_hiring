// Standalone worker entry point: `npm run worker`. Use for scaling processing
// separately from the web tier so heavy CV batches never slow the dashboard.
import { startWorker } from "./lib/jobs/worker";

startWorker();
