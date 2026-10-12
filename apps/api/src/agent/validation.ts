import { isAddress } from 'viem';
import { z } from 'zod';

import { ARC_MAINNET_EXECUTION_CONFIG } from '../config/arc-mainnet.js';
import {
  createAiRecommendation,
  type AiRecommendation,
  type AiRecommendationAction,
  type RiskSeverity,
} from '../policy/index.js';
import type { UntrustedRecommendationPayload } from './types.js';

export const ALLOWED_AI_RECOMMENDATION_ACTIONS = [
  'ALLOCATE_TO_APPROVED_STRATEGY',
  'DEALLOCATE_FROM_APPROVED_STRATEGY',
  'REDUCE_EXPOSURE',
  'REBALANCE',
  'SCHEDULE_RISK_POLICY_CHANGE',
  'EMERGENCY_RESPONSE',
] as const;

export const untrustedRecommendationPayloadSchema = z.object({
  recommendationId: z.string().min(1, 'recommendationId is required.'),
  actionType: z.enum(ALLOWED_AI_RECOMMENDATION_ACTIONS, {
    errorMap: () => ({ message: 'Unsupported or unauthorized recommendation action.' }),
  }),
  target: z.string().refine((val): val is `0x${string}` => isAddress(val), {
    message: 'target must be a valid EVM address.',
  }),
  requestedAmount: z
    .union([z.string(), z.number(), z.bigint()])
    .nullable()
    .optional(),
  asset: z
    .string()
    .refine((val): val is `0x${string}` => isAddress(val), {
      message: 'asset must be a valid EVM address when provided.',
    })
    .nullable()
    .optional(),
  protocol: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, 'protocol must be a 32-byte hex string when provided.')
    .nullable()
    .optional(),
  strategy: z
    .string()
    .refine((val): val is `0x${string}` => isAddress(val), {
      message: 'strategy must be a valid EVM address when provided.',
    })
    .nullable()
    .optional(),
  rationale: z
    .array(z.string().min(1, 'rationale entry cannot be blank.'))
    .min(1, 'AI recommendations require non-empty rationale.'),
  evidenceReferences: z.array(z.string()).default([]),
  expectedEffect: z.string().min(1, 'expectedEffect is required.'),
  riskClassification: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const),
  requiredApproval: z.enum(['ADMIN', 'ADMIN_AND_TIMELOCK', 'EMERGENCY_AUTHORITY'] as const),
});

export interface ValidateUntrustedOutputOptions {
  readonly requiredAuthoritativeData?: readonly { readonly field: string; readonly available: boolean }[];
  readonly createdAt?: Date | string | number;
}

export function validateUntrustedAiRecommendation(
  untrustedOutput: unknown,
  options: ValidateUntrustedOutputOptions = {},
): AiRecommendation {
  if (untrustedOutput === null || typeof untrustedOutput !== 'object') {
    throw new Error('Untrusted AI output must be an object.');
  }

  // Reject any payload attempting to inject execution or authority fields
  const forbiddenKeys = [
    'signature',
    'signatures',
    'privateKey',
    'txHash',
    'transactionHash',
    'hash',
    'calldata',
    'signer',
    'canSign',
    'canExecute',
    'executionStatus',
    'actor',
  ];
  for (const key of forbiddenKeys) {
    if (key in (untrustedOutput as Record<string, unknown>)) {
      const val = (untrustedOutput as Record<string, unknown>)[key];
      if (val !== undefined && val !== null && val !== false && val !== 'NOT_EXECUTABLE' && val !== 'AI') {
        throw new Error(`Untrusted AI output cannot contain forbidden field: ${key}.`);
      }
    }
  }

  const parsed = untrustedRecommendationPayloadSchema.parse(untrustedOutput);

  // Normalize requestedAmount to bigint | null without fabricating zero
  let normalizedAmount: bigint | null = null;
  if (parsed.requestedAmount !== undefined && parsed.requestedAmount !== null) {
    if (typeof parsed.requestedAmount === 'bigint') {
      normalizedAmount = parsed.requestedAmount;
    } else if (typeof parsed.requestedAmount === 'number') {
      if (!Number.isFinite(parsed.requestedAmount) || parsed.requestedAmount < 0) {
        throw new Error('requestedAmount must be non-negative.');
      }
      normalizedAmount = BigInt(Math.floor(parsed.requestedAmount));
    } else if (typeof parsed.requestedAmount === 'string') {
      const trimmed = parsed.requestedAmount.trim().replace(/_/g, '');
      if (trimmed === '' || trimmed === 'null' || trimmed === 'UNAVAILABLE') {
        normalizedAmount = null;
      } else {
        try {
          normalizedAmount = BigInt(trimmed);
        } catch {
          throw new Error(`Invalid requestedAmount value: ${parsed.requestedAmount}.`);
        }
      }
    }
  }

  if (normalizedAmount !== null && normalizedAmount < 0n) {
    throw new Error('requestedAmount must be non-negative when supplied.');
  }

  // Target check against configured Arc Mainnet Core
  if (parsed.target.toLowerCase() !== ARC_MAINNET_EXECUTION_CONFIG.coreAddress.toLowerCase()) {
    throw new Error('AI recommendations may target only the configured VeloxTreasuryCore.');
  }

  // Create recommendation through the authoritative Velox Policy engine
  return createAiRecommendation({
    recommendationId: parsed.recommendationId,
    createdAt: options.createdAt ?? new Date(),
    actionType: parsed.actionType as AiRecommendationAction,
    target: parsed.target as `0x${string}`,
    requestedAmount: normalizedAmount,
    asset: (parsed.asset as `0x${string}`) ?? null,
    protocol: (parsed.protocol as `0x${string}`) ?? null,
    strategy: (parsed.strategy as `0x${string}`) ?? null,
    rationale: parsed.rationale,
    evidenceReferences: parsed.evidenceReferences,
    expectedEffect: parsed.expectedEffect,
    riskClassification: parsed.riskClassification as RiskSeverity,
    requiredApproval: parsed.requiredApproval,
    requiredAuthoritativeData: options.requiredAuthoritativeData,
  });
}
