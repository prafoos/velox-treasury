import { encodeFunctionData, isAddress, isHex, keccak256, toHex } from 'viem';

import { ARC_MAINNET_EXECUTION_CONFIG } from '../config/arc-mainnet.js';
import type { TreasuryMonitoringSnapshot } from '../monitoring/index.js';

export const CORE_PROVENANCE = [
  'CORE_ON_CHAIN',
  'EXTERNAL_SOURCE',
  'DERIVED_CALCULATION',
  'AI_INFERENCE',
  'ADMIN_INPUT',
] as const;

export type EvidenceProvenance = (typeof CORE_PROVENANCE)[number];
export type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type RecommendationStatus = 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'STALE' | 'INSUFFICIENT_DATA';
export type AdminDecisionType = 'APPROVED' | 'REJECTED';
export type PolicyOperationKind = 'risk_policy_update' | 'protocol_approval' | 'asset_approval' | 'strategy_approval';
export type AiRecommendationAction =
  | 'ALLOCATE_TO_APPROVED_STRATEGY'
  | 'DEALLOCATE_FROM_APPROVED_STRATEGY'
  | 'REDUCE_EXPOSURE'
  | 'REBALANCE'
  | 'SCHEDULE_RISK_POLICY_CHANGE'
  | 'EMERGENCY_RESPONSE';
export type RecommendationPolicyValidationStatus = 'NOT_VALIDATED' | 'DATA_UNAVAILABLE' | 'POLICY_REJECTED';
export type RecommendationExecutionStatus = 'NOT_EXECUTABLE';

/**
 * Untrusted AI output. It is deliberately incapable of carrying signing or
 * execution authority; future workflows must validate it against fresh Core
 * state and obtain a separately authenticated Admin decision.
 */
export interface AiRecommendation {
  readonly recommendationId: string;
  readonly createdAt: string;
  readonly actor: 'AI';
  readonly actionType: AiRecommendationAction;
  readonly target: `0x${string}`;
  readonly requestedAmount: bigint | null;
  readonly asset: `0x${string}` | null;
  readonly protocol: `0x${string}` | null;
  readonly strategy: `0x${string}` | null;
  readonly rationale: readonly string[];
  readonly evidenceReferences: readonly string[];
  readonly expectedEffect: string;
  readonly riskClassification: RiskSeverity;
  readonly requiredApproval: 'ADMIN' | 'ADMIN_AND_TIMELOCK' | 'EMERGENCY_AUTHORITY';
  readonly policyValidationStatus: RecommendationPolicyValidationStatus;
  readonly executionStatus: RecommendationExecutionStatus;
  readonly reason?: string;
}

export interface CreateAiRecommendationInput extends Omit<AiRecommendation, 'actor' | 'createdAt' | 'policyValidationStatus' | 'executionStatus' | 'reason'> {
  readonly createdAt: Date | string | number;
  /** Every item needed for safe validation must be available; absent data never means zero. */
  readonly requiredAuthoritativeData?: readonly { readonly field: string; readonly available: boolean }[];
}

export interface RiskEvidence {
  id: string;
  source: string;
  provenance: EvidenceProvenance;
  timestamp: Date | string | number;
  freshnessSeconds: number;
  isFresh: boolean;
  status: 'valid' | 'stale' | 'missing' | 'conflicting';
  reference?: string;
  value?: string | number | bigint;
  notes?: string;
}

export interface RecommendedExposure {
  maximumTotalDeployed: bigint;
  minimumLiquidReserve?: bigint;
  minimumLiquidReserveBps: number;
}

export interface CoreLimits {
  maximumTotalDeployed: bigint;
  minimumLiquidReserve?: bigint;
  minimumLiquidReserveBps: number;
}

export interface PolicyDecisionOperationReference {
  kind: PolicyOperationKind;
  reference: string;
  target: string;
  timelockRequired: boolean;
  riskIncreasing: boolean;
  status: 'PENDING' | 'READY' | 'EXECUTED';
}

export interface AiRiskAssessment {
  assessmentId: string;
  version: number;
  createdAt: string;
  snapshotReference: string;
  snapshot: TreasuryMonitoringSnapshot;
  severity: RiskSeverity;
  confidence: number;
  freshness: number;
  status: RecommendationStatus;
  recommendedExposure: RecommendedExposure;
  rationale: string[];
  evidence: RiskEvidence[];
  provenance: EvidenceProvenance[];
  coreLimits: CoreLimits;
  aiTransactionAuthority: {
    canSign: false;
    canExecute: false;
    canCreateRoles: false;
  };
  resultingCoreOperationReferences: PolicyDecisionOperationReference[];
}

export interface AdminDecisionAuditEntry {
  provenance: EvidenceProvenance;
  reference: string;
  note: string;
}

export interface AdminDecision {
  decisionId: string;
  recommendationId: string;
  decision: AdminDecisionType;
  decidedBy: string;
  decidedAt: string;
  finalPolicyValues?: RecommendedExposure;
  rationale: string;
  notes?: string;
  auditTrail: AdminDecisionAuditEntry[];
  resultingCoreOperationReferences: PolicyDecisionOperationReference[];
}

