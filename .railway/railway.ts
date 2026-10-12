import { defineRailway, project, service } from "railway/iac";

// Deposit automation worker: a persistent background process with no inbound port, so no healthcheck path or
// public domain is declared. Variables are intentionally not declared here; set them in Railway (see
// docs/railway-deposit-worker.md). Health: `node apps/web/dist-worker/worker.mjs --health` in the service shell.
export default defineRailway(() => {
  const depositWorker = service("deposit-worker", {
    build: "pnpm --filter @velox/web run build:worker",
    start: "node apps/web/dist-worker/worker.mjs",
    replicas: 1,
  });

  return project("velox-treasury", {
    resources: [depositWorker],
  });
});
