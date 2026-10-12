CREATE TABLE IF NOT EXISTS "strategy_automation_triggers" (
	"chain_id" integer NOT NULL,
	"deposit_transaction_hash" varchar(66) NOT NULL,
	"status" varchar(16) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "strategy_automation_triggers_chain_tx_unique" UNIQUE("chain_id","deposit_transaction_hash"),
	CONSTRAINT "strategy_automation_triggers_status_check" CHECK ("status" IN ('STARTED', 'COMPLETED', 'FAILED'))
);
