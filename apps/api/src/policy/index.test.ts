import { ARC_MAINNET_EXECUTION_CONFIG } from '../config/arc-mainnet.js';
import { describe, expect, it } from 'vitest';

import type { TreasuryMonitoringSnapshot } from '../monitoring/index.js';
import {
  ADMIN_DECISION_APPROVED,
  ADMIN_DECISION_REJECTED,
  CORE_PROVENANCE,
  buildApprovedCoreExecutionPlan,
  createAdminDecision,
  createAuthenticatedAdminDecision,
  createAiRecommendation,
  createAiRiskAssessment,
  createAuthorizedCoreExecutionService,
  getPolicyDecisionService,
} from './index.js';

const validCoreAddress = ARC_MAINNET_EXECUTION_CONFIG.coreAddress;
const validAdapterAddress = ARC_MAINNET_EXECUTION_CONFIG.steakhouseAdapterAddress;

const snapshot: TreasuryMonitoringSnapshot = {
  chainId: 5042,
  coreAddress: validCoreAddress,
  block: 500n,
  timestamp: 1_700_000_000n,
  treasuryAssets: {
    totalManagedAssets: 1_000n,
    liquidUSDC: 400n,
    totalDeployed: 600n,
    requiredLiquidReserve: 100n,
    availableLiquidity: 300n,
  },
  userLiabilities: {
    totalUserLiabilities: 1_000n,
    aggregateUserLedgerValue: 1_000n,
  },
  strategies: [
    {
      strategyAddress: '0x1111111111111111111111111111111111111111',
      protocolId: '0x2222222222222222222222222222222222222222222222222222222222222222',
      assetAddress: '0x3600000000000000000000000000000000000000',
      core: {
        currentValue: 600n,
        position: 600n,
        shares: 600n,
        principal: 600n,
        realizedYield: 0n,
        realizedLoss: 0n,
        withdrawalShortfall: 0n,
        valuationStatus: 1,
        valuationBlock: 490n,
      },
      adapter: {
        currentValue: 600n,
        position: 600n,
        shares: 600n,
        principal: 600n,
      },
    },
  ],
  exposure: {
    protocolExposure: { '0x2222222222222222222222222222222222222222': 600n },
    assetExposure: { '0x3600000000000000000000000000000000000000': 600n },
    strategyDeployment: { '0x1111111111111111111111111111111111111111': 600n },
    totalDeployed: 600n,
  },
  approvals: {
    approvedProtocols: ['0x2222222222222222222222222222222222222222'],
    approvedAssets: ['0x3600000000000000000000000000000000000000'],
    approvedStrategies: ['0x1111111111111111111111111111111111111111'],
    riskPolicy: { minimumLiquidReserve: 100n, maximumTotalDeployed: 1_000n },
    caps: { totalDeployed: 1_000n },
    paused: false,
    pendingTimelocks: [],
  },
  treasuryUsdc: {
    actualCoreBalance: 1_000n,
    expectedAccountingBalance: 1_000n,
  },
  indexer: {
    lastProcessedBlock: 490n,
    currentHead: 500n,
    finalizedBlock: 500n,
    rpcAvailable: true,
    staleThreshold: 25n,
  },
};

