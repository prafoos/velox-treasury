import type {
  EmergencyControlModel,
  TreasuryAllocationModel,
  TreasuryBalanceModel,
  TreasuryRuleModel,
} from '@velox/domain';

export * from '@velox/domain';

export type TreasuryViewSection = 'overview' | 'allocations' | 'rules' | 'risk_controls';

export interface TreasuryModalState {
  readonly isDepositOpen: boolean;
  readonly isWithdrawOpen: boolean;
  readonly isRulesOpen: boolean;
  readonly isEmergencyOpen: boolean;
}

export interface TreasuryStatusBannerInfo {
  readonly type: 'info' | 'warning' | 'notice';
  readonly title: string;
  readonly message: string;
}

export interface TreasurySummary {
  readonly balances: TreasuryBalanceModel;
  readonly allocations: TreasuryAllocationModel;
  readonly rules: readonly TreasuryRuleModel[];
  readonly emergency: EmergencyControlModel;
  readonly isConnected: boolean;
  readonly isArcMainnet: boolean;
  readonly address?: `0x${string}` | string;
  readonly chainName?: string;
  readonly statusBanner: TreasuryStatusBannerInfo;
}
