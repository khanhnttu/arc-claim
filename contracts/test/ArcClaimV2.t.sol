// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ArcClaimV2} from "../src/ArcClaimV2.sol";
import {FeeOnTransferToken, ReentrantToken, TestUSDC} from "./utils/TestTokens.sol";

contract ArcClaimV2Test is Test {
    ArcClaimV2 internal arc;
    TestUSDC internal usdc;

    address internal sender = makeAddr("sender");
    address internal recipient = makeAddr("recipient");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant AMOUNT = 100e6;
    uint256 internal constant START = 1_000_000e6;
    uint256 internal constant NEVER = 0;
    uint256 internal expiry;

    event PaymentCreated(
        bytes32 indexed paymentId, address indexed sender, address indexed recipient, uint256 amount, uint256 expiry
    );
    event PaymentClaimed(bytes32 indexed paymentId, address indexed recipient, uint256 amount);
    event PaymentCancelled(bytes32 indexed paymentId, address indexed sender, uint256 amount);
    event PaymentRefunded(bytes32 indexed paymentId, address indexed sender, uint256 amount);

    function setUp() public {
        vm.warp(1_700_000_000);
        usdc = new TestUSDC();
        arc = new ArcClaimV2(address(usdc));
        expiry = block.timestamp + 1 days;

        usdc.mint(sender, START);
        vm.prank(sender);
        usdc.approve(address(arc), type(uint256).max);
    }

    function _create(uint256 exp) internal returns (bytes32) {
        vm.prank(sender);
        return arc.createPayment(recipient, AMOUNT, exp);
    }

    function _status(bytes32 id) internal view returns (ArcClaimV2.PaymentStatus) {
        return arc.getPayment(id).status;
    }

    function _assertStatus(bytes32 id, ArcClaimV2.PaymentStatus s) internal view {
        assertEq(uint8(_status(id)), uint8(s));
    }

    // ------------------------------------------------------------------
    // Constructor / ids
    // ------------------------------------------------------------------

    function test_Constructor() public {
        assertEq(address(arc.usdc()), address(usdc));
        vm.expectRevert(ArcClaimV2.InvalidToken.selector);
        new ArcClaimV2(address(0));
    }

    function test_PaymentIds_UniqueAndDeterministic() public {
        bytes32 a = _create(expiry);
        bytes32 b = _create(NEVER);
        assertTrue(a != b);
        assertEq(a, keccak256(abi.encode(block.chainid, address(arc), uint256(1))));
        assertEq(b, arc.paymentIdAt(2));
        assertEq(arc.paymentCount(), 2);
    }

    // ------------------------------------------------------------------
    // Create
    // ------------------------------------------------------------------

    function test_Create_Normal() public {
        bytes32 id = _create(expiry);
        ArcClaimV2.Payment memory p = arc.getPayment(id);
        assertEq(p.sender, sender);
        assertEq(p.recipient, recipient);
        assertEq(p.amount, AMOUNT);
        assertEq(p.expiry, expiry);
        _assertStatus(id, ArcClaimV2.PaymentStatus.FUNDED);
        assertEq(usdc.balanceOf(address(arc)), AMOUNT);
        assertEq(usdc.balanceOf(sender), START - AMOUNT);
    }

    function test_Create_NeverExpire() public {
        bytes32 id = _create(NEVER);
        assertEq(arc.getPayment(id).expiry, 0);
        _assertStatus(id, ArcClaimV2.PaymentStatus.FUNDED);
        assertEq(usdc.balanceOf(address(arc)), AMOUNT);
    }

    function test_Create_EmitsEvent() public {
        vm.expectEmit(true, true, true, true, address(arc));
        emit PaymentCreated(arc.paymentIdAt(1), sender, recipient, AMOUNT, NEVER);
        _create(NEVER);
    }

    function test_Create_RevertsOnZeroRecipient() public {
        vm.prank(sender);
        vm.expectRevert(ArcClaimV2.InvalidRecipient.selector);
        arc.createPayment(address(0), AMOUNT, expiry);
    }

    function test_Create_RevertsOnContractAsRecipient() public {
        vm.prank(sender);
        vm.expectRevert(ArcClaimV2.InvalidRecipient.selector);
        arc.createPayment(address(arc), AMOUNT, expiry);
    }

    function test_Create_RevertsOnZeroAmount() public {
        vm.prank(sender);
        vm.expectRevert(ArcClaimV2.InvalidAmount.selector);
        arc.createPayment(recipient, 0, expiry);
    }

    function test_Create_RevertsOnPastOrCurrentExpiry() public {
        vm.startPrank(sender);
        vm.expectRevert(ArcClaimV2.InvalidExpiry.selector);
        arc.createPayment(recipient, AMOUNT, block.timestamp);
        vm.expectRevert(ArcClaimV2.InvalidExpiry.selector);
        arc.createPayment(recipient, AMOUNT, 1);
        vm.stopPrank();
    }

    function test_Create_RevertsWithoutApproval() public {
        vm.prank(sender);
        usdc.approve(address(arc), AMOUNT - 1);
        vm.prank(sender);
        vm.expectRevert();
        arc.createPayment(recipient, AMOUNT, expiry);
    }

    function test_Create_RevertsOnFeeOnTransferToken() public {
        FeeOnTransferToken fee = new FeeOnTransferToken();
        ArcClaimV2 feeArc = new ArcClaimV2(address(fee));
        fee.mint(sender, AMOUNT);
        vm.startPrank(sender);
        fee.approve(address(feeArc), AMOUNT);
        vm.expectRevert(ArcClaimV2.TransferAmountMismatch.selector);
        feeArc.createPayment(recipient, AMOUNT, NEVER);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // Claim
    // ------------------------------------------------------------------

    function test_Claim_Normal() public {
        bytes32 id = _create(expiry);
        vm.expectEmit(true, true, true, true, address(arc));
        emit PaymentClaimed(id, recipient, AMOUNT);
        vm.prank(recipient);
        arc.claim(id);

        _assertStatus(id, ArcClaimV2.PaymentStatus.CLAIMED);
        assertEq(usdc.balanceOf(recipient), AMOUNT);
        assertEq(usdc.balanceOf(address(arc)), 0);
    }

    function test_Claim_NeverExpire_YearsLater() public {
        bytes32 id = _create(NEVER);
        vm.warp(block.timestamp + 50 * 365 days);
        vm.prank(recipient);
        arc.claim(id);
        _assertStatus(id, ArcClaimV2.PaymentStatus.CLAIMED);
        assertEq(usdc.balanceOf(recipient), AMOUNT);
    }

    function test_Claim_RevertsAfterExpiry() public {
        bytes32 id = _create(expiry);
        vm.warp(expiry);
        vm.prank(recipient);
        vm.expectRevert(ArcClaimV2.PaymentExpired.selector);
        arc.claim(id);
    }

    function test_Claim_RevertsForUnauthorized() public {
        bytes32 id = _create(NEVER);
        vm.prank(stranger);
        vm.expectRevert(ArcClaimV2.NotRecipient.selector);
        arc.claim(id);
        vm.prank(sender);
        vm.expectRevert(ArcClaimV2.NotRecipient.selector);
        arc.claim(id);
    }

    function test_Claim_RevertsTwice() public {
        bytes32 id = _create(NEVER);
        vm.startPrank(recipient);
        arc.claim(id);
        vm.expectRevert(ArcClaimV2.InvalidStatus.selector);
        arc.claim(id);
        vm.stopPrank();
    }

    function test_Claim_RevertsAfterCancelOrRefund() public {
        bytes32 a = _create(NEVER);
        vm.prank(sender);
        arc.cancel(a);
        vm.prank(recipient);
        vm.expectRevert(ArcClaimV2.InvalidStatus.selector);
        arc.claim(a);

        bytes32 b = _create(expiry);
        vm.warp(expiry);
        arc.refundExpired(b);
        vm.prank(recipient);
        vm.expectRevert(ArcClaimV2.InvalidStatus.selector);
        arc.claim(b);
    }

    function test_Claim_RevertsForUnknownId() public {
        vm.prank(recipient);
        vm.expectRevert(ArcClaimV2.PaymentNotFound.selector);
        arc.claim(keccak256("nope"));
    }

    // ------------------------------------------------------------------
    // Cancel
    // ------------------------------------------------------------------

    function test_Cancel_Normal() public {
        bytes32 id = _create(expiry);
        vm.expectEmit(true, true, true, true, address(arc));
        emit PaymentCancelled(id, sender, AMOUNT);
        vm.prank(sender);
        arc.cancel(id);

        _assertStatus(id, ArcClaimV2.PaymentStatus.CANCELLED);
        assertEq(usdc.balanceOf(sender), START);
        assertEq(usdc.balanceOf(address(arc)), 0);
    }

    function test_Cancel_NeverExpire_YearsLater() public {
        bytes32 id = _create(NEVER);
        vm.warp(block.timestamp + 50 * 365 days);
        vm.prank(sender);
        arc.cancel(id);
        _assertStatus(id, ArcClaimV2.PaymentStatus.CANCELLED);
        assertEq(usdc.balanceOf(sender), START);
    }

    function test_Cancel_RevertsAfterExpiry() public {
        bytes32 id = _create(expiry);
        vm.warp(expiry);
        vm.prank(sender);
        vm.expectRevert(ArcClaimV2.PaymentExpired.selector);
        arc.cancel(id);
    }

    function test_Cancel_RevertsForUnauthorized() public {
        bytes32 id = _create(NEVER);
        vm.prank(stranger);
        vm.expectRevert(ArcClaimV2.NotSender.selector);
        arc.cancel(id);
        vm.prank(recipient);
        vm.expectRevert(ArcClaimV2.NotSender.selector);
        arc.cancel(id);
    }

    function test_Cancel_RevertsTwice() public {
        bytes32 id = _create(NEVER);
        vm.startPrank(sender);
        arc.cancel(id);
        vm.expectRevert(ArcClaimV2.InvalidStatus.selector);
        arc.cancel(id);
        vm.stopPrank();
    }

    function test_Cancel_RevertsAfterClaim() public {
        bytes32 id = _create(NEVER);
        vm.prank(recipient);
        arc.claim(id);
        vm.prank(sender);
        vm.expectRevert(ArcClaimV2.InvalidStatus.selector);
        arc.cancel(id);
    }

    // ------------------------------------------------------------------
    // Expired refund
    // ------------------------------------------------------------------

    function test_RefundExpired_ByThirdPartyPaysSender() public {
        bytes32 id = _create(expiry);
        vm.warp(expiry);
        vm.expectEmit(true, true, true, true, address(arc));
        emit PaymentRefunded(id, sender, AMOUNT);
        vm.prank(stranger);
        arc.refundExpired(id);

        _assertStatus(id, ArcClaimV2.PaymentStatus.REFUNDED);
        assertEq(usdc.balanceOf(sender), START);
        assertEq(usdc.balanceOf(stranger), 0);
        assertEq(usdc.balanceOf(address(arc)), 0);
    }

    function test_RefundExpired_BySender() public {
        bytes32 id = _create(expiry);
        vm.warp(expiry + 1);
        vm.prank(sender);
        arc.refundExpired(id);
        assertEq(usdc.balanceOf(sender), START);
    }

    function test_RefundExpired_RevertsBeforeExpiry() public {
        bytes32 id = _create(expiry);
        vm.warp(expiry - 1);
        vm.expectRevert(ArcClaimV2.PaymentNotExpired.selector);
        arc.refundExpired(id);
    }

    function test_RefundExpired_NeverExpireCannotRefund() public {
        bytes32 id = _create(NEVER);
        vm.expectRevert(ArcClaimV2.NeverExpires.selector);
        arc.refundExpired(id);

        vm.warp(type(uint64).max);
        vm.prank(sender);
        vm.expectRevert(ArcClaimV2.NeverExpires.selector);
        arc.refundExpired(id);

        _assertStatus(id, ArcClaimV2.PaymentStatus.FUNDED);
        assertEq(usdc.balanceOf(address(arc)), AMOUNT);
    }

    function test_RefundExpired_RevertsTwice() public {
        bytes32 id = _create(expiry);
        vm.warp(expiry);
        arc.refundExpired(id);
        vm.expectRevert(ArcClaimV2.InvalidStatus.selector);
        arc.refundExpired(id);
    }

    function test_RefundExpired_RevertsAfterClaimOrCancel() public {
        bytes32 a = _create(expiry);
        bytes32 b = _create(expiry);
        vm.prank(recipient);
        arc.claim(a);
        vm.prank(sender);
        arc.cancel(b);
        vm.warp(expiry);
        vm.expectRevert(ArcClaimV2.InvalidStatus.selector);
        arc.refundExpired(a);
        vm.expectRevert(ArcClaimV2.InvalidStatus.selector);
        arc.refundExpired(b);
    }

    // ------------------------------------------------------------------
    // Resend = a brand-new payment; the old one is untouched
    // ------------------------------------------------------------------

    function test_Resend_CreatesNewPaymentAndLeavesOldImmutable() public {
        bytes32 old = _create(expiry);
        vm.warp(expiry);
        arc.refundExpired(old);

        bytes32 fresh = _create(NEVER);
        assertTrue(fresh != old);
        _assertStatus(old, ArcClaimV2.PaymentStatus.REFUNDED);
        _assertStatus(fresh, ArcClaimV2.PaymentStatus.FUNDED);

        vm.prank(recipient);
        vm.expectRevert(ArcClaimV2.InvalidStatus.selector);
        arc.claim(old);
        vm.prank(recipient);
        arc.claim(fresh);
        assertEq(usdc.balanceOf(recipient), AMOUNT);
    }

    // ------------------------------------------------------------------
    // Reentrancy
    // ------------------------------------------------------------------

    function test_Reentrancy_ClaimCannotReenter() public {
        ReentrantToken token = new ReentrantToken();
        ArcClaimV2 rArc = new ArcClaimV2(address(token));
        token.mint(sender, 2 * AMOUNT);
        vm.startPrank(sender);
        token.approve(address(rArc), type(uint256).max);
        bytes32 a = rArc.createPayment(recipient, AMOUNT, NEVER);
        rArc.createPayment(recipient, AMOUNT, NEVER);
        vm.stopPrank();

        // While paying out `a`, the token tries to claim `a` again through the contract.
        token.arm(address(rArc), abi.encodeCall(ArcClaimV2.claim, (a)));
        vm.prank(recipient);
        rArc.claim(a);

        assertTrue(token.attempted());
        assertFalse(token.reentrySucceeded());
        assertEq(token.balanceOf(recipient), AMOUNT);
        assertEq(token.balanceOf(address(rArc)), AMOUNT);
    }

    // ------------------------------------------------------------------
    // Fuzz
    // ------------------------------------------------------------------

    function testFuzz_NeverExpire_ClaimableAnyTime(uint256 amount, uint64 laterBy) public {
        amount = bound(amount, 1, START);
        vm.prank(sender);
        bytes32 id = arc.createPayment(recipient, amount, NEVER);
        vm.warp(block.timestamp + laterBy);

        vm.expectRevert(ArcClaimV2.NeverExpires.selector);
        arc.refundExpired(id);

        vm.prank(recipient);
        arc.claim(id);
        assertEq(usdc.balanceOf(recipient), amount);
        assertEq(usdc.balanceOf(address(arc)), 0);
    }

    function testFuzz_Expiring_ClaimWindow(uint256 duration, uint256 at) public {
        duration = bound(duration, 1, 3650 days);
        at = bound(at, 0, 2 * duration);
        uint256 start = block.timestamp;
        uint256 exp = start + duration;
        bytes32 id = _create(exp);
        uint256 t = start + at;
        vm.warp(t);

        if (t < exp) {
            vm.expectRevert(ArcClaimV2.PaymentNotExpired.selector);
            arc.refundExpired(id);
            vm.prank(recipient);
            arc.claim(id);
            assertEq(usdc.balanceOf(recipient), AMOUNT);
        } else {
            vm.prank(recipient);
            vm.expectRevert(ArcClaimV2.PaymentExpired.selector);
            arc.claim(id);
            vm.prank(stranger);
            arc.refundExpired(id);
            assertEq(usdc.balanceOf(sender), START);
        }
        assertEq(usdc.balanceOf(address(arc)), 0);
    }

    function testFuzz_OnlyRecipientClaims_OnlySenderCancels(address caller) public {
        vm.assume(caller != recipient && caller != sender);
        bytes32 id = _create(NEVER);
        vm.startPrank(caller);
        vm.expectRevert(ArcClaimV2.NotRecipient.selector);
        arc.claim(id);
        vm.expectRevert(ArcClaimV2.NotSender.selector);
        arc.cancel(id);
        vm.stopPrank();
    }
}
