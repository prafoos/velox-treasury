import { describe, expect, it, vi } from 'vitest';

import {
  assertApprovedAdminDecision,
  createAdminDecision,
  getAdminDecisionById,
  getAuthoritativeApprovedAdminDecision,
  type CreateAdminDecisionRecord,
} from './adminDecisionRepository.js';

const baseDecision: CreateAdminDecisionRecord = {
  decisionId: 'assessment-001:admin:approved',
  assessmentId: 'assessment-001',
  decision: 'APPROVED',
  decidedBy: 'admin-multisig',
  decidedAt: new Date('2026-09-24T00:00:00.000Z'),
  maximumTotalDeployed: 123n,
  minimumLiquidReserveBps: 10_000,
  rationale: 'Approved after policy review.',
  auditTrail: [{ provenance: 'ADMIN_INPUT', reference: 'assessment-001', note: 'Approved by governance.' }],
};

function returnedRecord(input: CreateAdminDecisionRecord) {
  return {
    ...input,
    auditTrail: [...input.auditTrail],
    assessmentId: input.assessmentId ?? null,
    maximumTotalDeployed: input.maximumTotalDeployed ?? null,
    minimumLiquidReserveBps: input.minimumLiquidReserveBps ?? null,
    createdAt: input.decidedAt,
    updatedAt: input.decidedAt,
  };
}

function mockDatabase(record = returnedRecord(baseDecision)): any {
  return {
    insert: () => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [record]),
      })),
    }),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({ limit: vi.fn(async () => [record]) })),
          limit: vi.fn(async () => [record]),
        })),
      })),
    })),
  };
}

describe('Admin Decision persistence', () => {
  it('persists an APPROVED decision with explicit policy values', async () => {
    const record = await createAdminDecision(mockDatabase(), baseDecision);
    expect(record.decision).toBe('APPROVED');
    expect(record.maximumTotalDeployed).toBe(123n);
    expect(record.minimumLiquidReserveBps).toBe(10_000);
    expect(record.auditTrail).toEqual(baseDecision.auditTrail);
  });

  it('retrieves a decision by decisionId', async () => {
    const record = await getAdminDecisionById(mockDatabase(), baseDecision.decisionId);
    expect(record?.decisionId).toBe(baseDecision.decisionId);
  });

  it('retrieves the authoritative approved decision', async () => {
    const record = await getAuthoritativeApprovedAdminDecision(mockDatabase());
    expect(record?.decision).toBe('APPROVED');
    expect(record?.maximumTotalDeployed).toBe(123n);
  });

  it('rejects approved decisions with missing policy values', async () => {
    await expect(createAdminDecision(mockDatabase(), { ...baseDecision, maximumTotalDeployed: undefined })).rejects.toThrow(/maximumTotalDeployed/);
    await expect(createAdminDecision(mockDatabase(), { ...baseDecision, minimumLiquidReserveBps: undefined })).rejects.toThrow(/minimumLiquidReserveBps/);
  });

  it('rejects non-approved decisions as execution candidates', () => {
    expect(() => assertApprovedAdminDecision({ ...returnedRecord({ ...baseDecision, decision: 'REJECTED' }), decision: 'REJECTED' })).toThrow(/APPROVED/);
  });

  it('relies on the database uniqueness constraint for duplicate decisionId', async () => {
    const database = mockDatabase();
    database.insert = vi.fn(() => ({
      values: () => ({ returning: async () => { throw new Error('duplicate key value violates unique constraint'); } }),
    }));
    await expect(createAdminDecision(database, baseDecision)).rejects.toThrow(/unique constraint/);
  });
});