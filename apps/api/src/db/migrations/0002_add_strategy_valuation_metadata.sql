ALTER TABLE "strategy_ledger" ADD COLUMN IF NOT EXISTS "fees_accrued" bigint;
--> statement-breakpoint
ALTER TABLE "strategy_ledger" ADD COLUMN IF NOT EXISTS "valuation_source" varchar(42);