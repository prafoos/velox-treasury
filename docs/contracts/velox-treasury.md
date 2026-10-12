# Velox Treasury contract security design (legacy)

> **Legacy/testnet architecture notice:** This document describes the legacy `VeloxTreasury` contract and its `IVeloxTreasury` interface. `packages/contracts/abi/VeloxTreasury.json` is the ABI exported for that legacy/testnet flow. Current Arc Mainnet uses `VeloxTreasuryCore`; its runtime does not use the legacy `policy()`, `allocations()`, `updatePolicy()`, `updateAllocations()`, or `WITHDRAWER_ROLE` interface.

**Legacy contract status:** This legacy `VeloxTreasury` contract is not the configured production Mainnet Core. The project-designated current Arc Mainnet `VeloxTreasuryCore` is `0x3D1D1620E5Dd0DEA146bB5cEC8b4954e0ec210B7` on chain `5042`. This registry designation is not, by itself, a deployment receipt or independent deployment verification.

**Current Mainnet path:** Deployments use `packages/contracts/scripts/deploy-arc-mainnet-core.ts`. The current frontend reads the configured Core and has Mainnet deposit, withdrawal, and withdrawal-with-deallocation paths. The legacy Mainnet deployment script remains separate and requires `ALLOW_LEGACY_MAINNET_DEPLOYMENT=1` for deliberate historical/test use.

## Current Core and Adapter readiness

The current Core is `VeloxTreasuryCore` in `packages/contracts/contracts/VeloxTreasuryCore.sol`. The Core deployment config assigns the established non-zero governance, POLICY_ADMIN, TIMELOCK_EXECUTOR, AUTOMATION_ROLE, and EMERGENCY_ROLE addresses to their matching constructor roles; these public values are also listed in `.env.example` and may be explicitly overridden through the corresponding `ARC_MAINNET_CORE_*` environment variables. The Admin/operator must decide and explicitly supply the initial valuation freshness window as a positive integer in `ARC_MAINNET_CORE_VALUATION_FRESHNESS_BLOCKS`; no value is defaulted. Missing configuration reports `Admin-defined valuation freshness value required`; zero and malformed values are rejected. The Core constructor requires this value to be nonzero to enforce freshness bounds for strategy valuations. Initial reserve values, deployment ceiling, timelock, and bucket policy are explicitly configured; deployment requires a positive Admin-defined `maximumTotalDeployed`, a 172800-second timelock, and bucket values totaling exactly 10000 BPS. No reserve value, deployment ceiling amount, or bucket split is defaulted or hard-coded by deployment validation. Exposure caps may remain zero/disabled before their separately timelocked protocol, asset, and strategy approvals.

Core withdrawal reserve checks preserve the configured reserve while user liabilities remain, but waive it for a withdrawal that leaves no user liabilities so a fixed reserve cannot strand the final user's balance. A strategy-backed exit is atomic and requires a successful adapter unwind and current valuation; the emergency pause intentionally blocks normal withdrawals until the authorized administrator unpauses.

The final Core source now also enforces Admin-configurable maximum single-withdrawal and fixed 24-hour outflow limits on all user withdrawal paths, including withdrawals that unwind strategies. Limit reductions take effect immediately; increases use the existing two-day timelock and executor role. Zero means the corresponding limit is not configured and is uncapped. The checked-in `VeloxTreasuryCore` artifact's deployed runtime is 24,571 bytes, five bytes below EIP-170's 24,576-byte limit. The artifact does not establish whether or when that code was deployed or approved; verify those independently.

Adapter deployment is production-only when `ARC_MAINNET_FINAL_CORE_ADDRESS` is explicitly supplied. It has no current-Core fallback. The script verifies Core bytecode and expected initial Core state before deployment, then verifies the deployed Adapter's immutable Core, USDC, vault, and protocol ID getters.

