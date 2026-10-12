// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVeloxTreasury} from "./interfaces/IVeloxTreasury.sol";

/// @notice Non-upgradeable USDC treasury core. IERC20 USDC amounts use Arc USDC's 6-decimal ERC-20 interface units.
contract VeloxTreasury is IVeloxTreasury, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant ALLOCATION_BPS_TOTAL = 10_000;
    uint256 public constant ROLLING_WINDOW = 24 hours;

    bytes32 public constant POLICY_ADMIN_ROLE = keccak256("POLICY_ADMIN_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant WITHDRAWER_ROLE = keccak256("WITHDRAWER_ROLE");
    /// @dev Reserved only as an integration boundary. It has no permissions in this version.
    bytes32 public constant AUTOMATION_ROLE = keccak256("AUTOMATION_ROLE");

    error InvalidUSDC(address token);
    error ZeroAmount();
    error ZeroRecipient();
    error DuplicateRoleHolder();
    error AmountTooLarge(uint256 amount);
    error UnexpectedDepositAmount(uint256 expected, uint256 received);
    error UnexpectedWithdrawalAmount(uint256 expected, uint256 debited);
    error InvalidPolicy();
    error InvalidAllocationTotal(uint256 totalBps);
    error MaximumSingleWithdrawalExceeded(uint256 amount, uint256 maximum);
    error RollingOutflowLimitExceeded(uint256 requested, uint256 available);
    error MinimumLiquidReserveBreached(uint256 balanceAfter, uint256 minimumReserve);

    struct Outflow {
        uint64 timestamp;
        uint192 amount;
    }

    IERC20 public immutable usdc;
    Policy private _policy;
    Allocations private _allocations;
    Outflow[] private _outflows;
    // Cumulative totals make the exact rolling-window lookup logarithmic in history length.
    // Entries are never removed; off-chain indexers should use Withdrawal events for history.
    uint256[] private _outflowCumulative;

    event TreasuryPaused(address indexed pausedBy);
    event TreasuryUnpaused(address indexed unpausedBy);

    constructor(address usdc_, address governance, address policyAdmin, address pauser, address withdrawer) {
        if (usdc_ == address(0) || usdc_.code.length == 0) revert InvalidUSDC(usdc_);
        if (governance == address(0) || policyAdmin == address(0) || pauser == address(0) || withdrawer == address(0)) revert ZeroRecipient();
        if (
            governance == policyAdmin || governance == pauser || governance == withdrawer || policyAdmin == pauser
                || policyAdmin == withdrawer || pauser == withdrawer
        ) revert DuplicateRoleHolder();
        usdc = IERC20(usdc_);
        _grantRole(DEFAULT_ADMIN_ROLE, governance);
        _grantRole(POLICY_ADMIN_ROLE, policyAdmin);
        _grantRole(PAUSER_ROLE, pauser);
        _grantRole(WITHDRAWER_ROLE, withdrawer);
    }

    function policy() external view returns (Policy memory) {
        return _policy;
    }

    function allocations() external view returns (Allocations memory) {
        return _allocations;
    }

    /// @notice Returns exact outflows recorded during the trailing 24 hours.
    function rolling24HourOutflow() public view returns (uint256) {
        return _rollingOutflowAt(block.timestamp);
    }

    function deposit(uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 balanceBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = usdc.balanceOf(address(this));
        uint256 received = balanceAfter >= balanceBefore ? balanceAfter - balanceBefore : 0;
        if (received != amount) revert UnexpectedDepositAmount(amount, received);
        emit Deposit(msg.sender, amount, balanceAfter);
    }

    function withdraw(address recipient, uint256 amount) external whenNotPaused nonReentrant onlyRole(WITHDRAWER_ROLE) {
        if (recipient == address(0)) revert ZeroRecipient();
        if (amount == 0) revert ZeroAmount();
        Policy memory currentPolicy = _policy;
        if (amount > currentPolicy.maximumSingleWithdrawal) {
            revert MaximumSingleWithdrawalExceeded(amount, currentPolicy.maximumSingleWithdrawal);
        }

        uint256 rollingOutflow = rolling24HourOutflow();
        uint256 remainingDailyCapacity = currentPolicy.dailyOutflowCap > rollingOutflow
            ? currentPolicy.dailyOutflowCap - rollingOutflow
            : 0;
        if (amount > remainingDailyCapacity) {
            revert RollingOutflowLimitExceeded(amount, remainingDailyCapacity);
        }

        uint256 balanceBefore = usdc.balanceOf(address(this));
        if (amount > balanceBefore || balanceBefore - amount < currentPolicy.minimumLiquidReserve) {
            revert MinimumLiquidReserveBreached(balanceBefore > amount ? balanceBefore - amount : 0, currentPolicy.minimumLiquidReserve);
        }

        if (amount > type(uint192).max) revert AmountTooLarge(amount);
        uint256 outflowAfter = rollingOutflow + amount;
        _outflows.push(Outflow({timestamp: uint64(block.timestamp), amount: uint192(amount)}));
        _outflowCumulative.push(_outflowCumulative.length == 0 ? amount : _outflowCumulative[_outflowCumulative.length - 1] + amount);
        usdc.safeTransfer(recipient, amount);
        uint256 balanceAfter = usdc.balanceOf(address(this));
        uint256 debited = balanceAfter <= balanceBefore ? balanceBefore - balanceAfter : 0;
        if (debited != amount) revert UnexpectedWithdrawalAmount(amount, debited);
        emit Withdrawal(msg.sender, recipient, amount, balanceAfter, outflowAfter);
    }

    function updatePolicy(Policy calldata newPolicy) external onlyRole(POLICY_ADMIN_ROLE) {
        if (newPolicy.maximumSingleWithdrawal > newPolicy.dailyOutflowCap) revert InvalidPolicy();
        if (newPolicy.automatedSweepEnabled && newPolicy.surplusSweepThreshold < newPolicy.minimumLiquidReserve) revert InvalidPolicy();
        _policy = newPolicy;
        emit PolicyUpdated(newPolicy, msg.sender);
    }

    function updateAllocations(Allocations calldata newAllocations) external onlyRole(POLICY_ADMIN_ROLE) {
        uint256 total = uint256(newAllocations.liquidOperationalReserveBps)
            + newAllocations.yieldStrategyBufferBps
            + newAllocations.swapLiquidityBufferBps
            + newAllocations.automationAgentPoolBps;
        if (total != ALLOCATION_BPS_TOTAL) revert InvalidAllocationTotal(total);
        _allocations = newAllocations;
        emit AllocationUpdated(newAllocations, msg.sender);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
        emit TreasuryPaused(msg.sender);
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
        emit TreasuryUnpaused(msg.sender);
    }

    function _rollingOutflowAt(uint256 timestamp) private view returns (uint256) {
        uint256 length = _outflows.length;
        if (length == 0) return 0;

        uint256 cutoff = timestamp > ROLLING_WINDOW ? timestamp - ROLLING_WINDOW : 0;
        uint256 low;
        uint256 high = length;
        // Find the first entry strictly newer than the cutoff. An outflow exactly
        // 24 hours old is expired, matching the documented trailing-window rule.
        while (low < high) {
            uint256 middle = low + (high - low) / 2;
            if (uint256(_outflows[middle].timestamp) <= cutoff) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        uint256 totalRecorded = _outflowCumulative[length - 1];
        return low == 0 ? totalRecorded : totalRecorded - _outflowCumulative[low - 1];
    }
}
