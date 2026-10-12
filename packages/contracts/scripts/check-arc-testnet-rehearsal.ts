import { loadArcTestnetRehearsalConfig } from './arc-testnet-rehearsal';

// Deliberately validates configuration only. It never creates a provider, signer, or contract instance.
const config = loadArcTestnetRehearsalConfig(process.env);
console.log(`Validated ${config.network.network} rehearsal configuration for chain ${config.network.chainId}; no deployment was attempted.`);