/** Server-side authorization result supplied only after wallet authentication and Core role verification. */
export interface AuthenticatedAdminApprovalContext {
  readonly authenticatedWalletAddress: `0x${string}`;
  readonly chainId: number;
  readonly policyAdminRoleVerified: boolean;
}

export const ADMIN_DECISION_APPROVED: AdminDecisionType = 'APPROVED';
export const ADMIN_DECISION_REJECTED: AdminDecisionType = 'REJECTED';

interface CreateAiRiskAssessmentInput {
  snapshot: TreasuryMonitoringSnapshot;
  snapshotReference: string;
  assessmentId: string;
  version?: number;
  createdAt: Date | string | number;
  severity: RiskSeverity;
  confidence: number;
  freshness: number;
  recommendationStatus?: RecommendationStatus;
  recommendedExposure: RecommendedExposure;
  rationale: string[];
  evidence: RiskEvidence[];
  coreLimits: CoreLimits;
  maxDataAgeSeconds?: number;
}

interface CreateAdminDecisionInput {
  recommendation: AiRiskAssessment;
  decision: AdminDecisionType;
  decidedBy: string;
  decidedAt: Date | string | number;
  finalPolicyValues?: RecommendedExposure;
  rationale: string;
  notes?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toIsoString(value: Date | string | number): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  return new Date(value).toISOString();
}

export function createAiRecommendation(input: CreateAiRecommendationInput): AiRecommendation {
  if (!input.recommendationId.trim()) throw new Error('recommendationId is required.');
  if (!isAddress(input.target) || input.target.toLowerCase() !== ARC_MAINNET_EXECUTION_CONFIG.coreAddress.toLowerCase()) {
    throw new Error('AI recommendations may target only the configured VeloxTreasuryCore.');
  }
  if (input.requestedAmount !== null && input.requestedAmount < 0n) {
    throw new Error('requestedAmount must be non-negative when supplied.');
  }
  if (input.rationale.length === 0 || input.rationale.some((item) => !item.trim())) {
    throw new Error('AI recommendations require non-empty rationale.');
  }

  const unavailable = (input.requiredAuthoritativeData ?? []).filter((item) => !item.available).map((item) => item.field);
  return {
    recommendationId: input.recommendationId,
    createdAt: toIsoString(input.createdAt),
    actor: 'AI',
    actionType: input.actionType,
    target: input.target,
    requestedAmount: input.requestedAmount,
    asset: input.asset,
    protocol: input.protocol,
    strategy: input.strategy,
    rationale: input.rationale,
    evidenceReferences: input.evidenceReferences,
    expectedEffect: input.expectedEffect,
    riskClassification: input.riskClassification,
    requiredApproval: input.requiredApproval,
    policyValidationStatus: unavailable.length > 0 ? 'DATA_UNAVAILABLE' : 'NOT_VALIDATED',
    executionStatus: 'NOT_EXECUTABLE',
    reason: unavailable.length > 0
      ? `Required authoritative data is unavailable: ${unavailable.join(', ')}.`
      : 'AI output is a recommendation only and requires fresh policy validation plus the required human authorization.',
  };
}

function normalizeBigInt(value: string | number | bigint | undefined): bigint | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '0x') return null;
    try {
      return BigInt(trimmed.replace(/_/g, ''));
    } catch {
      return null;
    }
  }
  return null;
}

function getSnapshotAgeSeconds(snapshot: TreasuryMonitoringSnapshot, createdAt: Date | string | number): number {
  const snapshotTs = normalizeBigInt(snapshot.timestamp as bigint | string | number | undefined);
  const createdTs = BigInt(Math.round(new Date(toIsoString(createdAt)).getTime() / 1000));
  if (snapshotTs === null) return Number.MAX_SAFE_INTEGER;
  const delta = createdTs - snapshotTs;
  return Number(delta < 0n ? 0n : delta);
}

function computeProvenance(evidence: RiskEvidence[]): EvidenceProvenance[] {
  const all = new Set<EvidenceProvenance>();
  for (const signal of evidence) {
    if (signal.provenance) all.add(signal.provenance);
  }
  all.add('CORE_ON_CHAIN');
  all.add('EXTERNAL_SOURCE');
  all.add('DERIVED_CALCULATION');
  all.add('AI_INFERENCE');
  all.add('ADMIN_INPUT');
  return [...all];
}

function compareExposureWithCore(recommended: RecommendedExposure, coreLimits: CoreLimits): void {
  if (recommended.maximumTotalDeployed > coreLimits.maximumTotalDeployed) {
    throw new Error('AI recommendation exceeds Core-enforced maximumTotalDeployed limits.');
  }
  if (recommended.minimumLiquidReserveBps < coreLimits.minimumLiquidReserveBps) {
    throw new Error('AI recommendation violates the Core minimumLiquidReserveBps floor.');
  }
}

