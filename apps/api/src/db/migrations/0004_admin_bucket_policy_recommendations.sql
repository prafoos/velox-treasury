CREATE TABLE IF NOT EXISTS "admin_bucket_policy_recommendations" (
	"chain_id" bigint NOT NULL,
	"admin_wallet" varchar(42) NOT NULL,
	"suggestion" jsonb NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_bucket_policy_recommendations_chain_wallet_unique" UNIQUE("chain_id","admin_wallet")
);
