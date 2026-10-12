// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVeloxStrategyAdapter} from "../interfaces/IVeloxStrategyAdapter.sol";

contract MockStrategyAdapter is IVeloxStrategyAdapter {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    bytes32 public protocolId;
    address public assetAddress;
    address public vaultAddress;
    uint256 public totalShares;
    uint256 public totalAssets;
    uint256 public reportedFees;
    uint16 public withdrawalBps = 10_000;
    bool public failValuation;
    bool public failWithdrawal;
    mapping(address => uint256) public shares;

    constructor(address token_, bytes32 protocol_) {
        token = IERC20(token_);
        protocolId = protocol_;
        assetAddress = token_;
        vaultAddress = token_;
    }

    function asset() external view returns (address) {
        return assetAddress;
    }

    function protocol() external view returns (bytes32) {
        return protocolId;
    }

    function vault() external view returns (address) {
        return vaultAddress;
    }

    function sharesOfCore() external view returns (uint256) {
        return shares[msg.sender];
    }

    function currentValue() external view returns (uint256) {
        if (failValuation) revert('valuation unavailable');
        return _previewRedeem(shares[msg.sender]);
    }

    function previewRedeem(uint256 shareAmount) external view returns (uint256 assets) {
        return _previewRedeem(shareAmount);
    }

    function feesAccrued() external view returns (uint256) {
        return reportedFees;
    }

    function deposit(uint256 amount) external returns (uint256 sharesReceived) {
        token.safeTransferFrom(msg.sender, address(this), amount);
        sharesReceived = totalShares == 0 || totalAssets == 0 ? amount : amount * totalShares / totalAssets;
        if (sharesReceived == 0) revert('zero shares');
        shares[msg.sender] += sharesReceived;
        totalShares += sharesReceived;
        totalAssets += amount;
    }

    function withdrawShares(uint256 shareAmount, address recipient) external returns (uint256 assetsReceived) {
        if (failWithdrawal) revert('withdrawal unavailable');
        uint256 assets = _previewRedeem(shareAmount);
        if (shareAmount == 0 || shareAmount > shares[msg.sender]) revert('invalid shares');
        shares[msg.sender] -= shareAmount;
        totalShares -= shareAmount;
        totalAssets -= assets;
        assetsReceived = assets * withdrawalBps / 10_000;
        token.safeTransfer(recipient, assetsReceived);
    }

    function setAssetValue(uint256 value) external {
        totalAssets = value;
    }

    function setProtocol(bytes32 value) external {
        protocolId = value;
    }

    function setAsset(address value) external {
        assetAddress = value;
    }

    function setVault(address value) external {
        vaultAddress = value;
    }

    function setReportedFees(uint256 value) external {
        reportedFees = value;
    }

    function setWithdrawalBps(uint16 value) external {
        withdrawalBps = value;
    }

    function setFailValuation(bool value) external {
        failValuation = value;
    }

    function setFailWithdrawal(bool value) external {
        failWithdrawal = value;
    }

    function _previewRedeem(uint256 shareAmount) private view returns (uint256 assets) {
        if (totalShares == 0) return 0;
        return shareAmount * totalAssets / totalShares;
    }
}