function deriveRecommendationStatus(
  evidence: RiskEvidence[],
  confidence: number,
  freshness: number,
  snapshotAgeSeconds: number,
  maxDataAgeSeconds: number,
  explicitStatus?: RecommendationStatus,
): { status: RecommendationStatus; confidence: number } {
  const validSignals = evidence.filter((signal) => signal.status === 'valid').length;
  const staleSignals = evidence.filter((signal) => signal.status === 'stale').length;
  const missingSignals = evidence.filter((signal) => signal.status === 'missing').length;
  const conflictingSignals = evidence.filter((signal) => signal.status === 'conflicting').length;

  let nextConfidence = clamp(confidence, 0, 1);
  let status: RecommendationStatus = explicitStatus ?? 'PENDING_REVIEW';

  if (missingSignals > 0 && validSignals === 0) {
    throw new Error('Missing or unavailable evidence makes the AI recommendation unsafe to approve.');
  }

  if (missingSignals > 0) {
    nextConfidence = clamp(nextConfidence - (missingSignals * 0.2), 0, 1);
    status = 'INSUFFICIENT_DATA';
  }

  if (staleSignals > 0) {
    nextConfidence = clamp(nextConfidence - (staleSignals * 0.15), 0, 1);
    status = 'STALE';
  }

  if (conflictingSignals > 0) {
    nextConfidence = clamp(nextConfidence - (conflictingSignals * 0.25), 0, 1);
    if (status === 'PENDING_REVIEW') {
      status = 'INSUFFICIENT_DATA';
    }
  }

  if (snapshotAgeSeconds > maxDataAgeSeconds) {
    nextConfidence = clamp(nextConfidence - 0.25, 0, 1);
    status = 'STALE';
  }

  nextConfidence = clamp(nextConfidence * Math.max(0, freshness), 0, 1);

  if (status === 'PENDING_REVIEW' && nextConfidence < 0.6) {
    status = 'INSUFFICIENT_DATA';
  }

  return { status, confidence: nextConfidence };
}

export function createAiRiskAssessment(input: CreateAiRiskAssessmentInput): AiRiskAssessment {
  compareExposureWithCore(input.recommendedExposure, input.coreLimits);

  const maxDataAgeSeconds = input.maxDataAgeSeconds ?? 900;
  const snapshotAgeSeconds = getSnapshotAgeSeconds(input.snapshot, input.createdAt);

  const derived = deriveRecommendationStatus(
    input.evidence,
    input.confidence,
    input.freshness,
    snapshotAgeSeconds,
    maxDataAgeSeconds,
    input.recommendationStatus,
  );

  const evidence = input.evidence.map((signal) => ({
    ...signal,
    status: signal.status ?? 'valid',
  }));

  const provenance = computeProvenance(evidence);

  return {
    assessmentId: input.assessmentId,
    version: input.version ?? 1,
    createdAt: toIsoString(input.createdAt),
    snapshotReference: input.snapshotReference,
    snapshot: input.snapshot,
    severity: input.severity,
    confidence: Number(derived.confidence.toFixed(4)),
    freshness: clamp(input.freshness, 0, 1),
    status: derived.status,
    recommendedExposure: input.recommendedExposure,
    rationale: input.rationale,
    evidence,
    provenance,
    coreLimits: input.coreLimits,
    aiTransactionAuthority: {
      canSign: false,
      canExecute: false,
      canCreateRoles: false,
    },
    resultingCoreOperationReferences: [],
  };
}

export function buildCoreOperationPlan(recommendation: AiRiskAssessment): PolicyDecisionOperationReference[] {
  return [
    {
      kind: 'risk_policy_update',
      reference: `${recommendation.assessmentId}:risk_policy_update`,
      target: recommendation.snapshot.coreAddress,
      timelockRequired: true,
      riskIncreasing: true,
      status: 'PENDING',
    },
    {
      kind: 'protocol_approval',
      reference: `${recommendation.assessmentId}:protocol_approval`,
      target: recommendation.snapshot.coreAddress,
      timelockRequired: true,
      riskIncreasing: true,
      status: 'PENDING',
    },
    {
      kind: 'asset_approval',
      reference: `${recommendation.assessmentId}:asset_approval`,
      target: recommendation.snapshot.coreAddress,
      timelockRequired: true,
      riskIncreasing: true,
      status: 'PENDING',
    },
    {
      kind: 'strategy_approval',
      reference: `${recommendation.assessmentId}:strategy_approval`,
      target: recommendation.snapshot.coreAddress,
      timelockRequired: true,
      riskIncreasing: true,
      status: 'PENDING',
    },
  ];
}

