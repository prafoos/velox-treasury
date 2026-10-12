import {
  bigint,
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export type AdminDecisionStatus = 'APPROVED' | 'REJECTED';

export interface AdminDecisionAuditEntry {
  readonly provenance: string;
  readonly reference: string;
  readonly note: string;
}

export const eventLog = pgTable('event_log', {
  id: serial('id').primaryKey(),
  chainId: bigint('chain_id', { mode: 'bigint' }).notNull(),
  contractAddress: varchar('contract_address', { length: 42 }).notNull(),
  txHash: varchar('tx_hash', { length: 66 }).notNull(),
  blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
  blockTimestamp: bigint('block_timestamp', { mode: 'bigint' }).notNull(),
  logIndex: bigint('log_index', { mode: 'bigint' }).notNull(),
  eventName: varchar('event_name', { length: 128 }).notNull(),
  decodedData: jsonb('decoded_data').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueEvent: unique().on(table.chainId, table.contractAddress, table.txHash, table.logIndex),
}));

export const indexerState = pgTable('indexer_state', {
  id: serial('id').primaryKey(),
  chainId: bigint('chain_id', { mode: 'bigint' }).notNull(),
  contractAddress: varchar('contract_address', { length: 42 }).notNull(),
  lastProcessedBlock: bigint('last_processed_block', { mode: 'bigint' }).notNull(),
  finalizedBlock: bigint('finalized_block', { mode: 'bigint' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const userLedger = pgTable('user_ledger', {
  id: serial('id').primaryKey(),
  userAddress: varchar('user_address', { length: 42 }).notNull(),
  eventType: varchar('event_type', { length: 32 }).notNull(),
  txHash: varchar('tx_hash', { length: 66 }).notNull(),
  blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
  blockTimestamp: bigint('block_timestamp', { mode: 'bigint' }).notNull(),
  logIndex: bigint('log_index', { mode: 'bigint' }).notNull(),
  depositAmount: bigint('deposit_amount', { mode: 'bigint' }),
  withdrawalAmount: bigint('withdrawal_amount', { mode: 'bigint' }),
  userUnits: bigint('user_units', { mode: 'bigint' }),
  totalUserUnits: bigint('total_user_units', { mode: 'bigint' }),
  userNav: bigint('user_nav', { mode: 'bigint' }),
  realizedYield: bigint('realized_yield', { mode: 'bigint' }),
  realizedLoss: bigint('realized_loss', { mode: 'bigint' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const strategyLedger = pgTable('strategy_ledger', {
  id: serial('id').primaryKey(),
  strategyAddress: varchar('strategy_address', { length: 42 }).notNull(),
  protocolId: varchar('protocol_address', { length: 66 }).notNull(),
  assetAddress: varchar('asset_address', { length: 42 }).notNull(),
  approved: boolean('approved'),
  enabled: boolean('enabled'),
  absoluteCap: bigint('absolute_cap', { mode: 'bigint' }),
  relativeCapBps: bigint('relative_cap_bps', { mode: 'bigint' }),
  eventType: varchar('event_type', { length: 32 }).notNull(),
  txHash: varchar('tx_hash', { length: 66 }).notNull(),
  blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
  blockTimestamp: bigint('block_timestamp', { mode: 'bigint' }).notNull(),
  logIndex: bigint('log_index', { mode: 'bigint' }).notNull(),
  principal: bigint('principal', { mode: 'bigint' }),
  shares: bigint('shares', { mode: 'bigint' }),
  currentValue: bigint('current_value', { mode: 'bigint' }),
  realizedYield: bigint('realized_yield', { mode: 'bigint' }),
  realizedLoss: bigint('realized_loss', { mode: 'bigint' }),
  feesAccrued: bigint('fees_accrued', { mode: 'bigint' }),
  withdrawalShortfall: bigint('withdrawal_shortfall', { mode: 'bigint' }),
  valuationSource: varchar('valuation_source', { length: 42 }),
  valuationStatus: varchar('valuation_status', { length: 32 }),
  valuationBlock: bigint('valuation_block', { mode: 'bigint' }),
  totalDeployed: bigint('total_deployed', { mode: 'bigint' }),
  protocolExposure: bigint('protocol_exposure', { mode: 'bigint' }),
  assetExposure: bigint('asset_exposure', { mode: 'bigint' }),
});

export const adminDecisions = pgTable('admin_decisions', {
  decisionId: varchar('decision_id', { length: 255 }).primaryKey(),
  assessmentId: varchar('assessment_id', { length: 255 }),
  decision: varchar('decision', { length: 8 }).$type<AdminDecisionStatus>().notNull(),
  decidedBy: text('decided_by').notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
  maximumTotalDeployed: bigint('maximum_total_deployed', { mode: 'bigint' }),
  minimumLiquidReserveBps: integer('minimum_liquid_reserve_bps'),
  rationale: text('rationale').notNull(),
  auditTrail: jsonb('audit_trail').$type<AdminDecisionAuditEntry[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  decisionStatusCheck: check('admin_decisions_decision_check', sql`${table.decision} in ('APPROVED', 'REJECTED')`),
  reserveBpsCheck: check('admin_decisions_reserve_bps_check', sql`${table.minimumLiquidReserveBps} is null or (${table.minimumLiquidReserveBps} between 0 and 10000)`),
  approvedPolicyValuesCheck: check(
    'admin_decisions_approved_policy_values_check',
    sql`${table.decision} <> 'APPROVED' or (${table.maximumTotalDeployed} is not null and ${table.minimumLiquidReserveBps} is not null)`,
  ),
}));

export const walletAuthChallenges = pgTable('wallet_auth_challenges', {
  nonce: varchar('nonce', { length: 64 }).primaryKey(),
  walletAddress: varchar('wallet_address', { length: 42 }).notNull(),
  message: text('message').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
});

export const adminBucketPolicyRecommendations = pgTable('admin_bucket_policy_recommendations', {
  chainId: bigint('chain_id', { mode: 'bigint' }).notNull(),
  adminWallet: varchar('admin_wallet', { length: 42 }).notNull(),
  suggestion: jsonb('suggestion').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  activeRecommendation: unique().on(table.chainId, table.adminWallet),
}));

export const strategyAutomationTriggers = pgTable('strategy_automation_triggers', {
  chainId: integer('chain_id').notNull(),
  depositTransactionHash: varchar('deposit_transaction_hash', { length: 66 }).notNull(),
  status: varchar('status', { length: 16 }).$type<'STARTED' | 'COMPLETED' | 'FAILED'>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (table) => ({
  uniqueDepositTrigger: unique().on(table.chainId, table.depositTransactionHash),
  validStatus: check('strategy_automation_triggers_status_check', sql`${table.status} in ('STARTED', 'COMPLETED', 'FAILED')`),
}));
