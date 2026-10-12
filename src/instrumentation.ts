import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkConfigOrExit } = await import("./lib/env");
  checkConfigOrExit();
  if (process.env.RUN_MIGRATIONS !== "false") {
    const { runMigrations } = await import("./lib/migrate");
    await runMigrations();
  }
  // Run the background worker inside the web process unless it is deployed separately
  // (set RUN_WORKER=false on web instances and run `npm run worker` elsewhere).
  if (process.env.RUN_WORKER !== "false") {
    const { startWorker } = await import("./lib/jobs/worker");
    startWorker();
  }
}

/** Every uncaught error in a page, route handler or server action ends up here: log it and alert. */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportError } = await import("./lib/log");
  reportError("request failed", err, { path: request.path, method: request.method, route: context.routePath, kind: context.routeType });
};