export function createAdminDecision(input: CreateAdminDecisionInput): AdminDecision {
  const finalRecommendation = input.recommendation;

  if (input.decision === 'APPROVED') {
    if (!input.finalPolicyValues) {
      throw new Error('Approved admin decisions must include final policy values.');
    }
    compareExposureWithCore(input.finalPolicyValues, finalRecommendation.coreLimits);
    if (input.finalPolicyValues.maximumTotalDeployed > finalRecommendation.recommendedExposure.maximumTotalDeployed) {
      throw new Error('Admin-approved policy values cannot exceed the AI recommendation or Core limits.');
    }
  }

  const decisionId = `${finalRecommendation.assessmentId}:admin:${input.decision.toLowerCase()}`;
  const operationReferences = input.decision === 'APPROVED' ? buildCoreOperationPlan(finalRecommendation) : [];

  const auditTrail: AdminDecisionAuditEntry[] = [
    {
      provenance: 'AI_INFERENCE',
      reference: finalRecommendation.assessmentId,
      note: 'Recommendation created from monitoring signals and risk evidence.',
    },
    {
      provenance: 'ADMIN_INPUT',
      reference: decisionId,
      note: `${input.decision} by ${input.decidedBy}`,
    },
  ];

  return {
    decisionId,
    recommendationId: finalRecommendation.assessmentId,
    decision: input.decision,
    decidedBy: input.decidedBy,
    decidedAt: toIsoString(input.decidedAt),
    finalPolicyValues: input.decision === 'APPROVED' ? input.finalPolicyValues : undefined,
    rationale: input.rationale,
    notes: input.notes,
    auditTrail,
    resultingCoreOperationReferences: operationReferences,
  };
}

/**
 * Boundary for a future Admin-approval route. This is intentionally separate
 * from AI recommendation creation: callers must first authenticate a wallet
 * and verify POLICY_ADMIN_ROLE against the current Arc Mainnet Core.
 */
export function createAuthenticatedAdminDecision(
  input: CreateAdminDecisionInput,
  approval: AuthenticatedAdminApprovalContext,
): AdminDecision {
  if (approval.chainId !== ARC_MAINNET_EXECUTION_CONFIG.chainId) {
    throw new Error('Admin approval requires Arc Mainnet chainId 5042.');
  }
  if (!approval.policyAdminRoleVerified) {
    throw new Error('POLICY_ADMIN_ROLE is required for an Admin approval.');
  }
  if (!isAddress(approval.authenticatedWalletAddress)) {
    throw new Error('Authenticated Admin wallet address is invalid.');
  }
  if (input.decidedBy.toLowerCase() !== approval.authenticatedWalletAddress.toLowerCase()) {
    throw new Error('Admin decision identity must match the authenticated wallet.');
  }
  return createAdminDecision(input);
}

export interface CoreExecutionContext {
  coreAddress: `0x${string}`;
  chainId: number;
  protocolId: `0x${string}`;
  usdcAddress: `0x${string}`;
  strategyAdapter: `0x${string}`;
  minimumLiquidReserve?: bigint;
}

export interface CoreExecutionPlan {
  operationType: PolicyOperationKind;
  coreContract: string;
  chainId: number;
  functionName: string;
  calldata: string;
  parameters: Record<string, string | number | bigint | boolean | null>;
  adminDecisionId: string;
  recommendationId: string;
  timelockRequired: boolean;
  validationStatus: 'VALID' | 'INVALID';
  executionAuthority: {
    canSign: false;
    canExecute: false;
    canCreateRoles: false;
  };
}

export interface PolicyDecisionService {
  createAiRiskAssessment(input: CreateAiRiskAssessmentInput): AiRiskAssessment;
  createAdminDecision(input: CreateAdminDecisionInput): AdminDecision;
  buildCoreOperationPlan(recommendation: AiRiskAssessment): PolicyDecisionOperationReference[];
  buildApprovedCoreExecutionPlan(decision: AdminDecision, context: CoreExecutionContext): CoreExecutionPlan[];
}

function assertApprovedAdminDecision(decision: AdminDecision): void {
  if (decision.decision !== ADMIN_DECISION_APPROVED) {
    throw new Error('Execution plan generation requires an APPROVED Admin decision.');
  }
  if (!decision.finalPolicyValues) {
    throw new Error('Approved Admin decisions require required policy values and cap values.');
  }
  if (!decision.auditTrail.some((entry) => entry.provenance === 'AI_INFERENCE' || entry.provenance === 'ADMIN_INPUT')) {
    throw new Error('Recommendation provenance is missing from the Admin decision record.');
  }
}

function assertValidCoreExecutionContext(context: CoreExecutionContext): void {
  const verifiedCore = ARC_MAINNET_EXECUTION_CONFIG.coreAddress;
  const verifiedUsdc = ARC_MAINNET_EXECUTION_CONFIG.usdcAddress;
  const expectedProtocolId = ARC_MAINNET_EXECUTION_CONFIG.protocolId;
  const expectedChainId = ARC_MAINNET_EXECUTION_CONFIG.chainId;

  if (!isAddress(context.coreAddress)) {
    throw new Error('Core address must be a valid EVM address.');
  }
  if (context.coreAddress.toLowerCase() !== verifiedCore.toLowerCase()) {
    throw new Error('Core address does not match the verified Arc Mainnet Core.');
  }
  if (!isAddress(context.usdcAddress)) {
    throw new Error('USDC address must be a valid EVM address.');
  }
  if (context.usdcAddress.toLowerCase() !== verifiedUsdc.toLowerCase()) {
    throw new Error('USDC address does not match the verified Arc Mainnet USDC.');
  }
  if (context.chainId !== expectedChainId) {
    throw new Error('Execution plan requires Arc Mainnet chainId 5042.');
  }
  if (!isHex(context.protocolId) || context.protocolId.length !== 66) {
    throw new Error('Protocol ID must be a valid 32-byte hex value.');
  }
  if (context.protocolId.toLowerCase() !== expectedProtocolId.toLowerCase()) {
    throw new Error('Protocol ID does not match the verified deployed protocol.');
  }
  if (!isAddress(context.strategyAdapter)) {
    throw new Error('Strategy adapter address must be a valid EVM address.');
  }
  if (context.strategyAdapter.toLowerCase() !== ARC_MAINNET_EXECUTION_CONFIG.steakhouseAdapterAddress.toLowerCase()) {
    throw new Error('Strategy adapter address does not match the verified deployed adapter.');
  }
}

