import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DepositWorkerStatusTracker,
  evaluateWorkerHealth,
  isWorkerHung,
  readStatusFile,
  sanitizeErrorMessage,
  statusFilePath,
  writeStatusFile,
} from '../../server/depositAutomationWorkerStatus';

const INTERVAL = 15_000;
const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

function makeTracker(now: { value: number }) {
  const writes: unknown[] = [];
  const tracker = new DepositWorkerStatusTracker(
    (status) => writes.push(status),
    () => new Date(T0 + now.value),
    123,
  );
  return { tracker, writes };
}

describe('deposit worker health', () => {
  it('reports missing status as unhealthy', () => {
    expect(evaluateWorkerHealth(null, INTERVAL, T0)).toMatchObject({ healthy: false, state: 'missing' });
  });

  it('is healthy right after a successful tick', () => {
    const now = { value: 0 };
    const { tracker } = makeTracker(now);
    tracker.tickStarted();
    now.value = 2_000;
    tracker.tickSucceeded(100n);
    expect(evaluateWorkerHealth(tracker.snapshot, INTERVAL, T0 + 10_000)).toMatchObject({ healthy: true, state: 'ok' });
    expect(tracker.snapshot.lastHead).toBe('100');
  });

  it('is unhealthy when the last tick failed and counts consecutive failures', () => {
    const now = { value: 0 };
    const { tracker } = makeTracker(now);
    tracker.tickFailed(new Error('boom'));
    expect(tracker.tickFailed(new Error('boom'))).toBe(2);
    expect(evaluateWorkerHealth(tracker.snapshot, INTERVAL, T0 + 1_000)).toMatchObject({ healthy: false, state: 'failing' });
    tracker.tickSucceeded(5n);
    expect(tracker.snapshot.consecutiveFailures).toBe(0);
  });

  it('detects a hung tick and a stale worker', () => {
    const now = { value: 0 };
    const { tracker } = makeTracker(now);
    tracker.tickStarted();
    expect(isWorkerHung(tracker.snapshot, INTERVAL, T0 + 60_000)).toBe(false);
    expect(isWorkerHung(tracker.snapshot, INTERVAL, T0 + 6 * 60_000)).toBe(true);
    now.value = 1_000;
    tracker.tickSucceeded(1n);
    expect(evaluateWorkerHealth(tracker.snapshot, INTERVAL, T0 + 10 * 60_000).state).toBe('hung');
  });

  it('never throws when the status file cannot be written', () => {
    const tracker = new DepositWorkerStatusTracker(() => {
      throw new Error('disk full');
    });
    expect(() => tracker.tickStarted()).not.toThrow();
  });
});

describe('deposit worker status file and sanitization', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it('round-trips atomically and returns null for a missing or corrupt file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'velox-status-'));
    dirs.push(dir);
    const path = join(dir, 'nested', 'status.json');
    expect(readStatusFile(path)).toBeNull();
    const status = {
      pid: 1, startedAt: iso(0), lastTickStartedAt: null, lastTickCompletedAt: null,
      lastTickOk: null, consecutiveFailures: 0, lastHead: null, lastError: null, updatedAt: iso(0),
    };
    writeStatusFile(path, status);
    expect(readStatusFile(path)).toEqual(status);
    expect(readFileSync(path, 'utf8')).not.toContain('tmp');
  });

  it('redacts URLs and truncates error messages', () => {
    const message = sanitizeErrorMessage(new Error('HTTP failed for https://user:secret@rpc.example/key123 and postgres://u:p@host/db'));
    expect(message).not.toContain('secret');
    expect(message).not.toContain('postgres://');
    expect(message).toContain('[redacted-url]');
    expect(sanitizeErrorMessage(new Error('x'.repeat(1_000))).length).toBe(300);
    expect(sanitizeErrorMessage('not an error')).toBe('Unknown error.');
  });

  it('honors the status file override', () => {
    expect(statusFilePath({ DEPOSIT_AUTOMATION_WORKER_STATUS_FILE: '/custom/status.json' })).toBe('/custom/status.json');
    expect(statusFilePath({})).toContain('velox-deposit-worker-status.json');
  });
});
