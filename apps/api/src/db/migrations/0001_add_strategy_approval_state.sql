ALTER TABLE "strategy_ledger" ADD COLUMN IF NOT EXISTS "approved" boolean;
--> statement-breakpoint
ALTER TABLE "strategy_ledger" ADD COLUMN IF NOT EXISTS "enabled" boolean;
--> statement-breakpoint
ALTER TABLE "strategy_ledger" ADD COLUMN IF NOT EXISTS "absolute_cap" bigint;
--> statement-breakpoint
ALTER TABLE "strategy_ledger" ADD COLUMN IF NOT EXISTS "relative_cap_bps" bigint;