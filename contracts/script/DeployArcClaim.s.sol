// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {ArcClaim} from "../src/ArcClaim.sol";

contract DeployArcClaim is Script {
    function run() external returns (ArcClaim claim) {
        address usdc = vm.envAddress("USDC_ADDRESS");

        vm.startBroadcast();
        claim = new ArcClaim(usdc);
        vm.stopBroadcast();
    }
}
