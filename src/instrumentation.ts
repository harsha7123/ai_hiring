export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
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
