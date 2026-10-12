import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePublicClient, useWriteContract } from 'wagmi';

import { useWalletStatus } from '../../../hooks/useWalletStatus';
import {
  POLICY_ADMIN_ROLE,
  veloxTreasuryAbi,
} from '../../../contracts/treasury';
import { ARC_MAINNET_CHAIN_ID } from '../../../contracts/usdc';
import { withVerifiedArcMainnetPublicClient } from '../services/arcMainnetPublicClient';
import {
  configureSteakhouseProtocolVault,
  STEAKHOUSE_CORE_ADDRESS,
  STEAKHOUSE_POLICY_ADMIN_ADDRESS,
  STEAKHOUSE_PROTOCOL_ID,
  STEAKHOUSE_VAULT_ADDRESS,
} from '../services/protocolVaultMapping';

export function ProtocolVaultMappingAdminAction() {
  const { address, isConnected, isArcMainnet } = useWalletStatus();
  const publicClient = usePublicClient({ chainId: ARC_MAINNET_CHAIN_ID });
  const { writeContractAsync, isPending } = useWriteContract();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shouldCheck = Boolean(
    isConnected
      && isArcMainnet
      && address
      && address.toLowerCase() === STEAKHOUSE_POLICY_ADMIN_ADDRESS.toLowerCase()
      && publicClient,
  );

  const mappingQuery = useQuery({
    queryKey: ['steakhouse-protocol-vault-mapping', address?.toLowerCase() ?? null],
    enabled: shouldCheck,
    retry: false,
    queryFn: async () => {
      if (!publicClient || !address) throw new Error('Arc Mainnet wallet or public client is unavailable.');
      const hasRole = await withVerifiedArcMainnetPublicClient(publicClient, () => publicClient.readContract({
        address: STEAKHOUSE_CORE_ADDRESS,
        abi: veloxTreasuryAbi,
        functionName: 'hasRole',
        args: [POLICY_ADMIN_ROLE, address],
      }));
      if (!hasRole) return { authorized: false, vault: null };

      const vault = await withVerifiedArcMainnetPublicClient(publicClient, () => publicClient.readContract({
        address: STEAKHOUSE_CORE_ADDRESS,
        abi: veloxTreasuryAbi,
        functionName: 'protocolVaults',
        args: [STEAKHOUSE_PROTOCOL_ID],
      }));
      return { authorized: true, vault };
    },
  });

  if (!shouldCheck) return null;
  if (mappingQuery.data?.authorized !== true) {
    if (!mappingQuery.error) return null;
    return (
      <section className="vx-section" aria-labelledby="steakhouse-protocol-vault-title">
        <h2 id="steakhouse-protocol-vault-title">Steakhouse Protocol Vault</h2>
        <p role="alert">Unable to verify the connected wallet's Policy Admin role or current mapping: {mappingQuery.error.message}</p>
      </section>
    );
  }

  const isUnconfigured = mappingQuery.data.vault?.toLowerCase() === '0x0000000000000000000000000000000000000000';
  const isConfigured = mappingQuery.data.vault?.toLowerCase() === STEAKHOUSE_VAULT_ADDRESS.toLowerCase();

  const configure = async () => {
    if (!publicClient || !address) return;
    setStatus(null);
    setError(null);
    try {
      const result = await configureSteakhouseProtocolVault({
        chainId: ARC_MAINNET_CHAIN_ID,
        accountAddress: address,
        readPolicyAdminRole: () => withVerifiedArcMainnetPublicClient(publicClient, () => publicClient.readContract({
          address: STEAKHOUSE_CORE_ADDRESS,
          abi: veloxTreasuryAbi,
          functionName: 'hasRole',
          args: [POLICY_ADMIN_ROLE, address],
        })),
        readProtocolVault: () => withVerifiedArcMainnetPublicClient(publicClient, () => publicClient.readContract({
          address: STEAKHOUSE_CORE_ADDRESS,
          abi: veloxTreasuryAbi,
          functionName: 'protocolVaults',
          args: [STEAKHOUSE_PROTOCOL_ID],
        })),
        submit: () => writeContractAsync({
          address: STEAKHOUSE_CORE_ADDRESS,
          abi: veloxTreasuryAbi,
          functionName: 'configureProtocolVault',
          args: [STEAKHOUSE_PROTOCOL_ID, STEAKHOUSE_VAULT_ADDRESS],
          chainId: ARC_MAINNET_CHAIN_ID,
        }),
        waitForReceipt: (hash) => withVerifiedArcMainnetPublicClient(publicClient, async () => {
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          return { status: receipt.status, blockNumber: receipt.blockNumber };
        }),
      });
      setStatus(`Protocol-vault mapping confirmed in transaction ${result.hash} at block ${result.blockNumber}.`);
      await queryClient.invalidateQueries({ queryKey: ['steakhouse-protocol-vault-mapping'] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Protocol-vault configuration failed.');
    }
  };

  return (
    <section className="vx-section" aria-labelledby="steakhouse-protocol-vault-title">
      <div className="vx-section-header">
        <div className="vx-section-title-group">
          <h2 id="steakhouse-protocol-vault-title">Steakhouse Protocol Vault</h2>
          <p>Configure only the protocol-to-vault mapping on the target Core.</p>
        </div>
      </div>
      <div>Protocol: <code>{STEAKHOUSE_PROTOCOL_ID}</code></div>
      <div>Vault: <code>{STEAKHOUSE_VAULT_ADDRESS}</code></div>
      {mappingQuery.isFetching && <p role="status">Verifying Policy Admin role and current mapping...</p>}
      {mappingQuery.error && <p role="alert">{mappingQuery.error.message}</p>}
      {isConfigured && <p role="status">Protocol is mapped to the Steakhouse Vault.</p>}
      {!isUnconfigured && !isConfigured && mappingQuery.data.vault && (
        <p role="alert">Protocol is already mapped to a different vault; no change is available here.</p>
      )}
      {isUnconfigured && (
        <button
          type="button"
          className="vx-btn vx-btn-primary"
          disabled={isPending || mappingQuery.isFetching}
          onClick={() => { void configure(); }}
        >
          Configure Steakhouse Vault Mapping
        </button>
      )}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
