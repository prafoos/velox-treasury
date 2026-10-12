const CURRENT_CORE = '0x3D1D1620E5Dd0DEA146bB5cEC8b4954e0ec210B7';
const CURRENT_ADAPTER = '0xac5aB6e98d281f49B87Bf943A248Ff8559d9Ed86';
const CURRENT_USDC = '0x3600000000000000000000000000000000000000';
const CURRENT_VAULT = '0xbeef0016cb2Fd5C352ea7CA08a9f54739DFa7298';
const CURRENT_PROTOCOL_ID = '0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450';
const RETIRED_CORE = '0xcc058cFcC77061Ff1c47DbA50dF064B75053aC27';
const RETIRED_LEGACY_CORE_REFERENCE = '0x2D7637937e71cbdfC8a8771f644aEbEC5A6d0d2e';
const RETIRED_ADAPTER = '0xE886A619584a1fF017E744D5B55F0D5dc59018c4';
const RETIRED_TREASURY = '0x3033876A3283d0B4CCCAE9C2D562915ca369d9C6';

function assertArcMainnetChain(chainId) {
  if (String(chainId) !== '5042') throw new Error(`Recovery preflight requires Arc Mainnet chain ID 5042, received ${chainId}.`);
}

function assertCurrentCore(core) {
  if (core.toLowerCase() !== CURRENT_CORE.toLowerCase()) throw new Error('Recovery preflight refuses a non-current Core address.');
  if ([RETIRED_CORE, RETIRED_LEGACY_CORE_REFERENCE, RETIRED_TREASURY].some((address) => core.toLowerCase() === address.toLowerCase())) {
    throw new Error('Recovery preflight refuses a legacy or retired Core address.');
  }
}

function assertCurrentRecoveryTargets(core, adapter) {
  assertCurrentCore(core);
  if (adapter.toLowerCase() !== CURRENT_ADAPTER.toLowerCase()) throw new Error('Recovery preflight refuses a non-current Adapter address.');
  if ([RETIRED_ADAPTER, RETIRED_TREASURY].some((address) => adapter.toLowerCase() === address.toLowerCase())) {
    throw new Error('Recovery preflight refuses a legacy or retired Adapter address.');
  }
}

module.exports = {
  CURRENT_CORE,
  CURRENT_ADAPTER,
  CURRENT_USDC,
  CURRENT_VAULT,
  CURRENT_PROTOCOL_ID,
  RETIRED_CORE,
  RETIRED_ADAPTER,
  RETIRED_TREASURY,
  assertArcMainnetChain,
  assertCurrentCore,
  assertCurrentRecoveryTargets,
};