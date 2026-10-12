import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_STATUS_FILE = join(tmpdir(), 'velox-deposit-worker-status.json');
// A tick that has not finished after this long is treated as hung (for example a stalled RPC call).
export const DEFAULT_MAX_TICK_AGE_MS = 5 * 60 * 1_000;

export interface DepositWorkerStatus {
  readonly pid: number;
  readonly startedAt: string;
  readonly lastTickStartedAt: string | null;
  readonly lastTickCompletedAt: string | null;
  readonly lastTickOk: boolean | null;
  readonly consecutiveFailures: number;
  readonly lastHead: string | null;
  readonly lastError: string | null;
  readonly updatedAt: string;
}

export interface DepositWorkerHealth {
  readonly healthy: boolean;
  readonly state: 'ok' | 'missing' | 'hung' | 'failing';
  readonly reason: string;
}

/** Keeps operational errors useful without leaking RPC/database URLs (which can embed credentials). */
export function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown error.';
  return message.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[redacted-url]').slice(0, 300);
}

export function statusFilePath(environment: NodeJS.ProcessEnv = process.env): string {
  return environment.DEPOSIT_AUTOMATION_WORKER_STATUS_FILE?.trim() || DEFAULT_STATUS_FILE;
}

export function writeStatusFile(path: string, status: DepositWorkerStatus): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(status), { mode: 0o600 });
  renameSync(temporaryPath, path);
}

export function readStatusFile(path: string): DepositWorkerStatus | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as DepositWorkerStatus;
  } catch {
    return null;
  }
}

export function evaluateWorkerHealth(
  status: DepositWorkerStatus | null,
  intervalMs: number,
  now: number = Date.now(),
  maxTickAgeMs: number = DEFAULT_MAX_TICK_AGE_MS,
): DepositWorkerHealth {
  if (!status) return { healthy: false, state: 'missing', reason: 'No worker status file found.' };
  const staleAfterMs = Math.max(maxTickAgeMs, intervalMs * 4);
  const started = status.lastTickStartedAt ? Date.parse(status.lastTickStartedAt) : null;
  const completed = status.lastTickCompletedAt ? Date.parse(status.lastTickCompletedAt) : null;
  const reference = completed ?? Date.parse(status.startedAt);
  if (started !== null && (completed === null || started > completed) && now - started > staleAfterMs) {
    return { healthy: false, state: 'hung', reason: 'A tick has been running longer than the allowed time.' };
  }
  if (now - reference > staleAfterMs) {
    return { healthy: false, state: 'hung', reason: 'No tick has completed recently.' };
  }
  if (status.lastTickOk === false) {
    return { healthy: false, state: 'failing', reason: `Last tick failed (${status.consecutiveFailures} consecutive).` };
  }
  return { healthy: true, state: 'ok', reason: 'Worker is ticking normally.' };
}

export function isWorkerHung(
  status: DepositWorkerStatus,
  intervalMs: number,
  now: number = Date.now(),
  maxTickAgeMs: number = DEFAULT_MAX_TICK_AGE_MS,
): boolean {
  return evaluateWorkerHealth(status, intervalMs, now, maxTickAgeMs).state === 'hung';
}

export class DepositWorkerStatusTracker {
  private status: DepositWorkerStatus;

  constructor(
    private readonly persist: (status: DepositWorkerStatus) => void,
    private readonly clock: () => Date = () => new Date(),
    pid: number = process.pid,
  ) {
    const now = this.clock().toISOString();
    this.status = {
      pid,
      startedAt: now,
      lastTickStartedAt: null,
      lastTickCompletedAt: null,
      lastTickOk: null,
      consecutiveFailures: 0,
      lastHead: null,
      lastError: null,
      updatedAt: now,
    };
    this.flush();
  }

  get snapshot(): DepositWorkerStatus {
    return this.status;
  }

  tickStarted(): void {
    this.update({ lastTickStartedAt: this.clock().toISOString() });
  }

  tickSucceeded(head: bigint): void {
    this.update({
      lastTickCompletedAt: this.clock().toISOString(),
      lastTickOk: true,
      consecutiveFailures: 0,
      lastHead: head.toString(),
      lastError: null,
    });
  }

  tickFailed(error: unknown): number {
    this.update({
      lastTickCompletedAt: this.clock().toISOString(),
      lastTickOk: false,
      consecutiveFailures: this.status.consecutiveFailures + 1,
      lastError: sanitizeErrorMessage(error),
    });
    return this.status.consecutiveFailures;
  }

  private update(patch: Partial<DepositWorkerStatus>): void {
    this.status = { ...this.status, ...patch, updatedAt: this.clock().toISOString() };
    this.flush();
  }

  private flush(): void {
    try {
      this.persist(this.status);
    } catch {
      // A status-file write failure must never interrupt deposit processing.
    }
  }
}
