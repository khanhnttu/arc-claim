// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ArcClaimV2} from "../src/ArcClaimV2.sol";
import {ArcClaimBatch} from "../src/ArcClaimBatch.sol";

/// @notice Deploys the Phase 2 contracts. Does not touch the Phase 1 ArcClaim deployment.
/// @dev Reads USDC_ADDRESS from the environment. The signer is chosen on the command line
///      (e.g. --account <keystore-name> or --ledger); no private key lives in this file.
contract DeployPhase2 is Script {
    function run() external returns (ArcClaimV2 v2, ArcClaimBatch batch) {
        address usdc = vm.envAddress("USDC_ADDRESS");

        vm.startBroadcast();
        v2 = new ArcClaimV2(usdc);
        batch = new ArcClaimBatch(usdc);
        vm.stopBroadcast();

        console.log("ArcClaimV2:   ", address(v2));
        console.log("ArcClaimBatch:", address(batch));
    }
}
