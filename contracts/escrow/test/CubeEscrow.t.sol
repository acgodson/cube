// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CubeEscrow} from "../src/CubeEscrow.sol";

contract CubeEscrowTest is Test {
    CubeEscrow internal escrow;
    address internal treasury = address(0xBEEF);
    address internal poster = address(0xABCD);
    address internal agent = address(0x1234);

    function setUp() external {
        escrow = new CubeEscrow(treasury, 500);
        vm.deal(poster, 100 ether);
        vm.deal(agent, 10 ether);
    }

    function testCreateStakeSelectSubmitAndRelease() external {
        vm.prank(poster);
        uint256 taskId = escrow.createTask{value: 10 ether}();

        vm.prank(agent);
        escrow.stakeBid{value: 1 ether}(taskId);

        vm.prank(poster);
        escrow.selectWinner(taskId, agent);

        vm.prank(agent);
        escrow.submitTask(taskId);

        uint256 treasuryBalanceBefore = treasury.balance;
        uint256 agentBalanceBefore = agent.balance;

        vm.prank(poster);
        escrow.releasePayout(taskId);

        assertGt(agent.balance, agentBalanceBefore);
        assertGt(treasury.balance, treasuryBalanceBefore);
    }
}
