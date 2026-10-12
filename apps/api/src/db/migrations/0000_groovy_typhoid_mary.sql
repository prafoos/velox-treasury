CREATE TABLE IF NOT EXISTS "admin_decisions" (
	"decision_id" varchar(255) PRIMARY KEY NOT NULL,
	"assessment_id" varchar(255),
	"decision" varchar(8) NOT NULL,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"maximum_total_deployed" bigint,
	"minimum_liquid_reserve_bps" integer,
	"rationale" text NOT NULL,
	"audit_trail" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_decisions_decision_check" CHECK ("decision" in ('APPROVED', 'REJECTED')),
	CONSTRAINT "admin_decisions_reserve_bps_check" CHECK ("minimum_liquid_reserve_bps" is null or ("minimum_liquid_reserve_bps" between 0 and 10000)),
	CONSTRAINT "admin_decisions_approved_policy_values_check" CHECK ("decision" <> 'APPROVED' or ("maximum_total_deployed" is not null and "minimum_liquid_reserve_bps" is not null))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" bigint NOT NULL,
	"contract_address" varchar(42) NOT NULL,
	"tx_hash" varchar(66) NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" bigint NOT NULL,
	"log_index" bigint NOT NULL,
	"event_name" varchar(128) NOT NULL,
	"decoded_data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_log_chain_id_contract_address_tx_hash_log_index_unique" UNIQUE("chain_id","contract_address","tx_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "indexer_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" bigint NOT NULL,
	"contract_address" varchar(42) NOT NULL,
	"last_processed_block" bigint NOT NULL,
	"finalized_block" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "strategy_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"strategy_address" varchar(42) NOT NULL,
	"protocol_address" varchar(42) NOT NULL,
	"asset_address" varchar(42) NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"tx_hash" varchar(66) NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" bigint NOT NULL,
	"log_index" bigint NOT NULL,
	"principal" bigint,
	"shares" bigint,
	"current_value" bigint,
	"realized_yield" bigint,
	"realized_loss" bigint,
	"withdrawal_shortfall" bigint,
	"valuation_status" varchar(32),
	"valuation_block" bigint,
	"total_deployed" bigint,
	"protocol_exposure" bigint,
	"asset_exposure" bigint
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_address" varchar(42) NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"tx_hash" varchar(66) NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" bigint NOT NULL,
	"log_index" bigint NOT NULL,
	"deposit_amount" bigint,
	"withdrawal_amount" bigint,
	"user_units" bigint,
	"total_user_units" bigint,
	"user_nav" bigint,
	"realized_yield" bigint,
	"realized_loss" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