function assertExplicitPolicyValues(policyValues: RecommendedExposure): void {
  if (policyValues.maximumTotalDeployed === undefined || policyValues.maximumTotalDeployed === null) {
    throw new Error('Approved Admin decisions require required policy cap values.');
  }
  if (policyValues.minimumLiquidReserve === undefined || policyValues.minimumLiquidReserve === null) {
    throw new Error('Approved Admin decisions require a minimumLiquidReserve value for the risk policy update.');
  }
  if (typeof policyValues.minimumLiquidReserveBps !== 'number' || policyValues.minimumLiquidReserveBps < 0 || policyValues.minimumLiquidReserveBps > 10_000) {
    throw new Error('Approved Admin decisions require a valid minimumLiquidReserveBps value between 0 and 10000.');
  }
  if (policyValues.maximumTotalDeployed < 0n) {
    throw new Error('Approved Admin decisions require a non-negative maximumTotalDeployed value.');
  }
}

function normalizeUint256(value: bigint | number | string | undefined, field: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') {
    const normalized = value.trim().replace(/_/g, '');
    if (!normalized) {
      throw new Error(`Missing ${field} value.`);
    }
    if (!/^(0x)?[0-9]+$/i.test(normalized)) {
      throw new Error(`Invalid ${field} value: ${value}`);
    }
    return BigInt(normalized);
  }
  throw new Error(`Missing ${field} value.`);
}

function normalizeUint16(value: bigint | number | string | undefined, field: string): number {
  const normalized = normalizeUint256(value, field);
  if (normalized > 65_535n) {
    throw new Error(`${field} exceeds uint16 range.`);
  }
  return Number(normalized);
}

type PolicyOperationArgs = {
  minimumLiquidReserve: bigint;
  minimumLiquidReserveBps: number;
  maximumTotalDeployed: bigint;
  protocolId: `0x${string}`;
  asset: `0x${string}`;
  strategy: `0x${string}`;
};

function toPolicyOperationArgs(policyValues: RecommendedExposure, context: CoreExecutionContext): PolicyOperationArgs {
  return {
    minimumLiquidReserve: normalizeUint256(policyValues.minimumLiquidReserve ?? context.minimumLiquidReserve ?? 0n, 'minimumLiquidReserve'),
    minimumLiquidReserveBps: normalizeUint16(policyValues.minimumLiquidReserveBps, 'minimumLiquidReserveBps'),
    maximumTotalDeployed: normalizeUint256(policyValues.maximumTotalDeployed, 'maximumTotalDeployed'),
    protocolId: context.protocolId,
    asset: context.usdcAddress,
    strategy: context.strategyAdapter,
  };
}

