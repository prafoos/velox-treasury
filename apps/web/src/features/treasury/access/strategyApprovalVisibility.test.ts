import { describe, expect, it } from 'vitest';

import { getStrategyApprovalPanelVisibility } from './strategyApprovalVisibility';

describe('Strategy Approval panel visibility', () => {
  it('does not expose privileged panels to an ordinary or Automation-only user', () => {
    expect(getStrategyApprovalPanelVisibility(true, true, false, false)).toEqual({
      canSchedule: false,
      canViewExecution: false,
    });
  });

  it('shows scheduling only to a verified Policy Admin', () => {
    expect(getStrategyApprovalPanelVisibility(true, true, true, false)).toEqual({
      canSchedule: true,
      canViewExecution: false,
    });
  });

  it('shows execution readiness only to a verified Timelock Executor', () => {
    expect(getStrategyApprovalPanelVisibility(true, true, false, true)).toEqual({
      canSchedule: false,
      canViewExecution: true,
    });
  });

  it('fails closed while disconnected or off Arc Mainnet', () => {
    expect(getStrategyApprovalPanelVisibility(false, true, true, true)).toEqual({
      canSchedule: false,
      canViewExecution: false,
    });
    expect(getStrategyApprovalPanelVisibility(true, false, true, true)).toEqual({
      canSchedule: false,
      canViewExecution: false,
    });
  });
});
