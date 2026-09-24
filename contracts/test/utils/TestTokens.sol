// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Plain 6-decimal mintable token standing in for USDC.
contract TestUSDC is ERC20 {
    constructor() ERC20("Test USDC", "tUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Burns 1% of every transfer, so the receiver gets less than `amount`.
contract FeeOnTransferToken is ERC20 {
    constructor() ERC20("Fee Token", "FEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0), fee);
            value -= fee;
        }
        super._update(from, to, value);
    }
}

/// @dev On the first transfer into or out of `target` after arming, calls back into `target` with `callData`
///      to attempt reentrancy. Records whether the re-entrant call succeeded.
contract ReentrantToken is ERC20 {
    address public target;
    bytes public callData;
    bool public attempted;
    bool public reentrySucceeded;

    constructor() ERC20("Reentrant", "RE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target_, bytes calldata callData_) external {
        target = target_;
        callData = callData_;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (target != address(0) && (from == target || to == target) && !attempted) {
            attempted = true;
            (reentrySucceeded,) = target.call(callData);
        }
    }
}
