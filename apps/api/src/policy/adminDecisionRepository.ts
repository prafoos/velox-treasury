import { and, desc, eq } from 'drizzle-orm';

import type { DatabaseInstance } from '../config/db.js';
import {
  adminDecisions,
  type AdminDecisionAuditEntry,
  type AdminDecisionStatus,
} from '../db/schema.js';

export interface CreateAdminDecisionRecord {
  readonly decisionId: string;
  readonly assessmentId?: string | null;
  readonly decision: AdminDecisionStatus;
  readonly decidedBy: string;
  readonly decidedAt: Date;
  readonly maximumTotalDeployed?: bigint | null;
  readonly minimumLiquidReserveBps?: number | null;
  readonly rationale: string;
  readonly auditTrail: readonly AdminDecisionAuditEntry[];
}

export type AdminDecisionRecord = typeof adminDecisions.$inferSelect;

function requireNonBlank(value: string, field: string): void {
  if (!value.trim()) throw new Error(`${field} is required.`);
}

function validateAdminDecisionRecord(input: CreateAdminDecisionRecord): void {
  requireNonBlank(input.decisionId, 'decisionId');
  requireNonBlank(input.decidedBy, 'decidedBy');
  requireNonBlank(input.rationale, 'rationale');
  if (!(input.decidedAt instanceof Date) || Number.isNaN(input.decidedAt.getTime())) {
    throw new Error('decidedAt is required and must be a valid date.');
  }
  if (!Array.isArray(input.auditTrail)) throw new Error('auditTrail is required.');
  if (input.decision !== 'APPROVED' && input.decision !== 'REJECTED') {
    throw new Error('decision must be APPROVED or REJECTED.');
  }
  if (input.maximumTotalDeployed !== undefined && input.maximumTotalDeployed !== null && input.maximumTotalDeployed < 0n) {
    throw new Error('maximumTotalDeployed must be non-negative.');
  }
  if (
    input.minimumLiquidReserveBps !== undefined
    && input.minimumLiquidReserveBps !== null
    && (!Number.isInteger(input.minimumLiquidReserveBps) || input.minimumLiquidReserveBps < 0 || input.minimumLiquidReserveBps > 10_000)
  ) {
    throw new Error('minimumLiquidReserveBps must be an integer between 0 and 10000.');
  }
  if (input.decision === 'APPROVED') {
    if (input.maximumTotalDeployed === undefined || input.maximumTotalDeployed === null) {
      throw new Error('Approved decisions require maximumTotalDeployed.');
    }
    if (input.minimumLiquidReserveBps === undefined || input.minimumLiquidReserveBps === null) {
      throw new Error('Approved decisions require minimumLiquidReserveBps.');
    }
  }
}

export async function createAdminDecision(
  db: DatabaseInstance,
  input: CreateAdminDecisionRecord,
): Promise<AdminDecisionRecord> {
  validateAdminDecisionRecord(input);

  const [record] = await db.insert(adminDecisions).values({
    decisionId: input.decisionId,
    assessmentId: input.assessmentId ?? null,
    decision: input.decision,
    decidedBy: input.decidedBy,
    decidedAt: input.decidedAt,
    maximumTotalDeployed: input.maximumTotalDeployed ?? null,
    minimumLiquidReserveBps: input.minimumLiquidReserveBps ?? null,
    rationale: input.rationale,
    auditTrail: [...input.auditTrail],
  }).returning();

  if (!record) throw new Error('Admin Decision insert did not return a record.');
  return record;
}

export async function getAdminDecisionById(
  db: DatabaseInstance,
  decisionId: string,
): Promise<AdminDecisionRecord | null> {
  requireNonBlank(decisionId, 'decisionId');
  const [record] = await db.select().from(adminDecisions).where(eq(adminDecisions.decisionId, decisionId)).limit(1);
  return record ?? null;
}

export async function getAuthoritativeApprovedAdminDecision(
  db: DatabaseInstance,
): Promise<AdminDecisionRecord | null> {
  const [record] = await db
    .select()
    .from(adminDecisions)
    .where(and(eq(adminDecisions.decision, 'APPROVED')))
    .orderBy(desc(adminDecisions.decidedAt), desc(adminDecisions.createdAt))
    .limit(1);

  if (!record) return null;
  assertApprovedAdminDecision(record);
  return record;
}

export function assertApprovedAdminDecision(record: AdminDecisionRecord): AdminDecisionRecord {
  if (record.decision !== 'APPROVED') throw new Error('Only APPROVED Admin Decisions can be execution sources.');
  if (record.maximumTotalDeployed === null) throw new Error('Approved Admin Decision is missing maximumTotalDeployed.');
  if (record.minimumLiquidReserveBps === null) throw new Error('Approved Admin Decision is missing minimumLiquidReserveBps.');
  return record;
}