// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IVeloxTreasury {
    struct Policy {
        uint256 minimumLiquidReserve;
        uint256 surplusSweepThreshold;
        uint256 dailyOutflowCap;
        uint256 maximumSingleWithdrawal;
        bool automatedSweepEnabled;
    }

    struct Allocations {
        uint16 liquidOperationalReserveBps;
        uint16 yieldStrategyBufferBps;
        uint16 swapLiquidityBufferBps;
        uint16 automationAgentPoolBps;
    }

    event Deposit(address indexed depositor, uint256 amount, uint256 treasuryBalance);
    event Withdrawal(address indexed operator, address indexed recipient, uint256 amount, uint256 treasuryBalance, uint256 rolling24HourOutflow);
    event PolicyUpdated(Policy policy, address indexed updatedBy);
    event AllocationUpdated(Allocations allocations, address indexed updatedBy);

    function deposit(uint256 amount) external;
    function withdraw(address recipient, uint256 amount) external;
    function updatePolicy(Policy calldata newPolicy) external;
    function updateAllocations(Allocations calldata newAllocations) external;
    function rolling24HourOutflow() external view returns (uint256);
}
