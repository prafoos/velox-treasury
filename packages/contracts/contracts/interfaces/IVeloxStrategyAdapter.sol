// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IVeloxStrategyAdapter {
    function asset() external view returns (address);
    function protocol() external view returns (bytes32);
    function vault() external view returns (address);
    function sharesOfCore() external view returns (uint256);
    function currentValue() external view returns (uint256);
    function previewRedeem(uint256 shares) external view returns (uint256 assets);
    function feesAccrued() external view returns (uint256);
    function deposit(uint256 amount) external returns (uint256 sharesReceived);
    function withdrawShares(uint256 shares, address recipient) external returns (uint256 assetsReceived);
}
