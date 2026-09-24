// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ArcClaim} from "../src/ArcClaim.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract ArcClaimTest is Test {
    ArcClaim internal arc;
    MockUSDC internal usdc;

    address internal sender = makeAddr("sender");
    address internal recipient = makeAddr("recipient");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant AMOUNT = 100e6;
    uint256 internal constant START_BALANCE = 1_000_000e6;
    uint256 internal expiry;

    event ClaimCreated(
        uint256 indexed claimId, address indexed sender, address indexed recipient, uint256 amount, uint256 expiry
    );
    event Claimed(uint256 indexed claimId, address indexed recipient, uint256 amount);
    event Cancelled(uint256 indexed claimId, address indexed sender, uint256 amount);
    event ExpiredRefunded(uint256 indexed claimId, address indexed sender, uint256 amount);

    function setUp() public {
        vm.warp(1_700_000_000);
        usdc = new MockUSDC();
        arc = new ArcClaim(address(usdc));
        expiry = block.timestamp + 1 days;

        usdc.mint(sender, START_BALANCE);
        vm.prank(sender);
        usdc.approve(address(arc), type(uint256).max);
    }

    function _create() internal returns (uint256) {
        vm.prank(sender);
        return arc.createClaim(recipient, AMOUNT, expiry);
    }

    function _status(uint256 id) internal view returns (ArcClaim.ClaimStatus) {
        return arc.getClaim(id).status;
    }

    // ---------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------

    function test_Constructor_SetsToken() public view {
        assertEq(address(arc.usdc()), address(usdc));
        assertEq(arc.nextClaimId(), 1);
    }

    function test_Constructor_RevertsOnZeroToken() public {
        vm.expectRevert(ArcClaim.InvalidToken.selector);
        new ArcClaim(address(0));
    }

    // ---------------------------------------------------------------
    // Create + fund
    // ---------------------------------------------------------------

    // 1
    function test_CreateClaim_StoresClaim() public {
        uint256 id = _create();

        ArcClaim.Claim memory c = arc.getClaim(id);
        assertEq(id, 1);
        assertEq(c.sender, sender);
        assertEq(c.recipient, recipient);
        assertEq(c.amount, AMOUNT);
        assertEq(c.expiry, expiry);
        assertEq(uint8(c.status), uint8(ArcClaim.ClaimStatus.FUNDED));
        assertEq(arc.nextClaimId(), 2);
    }

    // 16
    function test_CreateClaim_Balances() public {
        _create();
        assertEq(usdc.balanceOf(sender), START_BALANCE - AMOUNT);
        assertEq(usdc.balanceOf(address(arc)), AMOUNT);
        assertEq(usdc.balanceOf(recipient), 0);
    }

    // 13
    function test_CreateClaim_RevertsOnZeroRecipient() public {
        vm.prank(sender);
        vm.expectRevert(ArcClaim.InvalidRecipient.selector);
        arc.createClaim(address(0), AMOUNT, expiry);
    }

    // 14
    function test_CreateClaim_RevertsOnZeroAmount() public {
        vm.prank(sender);
        vm.expectRevert(ArcClaim.InvalidAmount.selector);
        arc.createClaim(recipient, 0, expiry);
    }

    // 15
    function test_CreateClaim_RevertsOnExpiryNow() public {
        vm.prank(sender);
        vm.expectRevert(ArcClaim.InvalidExpiry.selector);
        arc.createClaim(recipient, AMOUNT, block.timestamp);
    }

    function test_CreateClaim_RevertsOnExpiryInPast() public {
        vm.prank(sender);
        vm.expectRevert(ArcClaim.InvalidExpiry.selector);
        arc.createClaim(recipient, AMOUNT, block.timestamp - 1);
    }

    function test_CreateClaim_RevertsWithoutApproval() public {
        vm.prank(sender);
        usdc.approve(address(arc), AMOUNT - 1);
        vm.prank(sender);
        vm.expectRevert();
        arc.createClaim(recipient, AMOUNT, expiry);
    }

    function test_CreateClaim_RevertsWithInsufficientBalance() public {
        vm.startPrank(stranger);
        usdc.approve(address(arc), AMOUNT);
        vm.expectRevert();
        arc.createClaim(recipient, AMOUNT, expiry);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------
    // Claim
    // ---------------------------------------------------------------

    // 2 + 17
    function test_Claim_ByRecipient() public {
        uint256 id = _create();

        vm.prank(recipient);
        arc.claim(id);

        assertEq(uint8(_status(id)), uint8(ArcClaim.ClaimStatus.CLAIMED));
        assertEq(usdc.balanceOf(recipient), AMOUNT);
        assertEq(usdc.balanceOf(address(arc)), 0);
        assertEq(usdc.balanceOf(sender), START_BALANCE - AMOUNT);
    }

    function test_Claim_JustBeforeExpiry() public {
        uint256 id = _create();
        vm.warp(expiry - 1);
        vm.prank(recipient);
        arc.claim(id);
        assertEq(usdc.balanceOf(recipient), AMOUNT);
    }

    // 3
    function test_Claim_RevertsForUnauthorized() public {
        uint256 id = _create();

        vm.prank(stranger);
        vm.expectRevert(ArcClaim.NotRecipient.selector);
        arc.claim(id);

        vm.prank(sender);
        vm.expectRevert(ArcClaim.NotRecipient.selector);
        arc.claim(id);
    }

    // 8
    function test_Claim_RevertsAfterExpiry() public {
        uint256 id = _create();

        vm.warp(expiry);
        vm.prank(recipient);
        vm.expectRevert(ArcClaim.ClaimExpired.selector);
        arc.claim(id);

        vm.warp(expiry + 365 days);
        vm.prank(recipient);
        vm.expectRevert(ArcClaim.ClaimExpired.selector);
        arc.claim(id);
    }

    // 9
    function test_Claim_RevertsAfterCancel() public {
        uint256 id = _create();
        vm.prank(sender);
        arc.cancel(id);

        vm.prank(recipient);
        vm.expectRevert(ArcClaim.InvalidStatus.selector);
        arc.claim(id);
    }

    // 10
    function test_Claim_RevertsAfterRefund() public {
        uint256 id = _create();
        vm.warp(expiry);
        arc.refundExpired(id);

        vm.prank(recipient);
        vm.expectRevert(ArcClaim.InvalidStatus.selector);
        arc.claim(id);
    }

    // 11
    function test_Claim_RevertsTwice() public {
        uint256 id = _create();
        vm.prank(recipient);
        arc.claim(id);

        vm.prank(recipient);
        vm.expectRevert(ArcClaim.InvalidStatus.selector);
        arc.claim(id);
    }

    function test_Claim_RevertsForUnknownId() public {
        vm.prank(recipient);
        vm.expectRevert(ArcClaim.ClaimNotFound.selector);
        arc.claim(1);
    }

    // ---------------------------------------------------------------
    // Cancel
    // ---------------------------------------------------------------

    // 4 + 18
    function test_Cancel_BySender() public {
        uint256 id = _create();

        vm.prank(sender);
        arc.cancel(id);

        assertEq(uint8(_status(id)), uint8(ArcClaim.ClaimStatus.CANCELLED));
        assertEq(usdc.balanceOf(sender), START_BALANCE);
        assertEq(usdc.balanceOf(address(arc)), 0);
        assertEq(usdc.balanceOf(recipient), 0);
    }

    // 5
    function test_Cancel_RevertsForUnauthorized() public {
        uint256 id = _create();

        vm.prank(stranger);
        vm.expectRevert(ArcClaim.NotSender.selector);
        arc.cancel(id);

        vm.prank(recipient);
        vm.expectRevert(ArcClaim.NotSender.selector);
        arc.cancel(id);
    }

    function test_Cancel_RevertsAfterExpiry() public {
        uint256 id = _create();
        vm.warp(expiry);
        vm.prank(sender);
        vm.expectRevert(ArcClaim.ClaimExpired.selector);
        arc.cancel(id);
    }

    function test_Cancel_RevertsAfterClaim() public {
        uint256 id = _create();
        vm.prank(recipient);
        arc.claim(id);

        vm.prank(sender);
        vm.expectRevert(ArcClaim.InvalidStatus.selector);
        arc.cancel(id);
    }

    function test_Cancel_RevertsTwice() public {
        uint256 id = _create();
        vm.prank(sender);
        arc.cancel(id);

        vm.prank(sender);
        vm.expectRevert(ArcClaim.InvalidStatus.selector);
        arc.cancel(id);
    }

    function test_Cancel_RevertsForUnknownId() public {
        vm.prank(sender);
        vm.expectRevert(ArcClaim.ClaimNotFound.selector);
        arc.cancel(42);
    }

    // ---------------------------------------------------------------
    // Expired refund
    // ---------------------------------------------------------------

    // 6 + 19
    function test_RefundExpired_BySender() public {
        uint256 id = _create();
        vm.warp(expiry);

        vm.prank(sender);
        arc.refundExpired(id);

        assertEq(uint8(_status(id)), uint8(ArcClaim.ClaimStatus.REFUNDED));
        assertEq(usdc.balanceOf(sender), START_BALANCE);
        assertEq(usdc.balanceOf(address(arc)), 0);
        assertEq(usdc.balanceOf(recipient), 0);
    }

    // 7
    function test_RefundExpired_ByAnyoneSendsToSender() public {
        uint256 id = _create();
        vm.warp(expiry + 1);

        vm.prank(stranger);
        arc.refundExpired(id);

        assertEq(usdc.balanceOf(sender), START_BALANCE);
        assertEq(usdc.balanceOf(stranger), 0);
        assertEq(usdc.balanceOf(address(arc)), 0);
    }

    function test_RefundExpired_RevertsBeforeExpiry() public {
        uint256 id = _create();
        vm.warp(expiry - 1);
        vm.expectRevert(ArcClaim.ClaimNotExpired.selector);
        arc.refundExpired(id);
    }

    // 12
    function test_RefundExpired_RevertsTwice() public {
        uint256 id = _create();
        vm.warp(expiry);
        arc.refundExpired(id);

        vm.expectRevert(ArcClaim.InvalidStatus.selector);
        arc.refundExpired(id);
    }

    function test_RefundExpired_RevertsAfterClaim() public {
        uint256 id = _create();
        vm.prank(recipient);
        arc.claim(id);
        vm.warp(expiry);

        vm.expectRevert(ArcClaim.InvalidStatus.selector);
        arc.refundExpired(id);
    }

    function test_RefundExpired_RevertsAfterCancel() public {
        uint256 id = _create();
        vm.prank(sender);
        arc.cancel(id);
        vm.warp(expiry);

        vm.expectRevert(ArcClaim.InvalidStatus.selector);
        arc.refundExpired(id);
    }

    function test_RefundExpired_RevertsForUnknownId() public {
        vm.expectRevert(ArcClaim.ClaimNotFound.selector);
        arc.refundExpired(7);
    }

    // ---------------------------------------------------------------
    // Multiple claims
    // ---------------------------------------------------------------

    // 20 + 21
    function test_MultipleClaims_CoexistWithUniqueIds() public {
        address recipient2 = makeAddr("recipient2");
        address recipient3 = makeAddr("recipient3");

        vm.startPrank(sender);
        uint256 id1 = arc.createClaim(recipient, 10e6, expiry);
        uint256 id2 = arc.createClaim(recipient2, 20e6, expiry + 1 days);
        uint256 id3 = arc.createClaim(recipient3, 30e6, expiry);
        vm.stopPrank();

        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(id3, 3);
        assertEq(usdc.balanceOf(address(arc)), 60e6);

        // Claim #1, cancel #3, let #2 expire and refund.
        vm.prank(recipient);
        arc.claim(id1);
        vm.prank(sender);
        arc.cancel(id3);

        // Claims are isolated: recipient of #1 cannot touch #2.
        vm.prank(recipient);
        vm.expectRevert(ArcClaim.NotRecipient.selector);
        arc.claim(id2);

        assertEq(uint8(_status(id2)), uint8(ArcClaim.ClaimStatus.FUNDED));
        assertEq(usdc.balanceOf(address(arc)), 20e6);

        vm.warp(expiry + 1 days);
        arc.refundExpired(id2);

        assertEq(uint8(_status(id1)), uint8(ArcClaim.ClaimStatus.CLAIMED));
        assertEq(uint8(_status(id2)), uint8(ArcClaim.ClaimStatus.REFUNDED));
        assertEq(uint8(_status(id3)), uint8(ArcClaim.ClaimStatus.CANCELLED));
        assertEq(usdc.balanceOf(recipient), 10e6);
        assertEq(usdc.balanceOf(recipient2), 0);
        assertEq(usdc.balanceOf(sender), START_BALANCE - 10e6);
        assertEq(usdc.balanceOf(address(arc)), 0);
    }

    function test_MultipleSenders_SameRecipient() public {
        address sender2 = makeAddr("sender2");
        usdc.mint(sender2, AMOUNT);
        vm.prank(sender2);
        usdc.approve(address(arc), AMOUNT);

        uint256 id1 = _create();
        vm.prank(sender2);
        uint256 id2 = arc.createClaim(recipient, AMOUNT, expiry);
        assertTrue(id1 != id2);

        // sender cannot cancel sender2's claim
        vm.prank(sender);
        vm.expectRevert(ArcClaim.NotSender.selector);
        arc.cancel(id2);

        vm.startPrank(recipient);
        arc.claim(id1);
        arc.claim(id2);
        vm.stopPrank();

        assertEq(usdc.balanceOf(recipient), 2 * AMOUNT);
        assertEq(usdc.balanceOf(address(arc)), 0);
    }

    // ---------------------------------------------------------------
    // Events (22)
    // ---------------------------------------------------------------

    function test_Event_ClaimCreated() public {
        vm.expectEmit(true, true, true, true, address(arc));
        emit ClaimCreated(1, sender, recipient, AMOUNT, expiry);
        _create();
    }

    function test_Event_Claimed() public {
        uint256 id = _create();
        vm.expectEmit(true, true, true, true, address(arc));
        emit Claimed(id, recipient, AMOUNT);
        vm.prank(recipient);
        arc.claim(id);
    }

    function test_Event_Cancelled() public {
        uint256 id = _create();
        vm.expectEmit(true, true, true, true, address(arc));
        emit Cancelled(id, sender, AMOUNT);
        vm.prank(sender);
        arc.cancel(id);
    }

    function test_Event_ExpiredRefunded() public {
        uint256 id = _create();
        vm.warp(expiry);
        vm.expectEmit(true, true, true, true, address(arc));
        emit ExpiredRefunded(id, sender, AMOUNT);
        vm.prank(stranger);
        arc.refundExpired(id);
    }

    // ---------------------------------------------------------------
    // Fuzz
    // ---------------------------------------------------------------

    function testFuzz_CreateAndClaim(uint256 amount, uint256 duration, uint256 claimAfter) public {
        amount = bound(amount, 1, START_BALANCE);
        duration = bound(duration, 1, 3650 days);
        claimAfter = bound(claimAfter, 0, duration - 1);

        vm.prank(sender);
        uint256 id = arc.createClaim(recipient, amount, block.timestamp + duration);

        vm.warp(block.timestamp + claimAfter);
        vm.prank(recipient);
        arc.claim(id);

        assertEq(usdc.balanceOf(recipient), amount);
        assertEq(usdc.balanceOf(sender), START_BALANCE - amount);
        assertEq(usdc.balanceOf(address(arc)), 0);
    }

    function testFuzz_ClaimAfterExpiryReverts(uint256 amount, uint256 duration, uint256 lateBy) public {
        amount = bound(amount, 1, START_BALANCE);
        duration = bound(duration, 1, 3650 days);
        lateBy = bound(lateBy, 0, 3650 days);

        vm.prank(sender);
        uint256 id = arc.createClaim(recipient, amount, block.timestamp + duration);

        vm.warp(block.timestamp + duration + lateBy);
        vm.prank(recipient);
        vm.expectRevert(ArcClaim.ClaimExpired.selector);
        arc.claim(id);

        arc.refundExpired(id);
        assertEq(usdc.balanceOf(sender), START_BALANCE);
        assertEq(usdc.balanceOf(address(arc)), 0);
    }

    function testFuzz_OnlyRecipientCanClaim(address caller) public {
        vm.assume(caller != recipient);
        uint256 id = _create();

        vm.prank(caller);
        vm.expectRevert(ArcClaim.NotRecipient.selector);
        arc.claim(id);
    }

    function testFuzz_OnlySenderCanCancel(address caller) public {
        vm.assume(caller != sender);
        uint256 id = _create();

        vm.prank(caller);
        vm.expectRevert(ArcClaim.NotSender.selector);
        arc.cancel(id);
    }

    function testFuzz_RefundAlwaysGoesToSender(address caller, uint256 lateBy) public {
        vm.assume(caller != sender && caller != address(arc));
        lateBy = bound(lateBy, 0, 3650 days);
        uint256 id = _create();
        uint256 callerBefore = usdc.balanceOf(caller);

        vm.warp(expiry + lateBy);
        vm.prank(caller);
        arc.refundExpired(id);

        assertEq(usdc.balanceOf(sender), START_BALANCE);
        assertEq(usdc.balanceOf(caller), callerBefore);
    }

    function testFuzz_InvalidExpiryReverts(uint256 badExpiry) public {
        badExpiry = bound(badExpiry, 0, block.timestamp);
        vm.prank(sender);
        vm.expectRevert(ArcClaim.InvalidExpiry.selector);
        arc.createClaim(recipient, AMOUNT, badExpiry);
    }

    /// Contract balance always equals the sum of FUNDED claim amounts, whatever
    /// sequence of settlements happens.
    function testFuzz_ContractHoldsExactlyFundedAmounts(uint96[5] memory amounts, uint8[5] memory actions) public {
        uint256[5] memory ids;
        for (uint256 i; i < 5; i++) {
            uint256 amt = bound(amounts[i], 1, 100_000e6);
            vm.prank(sender);
            ids[i] = arc.createClaim(recipient, amt, expiry);
        }

        // 0 = leave funded, 1 = claim, 2 = cancel
        for (uint256 i; i < 5; i++) {
            uint8 a = actions[i] % 3;
            if (a == 1) {
                vm.prank(recipient);
                arc.claim(ids[i]);
            } else if (a == 2) {
                vm.prank(sender);
                arc.cancel(ids[i]);
            }
        }

        uint256 funded;
        for (uint256 i; i < 5; i++) {
            if (_status(ids[i]) == ArcClaim.ClaimStatus.FUNDED) funded += arc.getClaim(ids[i]).amount;
        }
        assertEq(usdc.balanceOf(address(arc)), funded);

        vm.warp(expiry);
        for (uint256 i; i < 5; i++) {
            if (_status(ids[i]) == ArcClaim.ClaimStatus.FUNDED) arc.refundExpired(ids[i]);
        }
        assertEq(usdc.balanceOf(address(arc)), 0);
        assertEq(usdc.balanceOf(sender) + usdc.balanceOf(recipient), START_BALANCE);
    }
}