export function buildApprovedCoreExecutionPlan(decision: AdminDecision, context: CoreExecutionContext): CoreExecutionPlan[] {
  assertApprovedAdminDecision(decision);
  assertValidCoreExecutionContext(context);
  assertExplicitPolicyValues(decision.finalPolicyValues!);

  const finalValues = decision.finalPolicyValues!;
  const policyArgs = toPolicyOperationArgs(finalValues, context);

  const operations: CoreExecutionPlan[] = [
    {
      operationType: 'risk_policy_update',
      coreContract: context.coreAddress,
      chainId: context.chainId,
      functionName: 'scheduleRiskPolicy',
      calldata: encodeFunctionData({
        abi: [{
          name: 'scheduleRiskPolicy',
          type: 'function',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'minimumLiquidReserve', type: 'uint256' },
            { name: 'minimumLiquidReserveBps', type: 'uint16' },
            { name: 'maximumTotalDeployed', type: 'uint256' },
          ],
          outputs: [{ name: 'operationId', type: 'bytes32' }],
        }],
        functionName: 'scheduleRiskPolicy',
        args: [
          BigInt(policyArgs.minimumLiquidReserve),
          Number(policyArgs.minimumLiquidReserveBps),
          BigInt(policyArgs.maximumTotalDeployed),
        ],
      }),
      parameters: {
        minimumLiquidReserve: policyArgs.minimumLiquidReserve,
        minimumLiquidReserveBps: policyArgs.minimumLiquidReserveBps,
        maximumTotalDeployed: policyArgs.maximumTotalDeployed,
      },
      adminDecisionId: decision.decisionId,
      recommendationId: decision.recommendationId,
      timelockRequired: true,
      validationStatus: 'VALID',
      executionAuthority: {
        canSign: false,
        canExecute: false,
        canCreateRoles: false,
      },
    },
    {
      operationType: 'protocol_approval',
      coreContract: context.coreAddress,
      chainId: context.chainId,
      functionName: 'scheduleProtocolApproval',
      calldata: encodeFunctionData({
        abi: [{
          name: 'scheduleProtocolApproval',
          type: 'function',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'protocol', type: 'bytes32' },
            { name: 'absoluteCap', type: 'uint256' },
            { name: 'relativeCapBps', type: 'uint16' },
          ],
          outputs: [{ name: 'operationId', type: 'bytes32' }],
        }],
        functionName: 'scheduleProtocolApproval',
        args: [
          context.protocolId,
          BigInt(policyArgs.maximumTotalDeployed),
          Number(policyArgs.minimumLiquidReserveBps),
        ],
      }),
      parameters: {
        protocol: context.protocolId,
        absoluteCap: policyArgs.maximumTotalDeployed,
        relativeCapBps: policyArgs.minimumLiquidReserveBps,
      },
      adminDecisionId: decision.decisionId,
      recommendationId: decision.recommendationId,
      timelockRequired: true,
      validationStatus: 'VALID',
      executionAuthority: {
        canSign: false,
        canExecute: false,
        canCreateRoles: false,
      },
    },
    {
      operationType: 'asset_approval',
      coreContract: context.coreAddress,
      chainId: context.chainId,
      functionName: 'scheduleAssetApproval',
      calldata: encodeFunctionData({
        abi: [{
          name: 'scheduleAssetApproval',
          type: 'function',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'asset', type: 'address' },
            { name: 'absoluteCap', type: 'uint256' },
            { name: 'relativeCapBps', type: 'uint16' },
          ],
          outputs: [{ name: 'operationId', type: 'bytes32' }],
        }],
        functionName: 'scheduleAssetApproval',
        args: [
          context.usdcAddress,
          BigInt(policyArgs.maximumTotalDeployed),
          Number(policyArgs.minimumLiquidReserveBps),
        ],
      }),
      parameters: {
        asset: context.usdcAddress,
        absoluteCap: policyArgs.maximumTotalDeployed,
        relativeCapBps: policyArgs.minimumLiquidReserveBps,
      },
      adminDecisionId: decision.decisionId,
      recommendationId: decision.recommendationId,
      timelockRequired: true,
      validationStatus: 'VALID',
      executionAuthority: {
        canSign: false,
        canExecute: false,
        canCreateRoles: false,
      },
    },
    {
      operationType: 'strategy_approval',
      coreContract: context.coreAddress,
      chainId: context.chainId,
      functionName: 'scheduleStrategyApproval',
      calldata: encodeFunctionData({
        abi: [{
          name: 'scheduleStrategyApproval',
          type: 'function',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'strategy', type: 'address' },
            { name: 'protocol', type: 'bytes32' },
            { name: 'asset', type: 'address' },
            { name: 'absoluteCap', type: 'uint256' },
            { name: 'relativeCapBps', type: 'uint16' },
          ],
          outputs: [{ name: 'operationId', type: 'bytes32' }],
        }],
        functionName: 'scheduleStrategyApproval',
        args: [
          context.strategyAdapter,
          context.protocolId,
          context.usdcAddress,
          BigInt(policyArgs.maximumTotalDeployed),
          Number(policyArgs.minimumLiquidReserveBps),
        ],
      }),
      parameters: {
        strategy: context.strategyAdapter,
        protocol: context.protocolId,
        asset: context.usdcAddress,
        absoluteCap: policyArgs.maximumTotalDeployed,
        relativeCapBps: policyArgs.minimumLiquidReserveBps,
      },
      adminDecisionId: decision.decisionId,
      recommendationId: decision.recommendationId,
      timelockRequired: true,
      validationStatus: 'VALID',
      executionAuthority: {
        canSign: false,
        canExecute: false,
        canCreateRoles: false,
      },
    },
  ];

  return operations;
}

export type AuthorizedCoreRole = 'POLICY_ADMIN_ROLE' | 'TIMELOCK_EXECUTOR_ROLE';

export const CORE_SCHEDULE_ROLE_BY_OPERATION: Record<PolicyOperationKind, AuthorizedCoreRole> = {
  risk_policy_update: 'POLICY_ADMIN_ROLE',
  protocol_approval: 'POLICY_ADMIN_ROLE',
  asset_approval: 'POLICY_ADMIN_ROLE',
  strategy_approval: 'POLICY_ADMIN_ROLE',
};

export interface AuthorizedCoreSigner {
  authorizedAddress: `0x${string}`;
  role: AuthorizedCoreRole;
  canSign: boolean;
}

