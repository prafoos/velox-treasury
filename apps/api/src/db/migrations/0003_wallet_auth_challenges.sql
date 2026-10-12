CREATE TABLE IF NOT EXISTS "wallet_auth_challenges" (
	"nonce" varchar(64) PRIMARY KEY NOT NULL,
	"wallet_address" varchar(42) NOT NULL,
	"message" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);