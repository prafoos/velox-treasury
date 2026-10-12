// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVeloxStrategyAdapter} from "./interfaces/IVeloxStrategyAdapter.sol";

interface IMorphoVaultV2 {
    function asset() external view returns (address);
    function totalAssets() external view returns (uint256);
    function convertToShares(uint256 assets) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function previewDeposit(uint256 assets) external view returns (uint256 shares);
    function previewRedeem(uint256 shares) external view returns (uint256 assets);
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
    function balanceOf(address owner) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

contract SteakhousePrimeUSDCAdapter is IVeloxStrategyAdapter {
    using SafeERC20 for IERC20;

    error InvalidVaultAddress();
    error InvalidCoreAddress();
    error InvalidAsset();
    error UnauthorizedCaller();
    error ZeroAmount();
    error InvalidShares();
    error UnexpectedShareDelta(uint256 expected, uint256 actual);
    error UnexpectedAssetDelta(uint256 expected, uint256 actual);

    IERC20 public immutable usdc;
    IMorphoVaultV2 public immutable vaultContract;
    address public immutable core;
    bytes32 public immutable protocolId;

    constructor(address vault_, address core_, bytes32 protocol_, address usdc_) {
        if (vault_ == address(0) || vault_.code.length == 0) revert InvalidVaultAddress();
        if (core_ == address(0)) revert InvalidCoreAddress();
        if (usdc_ == address(0)) revert InvalidAsset();

        vaultContract = IMorphoVaultV2(vault_);
        core = core_;
        protocolId = protocol_;
        usdc = IERC20(usdc_);

        if (vaultContract.asset() != usdc_) revert InvalidAsset();
    }

    modifier onlyCore() {
        if (msg.sender != core) revert UnauthorizedCaller();
        _;
    }

    function asset() external view returns (address) {
        return address(usdc);
    }

    function protocol() external view returns (bytes32) {
        return protocolId;
    }

    function vault() external view returns (address) {
        return address(vaultContract);
    }

    function sharesOfCore() external view returns (uint256) {
        return vaultContract.balanceOf(address(this));
    }

    function currentValue() external view returns (uint256) {
        return vaultContract.convertToAssets(vaultContract.balanceOf(address(this)));
    }

    function previewRedeem(uint256 shares) external view returns (uint256) {
        return vaultContract.previewRedeem(shares);
    }

    function feesAccrued() external view returns (uint256) {
        return 0;
    }

    function deposit(uint256 amount) external onlyCore returns (uint256 sharesReceived) {
        if (amount == 0) revert ZeroAmount();

        uint256 beforeShares = vaultContract.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        usdc.forceApprove(address(vaultContract), amount);
        sharesReceived = vaultContract.deposit(amount, address(this));
        uint256 afterShares = vaultContract.balanceOf(address(this));
        usdc.forceApprove(address(vaultContract), 0);

        uint256 actualDelta = afterShares - beforeShares;
        if (actualDelta != sharesReceived) revert UnexpectedShareDelta(sharesReceived, actualDelta);
    }

    function withdrawShares(uint256 shares, address recipient) external onlyCore returns (uint256 assetsReceived) {
        if (shares == 0 || shares > vaultContract.balanceOf(address(this))) revert InvalidShares();

        uint256 expectedAssets = vaultContract.previewRedeem(shares);
        uint256 beforeBalance = usdc.balanceOf(address(this));
        assetsReceived = vaultContract.redeem(shares, recipient, address(this));

        if (recipient == address(this)) {
            uint256 actualBalanceDelta = usdc.balanceOf(address(this)) - beforeBalance;
            if (actualBalanceDelta != assetsReceived) revert UnexpectedAssetDelta(assetsReceived, actualBalanceDelta);
        }

        if (assetsReceived > expectedAssets) {
            revert UnexpectedAssetDelta(expectedAssets, assetsReceived);
        }
    }

    function totalAssets() external view returns (uint256) {
        return vaultContract.totalAssets();
    }

    function totalSupply() external view returns (uint256) {
        return vaultContract.totalSupply();
    }
}