export interface AuthorizedCoreTransactionRequest {
  operationType: PolicyOperationKind;
  coreContract: string;
  chainId: number;
  functionName: string;
  calldata: string;
  value: bigint;
  signerRole: AuthorizedCoreRole;
  requiredSignerRole: AuthorizedCoreRole;
  authorizationStatus: 'AUTHORIZED' | 'REJECTED';
  submittedBy: string;
  adminDecisionId: string;
  recommendationId: string;
  /** Hash of the prepared payload, not a blockchain transaction hash. */
  preparedPayloadHash: string;
  operationId: string;
  timestamp: string;
  dryRun: boolean;
  status: 'DRY_RUN' | 'PREPARED';
  executionStatus: 'NOT_EXECUTED';
  timelockRequired: boolean;
  transaction: {
    target: string;
    functionName: string;
    calldata: string;
    value: bigint;
  };
}

export interface PreparedCoreTransactionRequest {
  operationType: PolicyOperationKind;
  role: AuthorizedCoreRole;
  requiredRole: AuthorizedCoreRole;
  target: `0x${string}`;
  functionName: string;
  calldata: string;
  value: bigint;
  operationId: string;
  timelockRequired: boolean;
  delaySeconds: number;
  readyAt?: string;
  status: 'READY' | 'BLOCKED';
}

export interface AuthorizedCoreExecutionService {
  dryRunExecution(decision: AdminDecision, executionPlan: CoreExecutionPlan[], signer: AuthorizedCoreSigner): AuthorizedCoreTransactionRequest[];
  submitExecution(decision: AdminDecision, executionPlan: CoreExecutionPlan[], signer: AuthorizedCoreSigner): AuthorizedCoreTransactionRequest[];
  prepareScheduleTransactions(decision: AdminDecision, executionPlan: CoreExecutionPlan[], signer: AuthorizedCoreSigner): PreparedCoreTransactionRequest[];
  prepareExecuteTransactions(decision: AdminDecision, executionPlan: CoreExecutionPlan[], signer: AuthorizedCoreSigner, nowMs?: number): PreparedCoreTransactionRequest[];
}

function hashExecutionPayload(decision: AdminDecision, operation: CoreExecutionPlan): string {
  const payload = `${decision.decisionId}:${operation.operationType}:${operation.calldata}`;
  return keccak256(toHex(new TextEncoder().encode(payload)));
}

function validateApprovedExecutionPlan(decision: AdminDecision, executionPlan: CoreExecutionPlan[], context: CoreExecutionContext): void {
  assertApprovedAdminDecision(decision);
  assertValidCoreExecutionContext(context);

  const expectedPlan = buildApprovedCoreExecutionPlan(decision, context);
  if (executionPlan.length !== expectedPlan.length) {
    throw new Error('Execution plan length does not match the approved Core schedule plan.');
  }

  const expectedByType = new Map(expectedPlan.map((op) => [op.operationType, op]));

  for (const operation of executionPlan) {
    if (operation.validationStatus !== 'VALID') {
      throw new Error(`Execution plan operation ${operation.operationType} is invalid and cannot be submitted.`);
    }
    if (operation.chainId !== context.chainId) {
      throw new Error(`Execution plan for ${operation.operationType} is not on Arc Mainnet chain 5042.`);
    }
    if (operation.coreContract.toLowerCase() !== context.coreAddress.toLowerCase()) {
      throw new Error(`Execution plan for ${operation.operationType} points at the wrong Core contract.`);
    }
    if (!expectedByType.has(operation.operationType)) {
      throw new Error(`Unsupported execution plan operation type: ${operation.operationType}`);
    }
    const expected = expectedByType.get(operation.operationType)!;
    if (operation.calldata !== expected.calldata) {
      throw new Error(`Execution calldata mismatch for ${operation.operationType}.`);
    }
    if (operation.functionName !== expected.functionName) {
      throw new Error(`Execution function mismatch for ${operation.operationType}.`);
    }
    if (!operation.timelockRequired) {
      throw new Error(`Operation ${operation.operationType} is not marked timelock-required.`);
    }
    if (operation.coreContract.toLowerCase() !== ARC_MAINNET_EXECUTION_CONFIG.coreAddress.toLowerCase()) {
      throw new Error('Execution request targets the wrong Core address.');
    }
  }
}

