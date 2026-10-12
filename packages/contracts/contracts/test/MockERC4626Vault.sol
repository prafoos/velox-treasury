// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockERC4626Vault {
    using SafeERC20 for IERC20;

    error ZeroAmount();
    error InvalidShares();
    error DepositFailed();
    error RedeemFailed();

    IERC20 public immutable assetToken;
    uint256 public totalAssets;
    uint256 public totalShares;
    mapping(address => uint256) public balances;
    bool public failDeposit;
    bool public failRedeem;
    uint256 public unexpectedRedeemGap;
    uint256 public unexpectedTransferGap;
    uint256 public unexpectedDepositGap;

    constructor(address asset_) {
        assetToken = IERC20(asset_);
    }

    function asset() external view returns (address) {
        return address(assetToken);
    }

    function balanceOf(address owner) external view returns (uint256) {
        return balances[owner];
    }

    function totalSupply() external view returns (uint256) {
        return totalShares;
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        if (totalShares == 0 || totalAssets == 0) return assets;
        return assets * totalShares / totalAssets;
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        if (totalShares == 0) return 0;
        return shares * totalAssets / totalShares;
    }

    function previewDeposit(uint256 assets) external view returns (uint256) {
        return convertToShares(assets);
    }

    function previewRedeem(uint256 shares) external view returns (uint256) {
        return convertToAssets(shares);
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        if (failDeposit) revert DepositFailed();
        if (assets == 0) revert ZeroAmount();

        assetToken.safeTransferFrom(msg.sender, address(this), assets);
        shares = convertToShares(assets);
        if (shares == 0) revert InvalidShares();

        uint256 adjustedAssets = assets + unexpectedDepositGap;
        if (adjustedAssets != assets) {
            assetToken.safeTransferFrom(msg.sender, address(this), unexpectedDepositGap);
        }

        balances[receiver] += shares;
        totalShares += shares;
        totalAssets += assets;
    }

    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets) {
        if (failRedeem) revert RedeemFailed();
        if (shares == 0 || shares > balances[owner]) revert InvalidShares();

        assets = convertToAssets(shares);
        if (unexpectedRedeemGap > 0) {
            assets = assets > unexpectedRedeemGap ? assets - unexpectedRedeemGap : 0;
        }

        balances[owner] -= shares;
        totalShares -= shares;
        totalAssets -= assets;

        if (assets > 0) {
            uint256 transferAmount = assets + unexpectedTransferGap;
            assetToken.safeTransfer(receiver, transferAmount);
        }
    }

    function setTotalAssets(uint256 value) external {
        totalAssets = value;
    }

    function setFailDeposit(bool value) external {
        failDeposit = value;
    }

    function setFailRedeem(bool value) external {
        failRedeem = value;
    }

    function setUnexpectedRedeemGap(uint256 value) external {
        unexpectedRedeemGap = value;
    }

    function setUnexpectedTransferGap(uint256 value) external {
        unexpectedTransferGap = value;
    }

    function setUnexpectedDepositGap(uint256 value) external {
        unexpectedDepositGap = value;
    }
}
