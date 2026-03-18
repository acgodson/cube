// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CubeEscrow} from "../src/CubeEscrow.sol";

contract DeployCubeEscrow is Script {
    // Default fee: 5% (500 basis points)
    uint256 constant DEFAULT_FEE_BPS = 500;

    function run() external returns (CubeEscrow escrow) {
        uint256 deployerPrivateKey = vm.envUint("HEDERA_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        address treasury = deployer;
        uint256 feeBps = DEFAULT_FEE_BPS;

        console.log("Deploying CubeEscrow...");
        console.log("Deployer/Treasury:", deployer);
        console.log("Fee BPS:", feeBps);

        vm.startBroadcast(deployerPrivateKey);
        escrow = new CubeEscrow(treasury, feeBps);
        vm.stopBroadcast();

        console.log("CubeEscrow deployed at:", address(escrow));
    }
}