Before production runtime startup/build, explicitly set `VITE_ARC_MAINNET_CORE_ADDRESS` and `VITE_ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS` to the intended addresses. The API/indexer require `VELOX_TREASURY_CORE_ADDRESS` and `STEAKHOUSE_ADAPTER_ADDRESS` when `NODE_ENV=production`; the Core must match the project-designated current Core, and the Adapter must be an explicit non-retired address that is not the current live reference. Local API read-only mode uses only the project-designated Core and a read-only Adapter reference; this is not a production fallback. All paths reject malformed, zero, and retired addresses and are fixed to Arc Mainnet chain ID 5042.

The intended operational sequence is: deploy Core; verify its bytecode, constructor state, and roles; deploy Adapter against that final Core; verify all Adapter bindings; configure/verify Core policy and protocol/asset/strategy approvals through the existing authorized flows; verify roles, timelock, withdrawals, and liquidity; only then permit funding or strategy operations. Static checks are read-only; they do not imply deployment or execution.

## Architecture

`VeloxTreasury` is a non-upgradeable, single-asset USDC vault. It has no proxy, implementation slot, `delegatecall`, arbitrary external call, rescue/sweep function, strategy, swap, yield action, or automation execution path. USDC is an immutable, non-zero contract address supplied to the constructor.

The constructor requires five distinct addresses: USDC, governance, policy administrator, pauser, and withdrawer. It rejects a zero or repeated authority. Monetary values are ERC-20 integer base units; Arc Mainnet gas/native-currency metadata uses 18 decimals while the USDC ERC-20 interface uses six-decimal base units. Allocation targets are basis points (exactly 10,000 bps) and do not physically allocate funds.

Before deployment, independently verify Arc Mainnet (chain 5042) and native USDC (`0x3600000000000000000000000000000000000000`) from current official Arc/Circle documentation. This is not a deployed Treasury address.

## Privileged capabilities

| Authority | May do | May not do directly |
| --- | --- | --- |
| `DEFAULT_ADMIN_ROLE` / governance | Grant or revoke roles | Withdraw, update policy, pause |
| `POLICY_ADMIN_ROLE` | Update valid policy and allocation targets | Manage roles, withdraw, pause |
| `PAUSER_ROLE` | Pause or unpause deposits and withdrawals | Manage roles, withdraw, update policy |
| `WITHDRAWER_ROLE` | Make a policy-constrained withdrawal | Manage roles, update policy, pause |
| `AUTOMATION_ROLE` | Nothing; future boundary only | Any Treasury action |

OpenZeppelin `AccessControl` makes `DEFAULT_ADMIN_ROLE` the ultimate role-management authority. Governance could assign itself an operational role, so governance must be a controlled multisig and should be behind an appropriate timelock/approval process. This is an external operational trust assumption, not a claim that the contract removes governance risk.

## Enforcement

Withdrawals require an unpaused contract, `WITHDRAWER_ROLE`, non-zero recipient/amount, the single-withdrawal cap, the trailing-24-hour cap, and the live minimum-reserve check against the actual USDC balance. The outgoing Treasury balance must decrease by exactly the requested amount.

Policy requires `maximumSingleWithdrawal <= dailyOutflowCap`; an enabled automated-sweep threshold cannot be below the reserve. Policy saves intentionally do not inspect the current balance: a Treasury with 10 USDC can set a larger future policy, but live withdrawals always enforce balance and reserve. The initial all-zero policy safely blocks withdrawals until an approved policy is set.

Each successful withdrawal records a timestamp and amount. An outflow is active only if its timestamp is strictly newer than `block.timestamp - 24 hours`; one exactly 24 hours old is expired. Cumulative totals and binary search calculate this exact total in logarithmic time, avoiding an unbounded cleanup loop. History remains stored, so storage grows with successful withdrawals; this is an operational cost limitation. Chain timestamps have normal validator tolerance.

`SafeERC20` protects transfers. Deposits require the actual balance increase to equal the amount; withdrawals require the Treasury debit to equal it. This rejects false-returning or unusual token accounting. Arc Mainnet native USDC must nevertheless be independently confirmed as a conventional 18-decimal ERC-20. Direct USDC transfers increase the real balance but do not emit `Deposit`; arbitrary other tokens sent directly are irrecoverable by design because there is no rescue function.

