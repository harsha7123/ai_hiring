// Standalone worker entry point: `npm run worker`. Use for scaling processing
// separately from the web tier so heavy CV batches never slow the dashboard.
import { checkConfigOrExit } from "./lib/env";
import { runMigrations } from "./lib/migrate";
import { startWorker } from "./lib/jobs/worker";

void (async () => {
  checkConfigOrExit();
  if (process.env.RUN_MIGRATIONS !== "false") await runMigrations();
  startWorker({ standalone: true });
})();