describe('policy decision layer', () => {
  it('creates an untrusted AI recommendation and fails closed on unavailable required data', () => {
    const recommendation = createAiRecommendation({
      recommendationId: 'recommendation-001',
      createdAt: new Date('2026-09-27T00:00:00Z'),
      actionType: 'ALLOCATE_TO_APPROVED_STRATEGY',
      target: validCoreAddress,
      requestedAmount: 100n,
      asset: '0x3600000000000000000000000000000000000000',
      protocol: '0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450',
      strategy: validAdapterAddress,
      rationale: ['Reduce idle Treasury capital within an approved strategy cap.'],
      evidenceReferences: ['admin-projection:exposure'],
      expectedEffect: 'Increase configured strategy deployment by 100 base units.',
      riskClassification: 'MEDIUM',
      requiredApproval: 'ADMIN',
      requiredAuthoritativeData: [{ field: 'remainingStrategyCapacity', available: false }],
    });

    expect(recommendation.actor).toBe('AI');
    expect(recommendation.policyValidationStatus).toBe('DATA_UNAVAILABLE');
    expect(recommendation.executionStatus).toBe('NOT_EXECUTABLE');
    expect(recommendation.reason).toMatch(/remainingStrategyCapacity/);
    expect(() => createAiRecommendation({ ...recommendation, target: '0x1111111111111111111111111111111111111111', createdAt: new Date() })).toThrow(/configured VeloxTreasuryCore/i);
  });

  it('creates an AI recommendation with full provenance and versioning', () => {
    const recommendation = createAiRiskAssessment({
      snapshot,
      snapshotReference: 'block:500',
      assessmentId: 'assess-001',
      version: 1,
      createdAt: new Date('2023-11-14T22:13:30Z'),
      severity: 'MEDIUM',
      confidence: 0.86,
      freshness: 0.94,
      recommendationStatus: 'PENDING_REVIEW',
      recommendedExposure: {
        maximumTotalDeployed: 800n,
        minimumLiquidReserveBps: 10_000,
      },
      rationale: ['Strategy value is aligned with current USDC exposure.', 'Liquid reserves remain above the minimum threshold.'],
      evidence: [
        {
          id: 'signal-1',
          source: 'CORE_ON_CHAIN',
          provenance: 'CORE_ON_CHAIN',
          timestamp: new Date('2023-11-14T22:13:00Z'),
          freshnessSeconds: 60,
          isFresh: true,
          status: 'valid',
          reference: validCoreAddress,
          value: '600',
          notes: 'Current treasury deployed amount matches strategy value.',
        },
        {
          id: 'signal-2',
          source: 'EXTERNAL_SOURCE',
          provenance: 'EXTERNAL_SOURCE',
          timestamp: new Date('2023-11-14T22:12:30Z'),
          freshnessSeconds: 120,
          isFresh: true,
          status: 'valid',
          reference: 'https://example.com/market/prime-usdc',
          value: 'stable',
          notes: 'External protocol risk signal is within tolerances.',
        },
      ],
      coreLimits: {
        maximumTotalDeployed: 1_000n,
        minimumLiquidReserveBps: 10_000,
      },
    });

    expect(recommendation.assessmentId).toBe('assess-001');
    expect(recommendation.version).toBe(1);
    expect(recommendation.status).toBe('PENDING_REVIEW');
    expect(recommendation.confidence).toBeGreaterThan(0.5);
    expect(recommendation.provenance).toEqual(expect.arrayContaining([...CORE_PROVENANCE]));
    expect(recommendation.aiTransactionAuthority).toEqual({ canSign: false, canExecute: false, canCreateRoles: false });
    expect(recommendation.resultingCoreOperationReferences).toEqual([]);
  });

  it('requires a separately verified POLICY_ADMIN wallet for an authenticated Admin decision', () => {
    const recommendation = createAiRiskAssessment({
      snapshot,
      snapshotReference: 'block:500',
      assessmentId: 'assess-authenticated-admin',
      createdAt: new Date('2023-11-14T22:13:30Z'),
      severity: 'LOW', confidence: 0.9, freshness: 1,
      recommendedExposure: { maximumTotalDeployed: 600n, minimumLiquidReserveBps: 10_000 },
      rationale: ['Approval must be distinct from AI output.'],
      evidence: [{ id: 'core', source: 'CORE_ON_CHAIN', provenance: 'CORE_ON_CHAIN', timestamp: new Date('2023-11-14T22:13:00Z'), freshnessSeconds: 30, isFresh: true, status: 'valid' }],
      coreLimits: { maximumTotalDeployed: 1_000n, minimumLiquidReserveBps: 10_000 },
    });
    const input = {
      recommendation, decision: ADMIN_DECISION_APPROVED,
      decidedBy: '0x1111111111111111111111111111111111111111' as const, decidedAt: new Date('2023-11-14T22:15:00Z'),
      finalPolicyValues: { minimumLiquidReserve: 100n, maximumTotalDeployed: 600n, minimumLiquidReserveBps: 10_000 }, rationale: 'Authenticated approval.',
    };
    expect(() => createAuthenticatedAdminDecision(input, {
      authenticatedWalletAddress: input.decidedBy, chainId: 5042, policyAdminRoleVerified: false,
    })).toThrow(/POLICY_ADMIN_ROLE/);
    expect(createAuthenticatedAdminDecision(input, {
      authenticatedWalletAddress: input.decidedBy, chainId: 5042, policyAdminRoleVerified: true,
    }).decidedBy).toBe(input.decidedBy);
  });

  it('reduces confidence and rejects stale or missing data', () => {
    const stale = createAiRiskAssessment({
      snapshot,
      snapshotReference: 'block:500',
      assessmentId: 'assess-002',
      version: 1,
      createdAt: new Date('2026-09-23T10:00:00Z'),
      severity: 'HIGH',
      confidence: 0.8,
      freshness: 0.1,
      recommendationStatus: 'STALE',
      recommendedExposure: { maximumTotalDeployed: 500n, minimumLiquidReserveBps: 10_000 },
      rationale: ['Snapshot is stale.'],
      evidence: [
        {
          id: 'signal-3',
          source: 'CORE_ON_CHAIN',
          provenance: 'CORE_ON_CHAIN',
          timestamp: new Date('2026-09-23T09:00:00Z'),
          freshnessSeconds: 3_600,
          isFresh: false,
          status: 'stale',
          reference: '0xcc058cFcC77061Ff1c47DbA50dF064B75053aC27',
          value: '500',
          notes: 'Stale monitoring snapshot.',
        },
      ],
      coreLimits: {
        maximumTotalDeployed: 1_000n,
        minimumLiquidReserveBps: 10_000,
      },
      maxDataAgeSeconds: 900,
    });

    expect(stale.confidence).toBeLessThan(0.8);
    expect(stale.status).toMatch(/STALE|INSUFFICIENT_DATA/);

    expect(() =>
      createAiRiskAssessment({
        snapshot,
        snapshotReference: 'block:500',
        assessmentId: 'assess-003',
        version: 1,
        createdAt: new Date('2026-09-23T10:00:00Z'),
        severity: 'HIGH',
        confidence: 0.9,
        freshness: 0.9,
        recommendationStatus: 'PENDING_REVIEW',
        recommendedExposure: { maximumTotalDeployed: 800n, minimumLiquidReserveBps: 10_000 },
        rationale: ['Missing evidence.'],
        evidence: [
          {
            id: 'signal-missing',
            source: 'EXTERNAL_SOURCE',
            provenance: 'EXTERNAL_SOURCE',
            timestamp: new Date('2026-09-23T09:59:00Z'),
            freshnessSeconds: 0,
            isFresh: false,
            status: 'missing',
            reference: 'https://example.com/missing',
            notes: 'Source unavailable.',
          },
        ],
        coreLimits: {
          maximumTotalDeployed: 1_000n,
          minimumLiquidReserveBps: 10_000,
        },
      }),
    ).toThrow(/missing|stale|insufficient/i);
  });

  it('enforces Core limits on AI recommendations', () => {
    expect(() =>
      createAiRiskAssessment({
        snapshot,
        snapshotReference: 'block:500',
        assessmentId: 'assess-004',
        version: 1,
        createdAt: new Date('2023-11-14T22:13:30Z'),
        severity: 'CRITICAL',
        confidence: 0.9,
        freshness: 0.95,
        recommendationStatus: 'PENDING_REVIEW',
        recommendedExposure: { maximumTotalDeployed: 1_500n, minimumLiquidReserveBps: 10_000 },
        rationale: ['AI attempt exceeds Core cap.'],
        evidence: [
          {
            id: 'signal-4',
            source: 'CORE_ON_CHAIN',
            provenance: 'CORE_ON_CHAIN',
            timestamp: new Date('2026-09-23T10:00:00Z'),
            freshnessSeconds: 5,
            isFresh: true,
            status: 'valid',
            reference: '0xcc058cFcC77061Ff1c47DbA50dF064B75053aC27',
            value: '1_500',
          },
        ],
        coreLimits: {
          maximumTotalDeployed: 1_000n,
          minimumLiquidReserveBps: 10_000,
        },
      }),
    ).toThrow(/exceeds Core-enforced/i);
  });

  it('supports admin approval and rejection with auditable records', () => {
    const recommendation = createAiRiskAssessment({
      snapshot,
      snapshotReference: 'block:500',
      assessmentId: 'assess-005',
      version: 1,
      createdAt: new Date('2023-11-14T22:13:30Z'),
      severity: 'LOW',
      confidence: 0.83,
      freshness: 0.9,
      recommendationStatus: 'PENDING_REVIEW',
      recommendedExposure: { maximumTotalDeployed: 750n, minimumLiquidReserveBps: 10_000 },
      rationale: ['Exposure remains within safe treasury limits.'],
      evidence: [
        {
          id: 'signal-5',
          source: 'CORE_ON_CHAIN',
          provenance: 'CORE_ON_CHAIN',
          timestamp: new Date('2023-11-14T22:13:00Z'),
          freshnessSeconds: 60,
          isFresh: true,
          status: 'valid',
          reference: '0xcc058cFcC77061Ff1c47DbA50dF064B75053aC27',
          value: '600',
        },
      ],
      coreLimits: {
        maximumTotalDeployed: 1_000n,
        minimumLiquidReserveBps: 10_000,
      },
    });

    const approval = createAdminDecision({
      recommendation,
      decision: ADMIN_DECISION_APPROVED,
      decidedBy: '0xAdminMultiSig',
      decidedAt: new Date('2026-09-23T10:05:00Z'),
      finalPolicyValues: {
        maximumTotalDeployed: 750n,
        minimumLiquidReserveBps: 10_000,
      },
      rationale: 'Admin accepted the AI recommendation after reviewing liquidity and protocol exposure.',
      notes: 'Risk is still within Core caps and liquidity reserve requirement.',
    });

    expect(approval.decision).toBe('APPROVED');
    expect(approval.auditTrail.some((entry) => entry.provenance === 'AI_INFERENCE')).toBe(true);
    expect(approval.auditTrail.some((entry) => entry.provenance === 'ADMIN_INPUT')).toBe(true);
    expect(approval.resultingCoreOperationReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'risk_policy_update' }),
    ]));

    const rejection = createAdminDecision({
      recommendation,
      decision: ADMIN_DECISION_REJECTED,
      decidedBy: '0xAdminMultiSig',
      decidedAt: new Date('2026-09-23T10:06:00Z'),
      rationale: 'Recommendation rejected due to incomplete evidence.',
      notes: 'Admin rejected this recommendation without changing Core state.',
    });

    expect(rejection.decision).toBe('REJECTED');
    expect(rejection.finalPolicyValues).toBeUndefined();
  });

  it('has no transaction or signing path in the AI layer', () => {
    const recommendation = getPolicyDecisionService().createAiRiskAssessment({
      snapshot,
      snapshotReference: 'block:500',
      assessmentId: 'assess-006',
      version: 1,
      createdAt: new Date('2023-11-14T22:13:30Z'),
      severity: 'LOW',
      confidence: 0.85,
      freshness: 0.9,
      recommendationStatus: 'PENDING_REVIEW',
      recommendedExposure: { maximumTotalDeployed: 500n, minimumLiquidReserveBps: 10_000 },
      rationale: ['No transaction authority should exist.'],
      evidence: [
        {
          id: 'signal-6',
          source: 'CORE_ON_CHAIN',
          provenance: 'CORE_ON_CHAIN',
          timestamp: new Date('2023-11-14T22:13:00Z'),
          freshnessSeconds: 10,
          isFresh: true,
          status: 'valid',
          reference: '0xcc058cFcC77061Ff1c47DbA50dF064B75053aC27',
          value: '500',
        },
      ],
      coreLimits: {
        maximumTotalDeployed: 1_000n,
        minimumLiquidReserveBps: 10_000,
      },
    });

    expect((recommendation as any).transaction).toBeUndefined();
    expect((recommendation as any).signer).toBeUndefined();
    expect((recommendation as any).privateKey).toBeUndefined();
    expect(recommendation.aiTransactionAuthority).toEqual({ canSign: false, canExecute: false, canCreateRoles: false });
  });

  it('builds auditable Core execution calldata for an approved Admin decision', () => {
    const recommendation = createAiRiskAssessment({
      snapshot,
      snapshotReference: 'block:500',
      assessmentId: 'assess-007',
      version: 1,
      createdAt: new Date('2023-11-14T22:13:30Z'),
      severity: 'LOW',
      confidence: 0.85,
      freshness: 0.9,
      recommendationStatus: 'PENDING_REVIEW',
      recommendedExposure: { maximumTotalDeployed: 600n, minimumLiquidReserveBps: 10_000 },
      rationale: ['Approved decision should yield Core plan.'],
      evidence: [
        {
          id: 'signal-7',
          source: 'CORE_ON_CHAIN',
          provenance: 'CORE_ON_CHAIN',
          timestamp: new Date('2023-11-14T22:13:00Z'),
          freshnessSeconds: 10,
          isFresh: true,
          status: 'valid',
          reference: '0xcc058cFcC77061Ff1c47DbA50dF064B75053aC27',
          value: '600',
        },
      ],
      coreLimits: {
        maximumTotalDeployed: 1_000n,
        minimumLiquidReserveBps: 10_000,
      },
    });

    const approval = createAdminDecision({
      recommendation,
      decision: ADMIN_DECISION_APPROVED,
      decidedBy: '0xAdminMultiSig',
      decidedAt: new Date('2023-11-14T22:15:00Z'),
      finalPolicyValues: {
        minimumLiquidReserve: 100n,
        maximumTotalDeployed: 600n,
        minimumLiquidReserveBps: 10_000,
      },
      rationale: 'Admin approval for the approved recommendation.',
    });

    const plan = buildApprovedCoreExecutionPlan(approval, {
      coreAddress: validCoreAddress,
      chainId: 5042,
      protocolId: '0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450',
      usdcAddress: '0x3600000000000000000000000000000000000000',
      strategyAdapter: validAdapterAddress,
    });

    expect(plan.length).toBeGreaterThanOrEqual(4);
    expect(plan.every((op) => op.validationStatus === 'VALID')).toBe(true);
    expect(plan.every((op) => op.timelockRequired === true)).toBe(true);
    expect(plan.some((op) => op.operationType === 'risk_policy_update')).toBe(true);
    expect(plan.some((op) => op.operationType === 'protocol_approval')).toBe(true);
    expect(plan.some((op) => op.operationType === 'asset_approval')).toBe(true);
    expect(plan.some((op) => op.operationType === 'strategy_approval')).toBe(true);
    expect(plan.every((op) => op.calldata.startsWith('0x'))).toBe(true);
    expect(plan.every((op) => !('privateKey' in op))).toBe(true);

    expect(() => buildApprovedCoreExecutionPlan(approval, {
      coreAddress: '0xcc058cFcC77061Ff1c47DbA50dF064B75053aC27',
      chainId: 5042,
      protocolId: '0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450',
      usdcAddress: '0x3600000000000000000000000000000000000000',
      strategyAdapter: validAdapterAddress,
    })).toThrow(/Core/i);

    expect(() => buildApprovedCoreExecutionPlan(approval, {
      coreAddress: validCoreAddress,
      chainId: 5042,
      protocolId: '0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450',
      usdcAddress: '0x3600000000000000000000000000000000000000',
      strategyAdapter: '0xE886A619584a1fF017E744D5B55F0D5dc59018c4',
    })).toThrow(/adapter/i);
  });

  it('rejects rejected decisions, missing policy values, wrong protocol, wrong asset, wrong Core, wrong chain, and missing signer access', () => {
    const recommendation = createAiRiskAssessment({
      snapshot,
      snapshotReference: 'block:500',
      assessmentId: 'assess-008',
      version: 1,
      createdAt: new Date('2023-11-14T22:13:30Z'),
      severity: 'LOW',
      confidence: 0.85,
      freshness: 0.9,
      recommendationStatus: 'PENDING_REVIEW',
      recommendedExposure: { maximumTotalDeployed: 800n, minimumLiquidReserveBps: 10_000 },
      rationale: ['Execution adapter validation should reject unsafe inputs.'],
      evidence: [
        {
          id: 'signal-8',
          source: 'CORE_ON_CHAIN',
          provenance: 'CORE_ON_CHAIN',
          timestamp: new Date('2023-11-14T22:13:00Z'),
          freshnessSeconds: 10,
          isFresh: true,
          status: 'valid',
          reference: '0xcc058cFcC77061Ff1c47DbA50dF064B75053aC27',
          value: '800',
        },
      ],
      coreLimits: {
        maximumTotalDeployed: 1_000n,
        minimumLiquidReserveBps: 10_000,
      },
    });

    const rejected = createAdminDecision({
      recommendation,
      decision: ADMIN_DECISION_REJECTED,
      decidedBy: '0xAdminMultiSig',
      decidedAt: new Date('2023-11-14T22:15:00Z'),
      rationale: 'Rejected by admin.',
    });

    expect(() => buildApprovedCoreExecutionPlan(rejected, {
      coreAddress: validCoreAddress,
      chainId: 5042,
      protocolId: '0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450',
      usdcAddress: '0x3600000000000000000000000000000000000000',
      strategyAdapter: validAdapterAddress,
    })).toThrow(/APPROVED|approved/i);

    expect(() => buildApprovedCoreExecutionPlan({
      ...createAdminDecision({
        recommendation,
        decision: ADMIN_DECISION_APPROVED,
        decidedBy: '0xAdminMultiSig',
        decidedAt: new Date('2023-11-14T22:15:00Z'),
        finalPolicyValues: undefined,
        rationale: 'approved missing values',
      }),
    }, {
      coreAddress: validCoreAddress,
      chainId: 5042,
      protocolId: '0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450',
      usdcAddress: '0x3600000000000000000000000000000000000000',
      strategyAdapter: validAdapterAddress,
    })).toThrow(/final policy values|required policy|cap/i);

    expect(() => buildApprovedCoreExecutionPlan(createAdminDecision({
      recommendation,
      decision: ADMIN_DECISION_APPROVED,
      decidedBy: '0xAdminMultiSig',
      decidedAt: new Date('2023-11-14T22:15:00Z'),
      finalPolicyValues: {
        minimumLiquidReserve: 100n,
        maximumTotalDeployed: 800n,
        minimumLiquidReserveBps: 10_000,
      },
      rationale: 'Approved with valid values.',
    }), {
      coreAddress: validCoreAddress,
      chainId: 5042,
      protocolId: '0x1111111111111111111111111111111111111111',
      usdcAddress: '0x3600000000000000000000000000000000000000',
      strategyAdapter: validAdapterAddress,
    })).toThrow(/protocol/i);

    expect(() => buildApprovedCoreExecutionPlan(createAdminDecision({
      recommendation,
      decision: ADMIN_DECISION_APPROVED,
      decidedBy: '0xAdminMultiSig',
      decidedAt: new Date('2023-11-14T22:15:00Z'),
      finalPolicyValues: {
        minimumLiquidReserve: 100n,
        maximumTotalDeployed: 800n,
        minimumLiquidReserveBps: 10_000,
      },
      rationale: 'Approved with valid values.',
    }), {
      coreAddress: validCoreAddress,
      chainId: 5042,
      protocolId: '0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450',
      usdcAddress: '0x1111111111111111111111111111111111111111',
      strategyAdapter: validAdapterAddress,
    })).toThrow(/asset|USDC/i);

    expect(() => buildApprovedCoreExecutionPlan(createAdminDecision({
      recommendation,
      decision: ADMIN_DECISION_APPROVED,
      decidedBy: '0xAdminMultiSig',
      decidedAt: new Date('2023-11-14T22:15:00Z'),
      finalPolicyValues: {
        minimumLiquidReserve: 100n,
        maximumTotalDeployed: 800n,
        minimumLiquidReserveBps: 10_000,
      },
      rationale: 'Approved with valid values.',
    }), {
      coreAddress: '0x2222222222222222222222222222222222222222',
      chainId: 5042,
      protocolId: '0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450',
      usdcAddress: '0x3600000000000000000000000000000000000000',
      strategyAdapter: validAdapterAddress,
    })).toThrow(/Core|core/i);

    expect(() => buildApprovedCoreExecutionPlan(createAdminDecision({
      recommendation,
      decision: ADMIN_DECISION_APPROVED,
      decidedBy: '0xAdminMultiSig',
      decidedAt: new Date('2023-11-14T22:15:00Z'),
      finalPolicyValues: {
        minimumLiquidReserve: 100n,
        maximumTotalDeployed: 800n,
        minimumLiquidReserveBps: 10_000,
      },
      rationale: 'Approved with valid values.',
    }), {
      coreAddress: validCoreAddress,
      chainId: 1,
      protocolId: '0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450',
      usdcAddress: '0x3600000000000000000000000000000000000000',
      strategyAdapter: validAdapterAddress,
    })).toThrow(/chain/i);

    const executionPlan = buildApprovedCoreExecutionPlan(createAdminDecision({
      recommendation,
      decision: ADMIN_DECISION_APPROVED,
      decidedBy: '0xAdminMultiSig',
      decidedAt: new Date('2023-11-14T22:15:00Z'),
      finalPolicyValues: {
        minimumLiquidReserve: 100n,
        maximumTotalDeployed: 800n,
        minimumLiquidReserveBps: 10_000,
      },
      rationale: 'Approved with valid values.',
    }), {
      coreAddress: validCoreAddress,
      chainId: 5042,
      protocolId: '0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450',
      usdcAddress: '0x3600000000000000000000000000000000000000',
      strategyAdapter: validAdapterAddress,
    });

    expect(executionPlan.every((operation) => operation.timelockRequired === true)).toBe(true);
    expect(executionPlan.every((operation) => operation.validationStatus === 'VALID')).toBe(true);
    expect((executionPlan[0] as any).privateKey).toBeUndefined();
    expect((executionPlan[0] as any).signer).toBeUndefined();
    expect(executionPlan[0]?.functionName).toMatch(/schedule|approve/i);
    expect(executionPlan.every((operation) => operation.calldata.startsWith('0x'))).toBe(true);
  });

  it('authorizes only approved Admin decisions and rejects unsafe execution requests', () => {
    const recommendation = createAiRiskAssessment({
      snapshot,
      snapshotReference: 'block:500',
      assessmentId: 'assess-009',
      version: 1,
      createdAt: new Date('2023-11-14T22:13:30Z'),
      severity: 'LOW',
      confidence: 0.85,
      freshness: 0.9,
      recommendationStatus: 'PENDING_REVIEW',
      recommendedExposure: { maximumTotalDeployed: 600n, minimumLiquidReserveBps: 10_000 },
      rationale: ['Approved admin decision should pass preflight.'],
      evidence: [
        {
          id: 'signal-9',
          source: 'CORE_ON_CHAIN',
          provenance: 'CORE_ON_CHAIN',
          timestamp: new Date('2023-11-14T22:13:00Z'),
          freshnessSeconds: 10,
          isFresh: true,
          status: 'valid',
          reference: '0xcc058cFcC77061Ff1c47DbA50dF064B75053aC27',
          value: '600',
        },
      ],
      coreLimits: {
        maximumTotalDeployed: 1_000n,
        minimumLiquidReserveBps: 10_000,
      },
    });

    const approved = createAdminDecision({
      recommendation,
      decision: ADMIN_DECISION_APPROVED,
      decidedBy: '0xAdminMultiSig',
      decidedAt: new Date('2023-11-14T22:15:00Z'),
      finalPolicyValues: {
        minimumLiquidReserve: 100n,
        maximumTotalDeployed: 600n,
        minimumLiquidReserveBps: 10_000,
      },
      rationale: 'Admin approved the recommendation and authorized a dry-run schedule submission.',
    });

    const executionPlan = buildApprovedCoreExecutionPlan(approved, {
      coreAddress: validCoreAddress,
      chainId: 5042,
      protocolId: '0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450',
      usdcAddress: '0x3600000000000000000000000000000000000000',
      strategyAdapter: validAdapterAddress,
    });

    const service = createAuthorizedCoreExecutionService();
    const dryRun = service.dryRunExecution(approved, executionPlan, {
      authorizedAddress: '0x1111111111111111111111111111111111111111',
      role: 'POLICY_ADMIN_ROLE',
      canSign: true,
    });

    expect(dryRun.every((item) => item.authorizationStatus === 'AUTHORIZED')).toBe(true);
    expect(dryRun.every((item) => item.requiredSignerRole === 'POLICY_ADMIN_ROLE')).toBe(true);
    expect(dryRun.every((item) => item.transaction.target === validCoreAddress)).toBe(true);
    expect(dryRun.every((item) => item.transaction.functionName.startsWith('schedule'))).toBe(true);
    expect(dryRun.some((item) => item.operationType === 'risk_policy_update')).toBe(true);
    expect(dryRun.every((item) => item.transaction.value === 0n)).toBe(true);

    const rejected = createAdminDecision({
      recommendation,
      decision: ADMIN_DECISION_REJECTED,
      decidedBy: '0xAdminMultiSig',
      decidedAt: new Date('2023-11-14T22:15:00Z'),
      rationale: 'Admin rejected the recommendation.',
    });

    expect(() => service.dryRunExecution(rejected, executionPlan, {
      authorizedAddress: '0x1111111111111111111111111111111111111111',
      role: 'POLICY_ADMIN_ROLE',
      canSign: true,
    })).toThrow(/APPROVED|approved/i);

    expect(() => service.submitExecution(approved, executionPlan, {
      authorizedAddress: '0x2222222222222222222222222222222222222222',
      role: 'TIMELOCK_EXECUTOR_ROLE',
      canSign: true,
    })).toThrow(/POLICY_ADMIN_ROLE|unauthorized|role/i);

    const prepared = service.submitExecution(approved, executionPlan, {
      authorizedAddress: '0x1111111111111111111111111111111111111111',
      role: 'POLICY_ADMIN_ROLE',
      canSign: true,
    });
    expect(prepared.every((item) => item.status === 'PREPARED')).toBe(true);
    expect(prepared.every((item) => item.executionStatus === 'NOT_EXECUTED')).toBe(true);
    expect(prepared.every((item) => !('txHash' in item))).toBe(true);
    expect(prepared.every((item) => item.preparedPayloadHash.startsWith('0x'))).toBe(true);
    expect(() => service.submitExecution(approved, executionPlan, {
      authorizedAddress: '0x1111111111111111111111111111111111111111',
      role: 'POLICY_ADMIN_ROLE',
      canSign: true,
    })).toThrow(/duplicate/i);

    const scheduleTxs = service.prepareScheduleTransactions(approved, executionPlan, {
      authorizedAddress: '0x1111111111111111111111111111111111111111',
      role: 'POLICY_ADMIN_ROLE',
      canSign: true,
    });

    expect(scheduleTxs.every((item) => item.role === 'POLICY_ADMIN_ROLE')).toBe(true);
    expect(scheduleTxs.every((item) => item.target.toLowerCase() === validCoreAddress.toLowerCase())).toBe(true);
    expect(scheduleTxs.every((item) => item.functionName.startsWith('schedule'))).toBe(true);
    expect(scheduleTxs.every((item) => item.calldata.startsWith('0x'))).toBe(true);

    expect(() => service.prepareExecuteTransactions(approved, executionPlan, {
      authorizedAddress: '0x3333333333333333333333333333333333333333',
      role: 'TIMELOCK_EXECUTOR_ROLE',
      canSign: true,
    }, new Date('2023-11-16T22:15:00Z').getTime())).toThrow(/timelock state is unavailable/i);

    const aiOnly = createAiRiskAssessment({
      snapshot,
      snapshotReference: 'block:500',
      assessmentId: 'assess-010',
      version: 1,
      createdAt: new Date('2023-11-14T22:13:30Z'),
      severity: 'LOW',
      confidence: 0.85,
      freshness: 0.9,
      recommendationStatus: 'PENDING_REVIEW',
      recommendedExposure: { maximumTotalDeployed: 600n, minimumLiquidReserveBps: 10_000 },
      rationale: ['AI recommendation should never trigger execution.'],
      evidence: [
        {
          id: 'signal-10',
          source: 'CORE_ON_CHAIN',
          provenance: 'CORE_ON_CHAIN',
          timestamp: new Date('2023-11-14T22:13:00Z'),
          freshnessSeconds: 10,
          isFresh: true,
          status: 'valid',
          reference: '0xcc058cFcC77061Ff1c47DbA50dF064B75053aC27',
          value: '600',
        },
      ],
      coreLimits: {
        maximumTotalDeployed: 1_000n,
        minimumLiquidReserveBps: 10_000,
      },
    });

    expect(() => service.submitExecution(aiOnly as never, executionPlan, {
      authorizedAddress: '0x1111111111111111111111111111111111111111',
      role: 'POLICY_ADMIN_ROLE',
      canSign: true,
    })).toThrow(/APPROVED Admin decision|Admin decision/i);
  });
});