Pausing blocks both deposits and withdrawals only. It cannot confiscate or recover funds. `ReentrancyGuard` protects every token-moving path; state changes precede the token interaction and a failure reverts accounting.

## Integration boundary

The ABI source is `packages/contracts/contracts/interfaces/IVeloxTreasury.sol`; `pnpm --filter @velox/contracts export:abi` produces `packages/contracts/abi/VeloxTreasury.json`. Events are `Deposit`, `Withdrawal`, `PolicyUpdated`, `AllocationUpdated`, `TreasuryPaused`, and `TreasuryUnpaused`, emitted after successful transitions.

The legacy integration described here is historical/testnet-only. Current Arc Mainnet frontend integration uses the configured `VeloxTreasuryCore` ABI and address for Core reads and supported deposit, withdrawal, and withdrawal-with-deallocation writes. Local policy uses six-decimal bigint values and 10,000-bps allocation totals, consistent with the relevant contract interfaces.

## Toolchain

- pnpm 10.0.0; the committed lockfile is v9.
- Node 20.x, declared by `.nvmrc` and root `engines`.
- Hardhat 2.17.4; its own supported-version list is Node 16, 18, and 20. Node 24 is unsupported and must not be used for release validation.
- Solidity 0.8.28 through pinned local `solc` 0.8.28, optimizer 200 runs.
- OpenZeppelin Contracts 5.4.0.

Hardhat 2.17.4 warns that Solidity 0.8.28 is not fully supported, including potential stack-trace limitations. This remains a release limitation pending a separately reviewed toolchain upgrade.

## Review findings addressed

1. **High — availability:** linear pruning of expired outflows could make a long withdrawal history run out of gas. Replaced with cumulative accounting and binary search.
2. **High — deployment privilege concentration:** governance was initially assigned every live role. Constructor now requires distinct governance, policy-admin, pauser, and withdrawer holders.
3. **Medium — ERC-20 accounting:** nominal transfer amounts were trusted. Exact balance deltas are now enforced and false-return/reentrancy tests added.
4. **Medium — release runtime:** Node 24 is unsupported by pinned Hardhat. Node 20.x is now specified; release checks must use it.
5. **Low — diagnostics:** pinned Hardhat warns about Solidity 0.8.28 support. Warning is retained and documented.

## Deployment prerequisites

1. Re-verify Arc and native USDC with primary documentation.
2. Use Node 20.x and `pnpm install --frozen-lockfile`.
3. Run compile, contract tests, TypeScript check, ABI export, workspace checks/tests, and web build.
4. Set four distinct controlled role holders; governance needs documented multisig/timelock controls.
5. Review the initial policy/allocation in 18-decimal USDC units and bps.
6. Complete an independent professional security audit and non-mainnet deployment rehearsal.
7. Add a real address or frontend write capability only after verified deployment and separate review.

## Arc Testnet rehearsal configuration

`packages/contracts/scripts/arc-testnet-rehearsal.ts` is a validation-only configuration boundary for a future reviewable rehearsal. It has no deployment, provider, signer, private-key, contract-address, or transaction capability. It records four explicit public Testnet rehearsal role holders, validates that they are non-zero distinct EVM addresses, and has no additional roles. `pnpm --filter @velox/contracts rehearsal:check` requires explicit policy/allocation inputs from the environment; it does not provide defaults or placeholders.

It accepts only Arc Testnet (`arc-testnet`, chain ID `5042002`, RPC `https://rpc.testnet.arc.io`) and rejects a Mainnet selector or RPC endpoint. The native gas currency is USDC with 18-decimal precision, but all policy values accepted by this validator use the official ERC-20 USDC interface's six-decimal base units. Its four role inputs must be distinct. This configuration is deliberately isolated from the Mainnet frontend configuration and is not a deployment script.

This document is not an audit certificate and does not guarantee security.
