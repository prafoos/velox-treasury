// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MockUSDC} from "./MockUSDC.sol";

contract ReentrantUSDC is MockUSDC {
    address private _callbackTarget;
    bytes private _callbackData;
    bool private _isCalling;

    function setTransferCallback(address callbackTarget, bytes calldata callbackData) external {
        _callbackTarget = callbackTarget;
        _callbackData = callbackData;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        bool transferred = super.transfer(to, amount);
        if (!_isCalling && _callbackTarget != address(0)) {
            _isCalling = true;
            (bool succeeded, bytes memory returnData) = _callbackTarget.call(_callbackData);
            _isCalling = false;
            if (!succeeded) {
                assembly ("memory-safe") {
                    revert(add(returnData, 32), mload(returnData))
                }
            }
        }
        return transferred;
    }
}