export function createAuthorizedCoreExecutionService(): AuthorizedCoreExecutionService {
  const submittedByOperation = new Map<string, string>();

  const getExecutionContext = (executionPlan: CoreExecutionPlan[]): CoreExecutionContext => ({
    coreAddress: executionPlan[0]?.coreContract as `0x${string}`,
    chainId: executionPlan[0]?.chainId ?? ARC_MAINNET_EXECUTION_CONFIG.chainId,
    protocolId: ARC_MAINNET_EXECUTION_CONFIG.protocolId as `0x${string}`,
    usdcAddress: ARC_MAINNET_EXECUTION_CONFIG.usdcAddress as `0x${string}`,
    strategyAdapter: ARC_MAINNET_EXECUTION_CONFIG.steakhouseAdapterAddress as `0x${string}`,
  });

  const buildRequest = (
    decision: AdminDecision,
    operation: CoreExecutionPlan,
    signer: AuthorizedCoreSigner,
    dryRun: boolean,
  ): AuthorizedCoreTransactionRequest => {
    const requiredSignerRole = CORE_SCHEDULE_ROLE_BY_OPERATION[operation.operationType];

    if (decision.decision !== ADMIN_DECISION_APPROVED) {
      throw new Error('Core execution requires an APPROVED Admin decision. AI recommendations are not executable.');
    }
    if (!signer.canSign) {
      throw new Error('Signer is not authorized to sign the Core schedule transaction.');
    }
    if (signer.role !== requiredSignerRole) {
      throw new Error(`Unauthorized signer role for ${operation.operationType}: required ${requiredSignerRole}.`);
    }

    const preparedPayloadHash = hashExecutionPayload(decision, operation);
    const submittedBy = signer.authorizedAddress;
    const timestamp = new Date().toISOString();
    const operationId = hashExecutionPayload(
      { ...decision, decisionId: `${decision.decisionId}:${operation.operationType}` } as AdminDecision,
      { ...operation, operationType: operation.operationType },
    );

    return {
      operationType: operation.operationType,
      coreContract: operation.coreContract,
      chainId: operation.chainId,
      functionName: operation.functionName,
      calldata: operation.calldata,
      value: 0n,
      signerRole: signer.role,
      requiredSignerRole: requiredSignerRole,
      authorizationStatus: 'AUTHORIZED',
      submittedBy,
      adminDecisionId: decision.decisionId,
      recommendationId: decision.recommendationId,
      preparedPayloadHash,
      operationId,
      timestamp,
      dryRun,
      status: dryRun ? 'DRY_RUN' : 'PREPARED',
      executionStatus: 'NOT_EXECUTED',
      timelockRequired: operation.timelockRequired,
      transaction: {
        target: operation.coreContract,
        functionName: operation.functionName,
        calldata: operation.calldata,
        value: 0n,
      },
    };
  };

  return {
    dryRunExecution(decision, executionPlan, signer) {
      const context = getExecutionContext(executionPlan);
      validateApprovedExecutionPlan(decision, executionPlan, context);

      return executionPlan.map((operation) => buildRequest(decision, operation, signer, true));
    },

    submitExecution(decision, executionPlan, signer) {
      const context = getExecutionContext(executionPlan);
      validateApprovedExecutionPlan(decision, executionPlan, context);

      const requests = executionPlan.map((operation) => {
        const key = `${decision.decisionId}:${operation.operationType}`;
        if (submittedByOperation.has(key)) {
          throw new Error(`Duplicate execution request blocked for ${key}.`);
        }

        const request = buildRequest(decision, operation, signer, false);
        // This service does not sign or broadcast. The marker only prevents a
        // duplicate local preparation from being mistaken for another candidate.
        submittedByOperation.set(key, request.preparedPayloadHash);
        return request;
      });

      return requests;
    },

    prepareScheduleTransactions(decision, executionPlan, signer) {
      const context = getExecutionContext(executionPlan);
      validateApprovedExecutionPlan(decision, executionPlan, context);

      if (!signer.canSign) {
        throw new Error('Signer is not authorized to prepare Core schedule transactions.');
      }
      if (signer.role !== 'POLICY_ADMIN_ROLE') {
        throw new Error('Schedule preparation requires the POLICY_ADMIN_ROLE signer.');
      }

      return executionPlan.map((operation) => {
        if (!operation.functionName.startsWith('schedule')) {
          throw new Error(`Operation ${operation.operationType} is not a schedule-prep transaction.`);
        }

        return {
          operationType: operation.operationType,
          role: signer.role,
          requiredRole: 'POLICY_ADMIN_ROLE',
          target: operation.coreContract as `0x${string}`,
          functionName: operation.functionName,
          calldata: operation.calldata,
          value: 0n,
          operationId: hashExecutionPayload(decision, operation),
          timelockRequired: operation.timelockRequired,
          delaySeconds: 2 * 24 * 60 * 60,
          status: 'READY',
        } satisfies PreparedCoreTransactionRequest;
      });
    },

    prepareExecuteTransactions(decision, executionPlan, signer, _nowMs = Date.now()) {
      const context = getExecutionContext(executionPlan);
      validateApprovedExecutionPlan(decision, executionPlan, context);

      if (!signer.canSign) {
        throw new Error('Signer is not authorized to prepare Core execute transactions.');
      }
      if (signer.role !== 'TIMELOCK_EXECUTOR_ROLE') {
        throw new Error('Execution preparation requires the TIMELOCK_EXECUTOR_ROLE signer.');
      }

      // A local decision timestamp is not evidence that Core scheduled an
      // operation or that its ETA elapsed. Prompt 6 established that live
      // timelock state is not served, so execution preparation must fail closed.
      throw new Error('Live Core timelock state is unavailable; execute transactions cannot be prepared or treated as ready.');
    },
  };
}

export function getPolicyDecisionService(): PolicyDecisionService {
  return {
    createAiRiskAssessment,
    createAdminDecision,
    buildCoreOperationPlan,
    buildApprovedCoreExecutionPlan,
  };
}
