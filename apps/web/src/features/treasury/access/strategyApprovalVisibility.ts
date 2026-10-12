export function getStrategyApprovalPanelVisibility(
  isConnected: boolean,
  isArcMainnet: boolean,
  isPolicyAdmin: boolean,
  isTimelockExecutor: boolean,
) {
  const onArcMainnet = isConnected && isArcMainnet;
  return {
    canSchedule: onArcMainnet && isPolicyAdmin,
    canViewExecution: onArcMainnet && isTimelockExecutor,
  } as const;
}
