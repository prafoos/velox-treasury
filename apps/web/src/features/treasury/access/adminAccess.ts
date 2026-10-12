export function canViewAdminPanel(isConnected: boolean, isArcMainnet: boolean, isPolicyAdmin: boolean): boolean {
  return Boolean(isConnected && isArcMainnet && isPolicyAdmin);
}
