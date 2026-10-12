# Deposit automation worker on Railway

The deposit worker is a persistent Node process. It cannot run inside a Vercel Function, so it is deployed as its own
Railway service. The Vercel web/API deployment is unchanged and independent.

The worker polls Arc Mainnet for Core `Deposit` events with the existing `ArcMainnetIndexer`, stores events and its
cursor in PostgreSQL, and runs the existing `runTriggeredStrategySurplusDeployment` orchestration (same trigger store
and replay/age guards as `/api/strategy-automation`).

## Service setup

- Repository root: the monorepo root (not `apps/web`).
- Configuration: Railway Config as Code (`railway.json`/`railway.toml`) is deprecated and unavailable to new services
  (existing files stop being read 2026-12-01). This repo uses Infrastructure as Code in `.railway/railway.ts`
  (service `deposit-worker`: GitHub source, build, start, 1 replica). It is applied with the Railway CLI, not read automatically:
  `railway login`, `railway link` (the intended project and a non-production environment first), then
  `railway config plan` and, after reviewing the plan, `railway config apply`. The `railway` SDK that provides
  `railway/iac` is a root dev dependency (`^3.14.0`) and resolves locally; the Railway CLI is a separate install.
  Alternatively, enter the same values in the dashboard.
- GitHub source: declared in the file as `github("prafoos/velox-treasury", { branch: "main" })`. The root directory is
  not declared and stays the repository root (not `apps/web`). The Railway GitHub app must have access to the repository.
- Build command: `pnpm --filter @velox/web run build:worker` (Railway installs dependencies, including devDependencies
  such as vite, automatically before this step; `builder` is intentionally omitted so Railway's default builder is used).
- Start command: `node apps/web/dist-worker/worker.mjs`
- Replicas: exactly 1 (`numReplicas` in the config). The trigger claim is replica-safe, but redundant indexers are not
  needed.
- Node 20 (see `.nvmrc`). Dependencies (`pg`, `viem`, `dotenv`) are resolved from `node_modules`; workspace packages are
  bundled into `apps/web/dist-worker/worker.mjs`.
- Do not expose a public domain. The service needs no inbound port.

## Environment variable names (set in Railway; never commit values)

Required:

- `DEPOSIT_AUTOMATION_WORKER_ENABLED` — must be exactly `true`; otherwise the process exits with code 1.
- `ARC_MAINNET_RPC_URL`
- `POSTGRES_URL` — use a dedicated Neon branch for Preview/testing. Use the production database only for an
  explicitly authorized production run.
- `VELIX_TREASURY_CORE_ADDRESS` — must be the approved current Core.
- `STEAKHOUSE_ADAPTER_ADDRESS`
- `DEPLOYER_PRIVATE_KEY` — the automation signer; it must hold `AUTOMATION_ROLE` and be funded for gas.

Optional:

- `ARC_MAINNET_CORE_AUTOMATION_EXECUTOR` — defaults to the configured role holder; must equal the signer address.
- `DEPOSIT_AUTOMATION_WORKER_INTERVAL_MS` — default `15000`, minimum `1000`.
- `DEPOSIT_AUTOMATION_WORKER_STATUS_FILE` — status file path (default: OS temp dir).
- `ARC_MAINNET_CORE_*` policy variables, if the web deployment sets them (see `.env.example`); keep them identical to
  the web deployment.

Not needed by the worker: `AUTH_*`, `VITE_*`, `CRON_SECRET`, Gemini keys.

## Startup behaviour

Startup validates configuration before any network call and exits with code 1 and a one-line message if something is
missing or invalid (disabled flag, RPC, database URL, Core/adapter addresses, signer key, executor address, interval).
Secret values are never logged.

## Logs and health

There is no HTTP health endpoint. Use Railway logs (all lines are prefixed `[deposit-worker]`):

- `Starting; polling every …ms.` on boot.
- `Initialized deposit indexer cursor at block N.` on the very first run. History is never backfilled.
- `Tick ok: head=… indexedEvents=… outcomes=… halted=…` whenever events or outcomes occur, and about every 20th tick.
- `Deposit 0x…: deployed | skipped (REASON) | rejected (…) | failed (…)` per deposit.
- `Tick failed (n/10): …` on RPC or database errors.

A healthy idle worker logs a heartbeat roughly every 5 minutes at the default interval.

### Health status (no network port)

The worker writes a small status JSON file (atomic rename, mode 0600, no secrets; errors have URLs redacted) after every
tick. Nothing listens on a port, so there is no public or unauthenticated endpoint. Check it from inside the service
(Railway shell / `railway ssh`):

```
node apps/web/dist-worker/worker.mjs --health     # prints one JSON line; exit 0 healthy, 1 otherwise
```

Unhealthy means: no status file, last tick failed, or no tick completed within max(5 min, 4 × interval).
An in-process watchdog (checked every 30 s) exits with code 1 if a tick hangs past that limit, so Railway restarts the
process from the persisted cursor. A deposit left `STARTED` by an interrupted run is still never retried automatically.
Railway's HTTP healthcheck is not used because it requires a listening port.

## Restart and recovery behaviour

- The cursor is persisted in `indexer_state` in the same transaction as the inserted `event_log` rows. Duplicate events
  are discarded by the `event_log` unique key. After any restart the worker resumes from the stored cursor.
- Pending deposits are derived from the database (indexed `Deposit` events within the 2,400-block age window with no
  `strategy_automation_triggers` row), so a crash between indexing and automation loses nothing.
- Duplicate protection is shared with the web endpoint: advisory lock plus a unique
  `(chain_id, deposit_transaction_hash)` claim.
- A deposit whose trigger is `STARTED` or `FAILED` is never retried automatically, because the outcome may be
  uncertain. Inspect the Core, adapter and vault state on-chain before taking any manual action.
- After 10 consecutive failed ticks the process exits with code 1; Railway restarts it per the service restart policy
  (default On Failure, up to 10 retries; confirm in the dashboard Settings). SIGTERM/SIGINT stop the loop cleanly
  after the current tick.

## Checklist

Implemented and tested locally (mocks only; no database, RPC or Mainnet used):

- [x] Worker bundle (`build:worker`), fail-fast startup, disabled-by-default flag.
- [x] Cursor resume, duplicate-event dedupe, uncertain-outcome blocking, trigger claim (unit tests).
- [x] Status file, `--health` command, hung-tick watchdog, URL-redacted errors.
- [x] `.railway/railway.ts` written to Railway's documented IaC API; NOT evaluated locally (needs the Railway CLI and
      a linked project).

Requires dashboard/account access (not done):

- [ ] Railway project + service from this repo; root = repo root; apply `.railway/railway.ts` via `railway config plan`/
      `apply` (or set the same build/start/1-replica values in the dashboard); no public domain.
- [ ] Set the variable NAMES listed above in Railway (values from your secret store).
- [ ] Neon development branch (separate from production); apply migrations 0000–0005 to that branch only; use its
      connection string as `POSTGRES_URL`.
- [ ] Rotated, funded signer with `AUTOMATION_ROLE`.
- [ ] Confirm the Vercel project Root Directory (unrelated to the worker).
- [ ] Authorized live Mainnet test. The worker has never run a live tick; the Postgres SQL has never run on a real
      engine.

## Local build check (no network)

```powershell
pnpm --filter @velox/web run build:worker
node apps/web/dist-worker/worker.mjs          # exits 1: worker disabled
node apps/web/dist-worker/worker.mjs --health # exits 1: no status file
```
