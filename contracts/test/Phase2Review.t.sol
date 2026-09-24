// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ArcClaimBatch} from "../src/ArcClaimBatch.sol";
import {ArcClaimV2} from "../src/ArcClaimV2.sol";
import {ReentrantToken, TestUSDC} from "./utils/TestTokens.sol";

/// @notice Pre-deployment security & accounting review of ArcClaimBatch.
///         Numbers in test names refer to the review checklist.
contract BatchReviewTest is Test {
    ArcClaimBatch internal batch;
    TestUSDC internal usdc;

    address internal sender = makeAddr("sender");
    address internal a = makeAddr("A");
    address internal b = makeAddr("B");
    address internal c = makeAddr("C");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant START = 1_000_000e6;
    uint256 internal expiry;

    function setUp() public {
        vm.warp(1_700_000_000);
        usdc = new TestUSDC();
        batch = new ArcClaimBatch(address(usdc));
        expiry = block.timestamp + 1 days;
        usdc.mint(sender, START);
        // Deliberately no standing approval: every test approves exactly what it needs.
    }

    // ------------------------------------------------------------------ helpers

    function _abc() internal view returns (address[] memory r, uint256[] memory amt) {
        r = new address[](3);
        amt = new uint256[](3);
        (r[0], r[1], r[2]) = (a, b, c);
        (amt[0], amt[1], amt[2]) = (20e6, 30e6, 50e6);
    }

    function _create(address[] memory r, uint256[] memory amt, uint256 exp) internal returns (bytes32 id) {
        uint256 total;
        for (uint256 i; i < amt.length; ++i) {
            total += amt[i];
        }
        vm.startPrank(sender);
        usdc.approve(address(batch), total); // exact amount
        id = batch.createBatch(r, amt, exp);
        vm.stopPrank();
    }

    function _createAbc(uint256 exp) internal returns (bytes32) {
        (address[] memory r, uint256[] memory amt) = _abc();
        return _create(r, amt, exp);
    }

    function _status(bytes32 id, address who) internal view returns (ArcClaimBatch.AllocationStatus s) {
        (, s) = batch.getAllocation(id, who);
    }

    function _claim(bytes32 id, address who) internal {
        vm.prank(who);
        batch.claim(id);
    }

    function _people(uint256 n) internal pure returns (address[] memory r, uint256[] memory amt) {
        r = new address[](n);
        amt = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            r[i] = address(uint160(0xBEEF00 + i));
            amt[i] = (i + 1) * 1e6;
        }
    }

    // ------------------------------------------------------------------ 1. total deposited == Σ allocations

    /// Random rows split across createBatch + addAllocations: the stored total, the sum of every allocation,
    /// the USDC pulled from the sender and the contract's balance must all be equal.
    function testFuzz_1_TotalDepositedEqualsSumOfAllocations(uint256 seed, uint8 n, uint8 split) public {
        n = uint8(bound(n, 1, 80));
        split = uint8(bound(split, 1, n));
        address[] memory r = new address[](n);
        uint256[] memory amt = new uint256[](n);
        uint256 expected;
        for (uint256 i; i < n; ++i) {
            r[i] = address(uint160(uint256(keccak256(abi.encode(seed, i)))) | 1);
            amt[i] = bound(uint256(keccak256(abi.encode(seed, i, "a"))), 1, 10_000e6);
            expected += amt[i];
        }
        vm.assume(expected <= START);

        (address[] memory r1, uint256[] memory a1) = _slice(r, amt, 0, split);
        bytes32 id = _create(r1, a1, expiry);
        if (split < n) {
            (address[] memory r2, uint256[] memory a2) = _slice(r, amt, split, n);
            uint256 rest;
            for (uint256 i; i < a2.length; ++i) {
                rest += a2[i];
            }
            vm.startPrank(sender);
            usdc.approve(address(batch), rest);
            batch.addAllocations(id, r2, a2);
            vm.stopPrank();
        }

        (uint256[] memory stored,) = batch.getAllocations(id, r);
        uint256 sum;
        for (uint256 i; i < n; ++i) {
            assertEq(stored[i], amt[i], "allocation amount");
            sum += stored[i];
        }
        ArcClaimBatch.Batch memory bt = batch.getBatch(id);
        assertEq(bt.totalAmount, expected, "stored total");
        assertEq(sum, expected, "sum of allocations");
        assertEq(bt.recipientCount, n);
        assertEq(START - usdc.balanceOf(sender), expected, "pulled from sender");
        assertEq(usdc.balanceOf(address(batch)), expected, "held by contract");
        assertEq(usdc.allowance(sender, address(batch)), 0, "exact approval fully used");
    }

    function _slice(address[] memory r, uint256[] memory amt, uint256 from, uint256 to)
        internal
        pure
        returns (address[] memory rs, uint256[] memory as_)
    {
        rs = new address[](to - from);
        as_ = new uint256[](to - from);
        for (uint256 i = from; i < to; ++i) {
            rs[i - from] = r[i];
            as_[i - from] = amt[i];
        }
    }

    // ------------------------------------------------------------------ 2. partial claim A20 B30 C50

    function test_2_PartialClaim_ABC_RefundsExactly50() public {
        bytes32 id = _createAbc(expiry);
        _claim(id, a);
        _claim(id, b);

        assertEq(usdc.balanceOf(a), 20e6, "A receives 20");
        assertEq(usdc.balanceOf(b), 30e6, "B receives 30");
        ArcClaimBatch.Batch memory bt = batch.getBatch(id);
        assertEq(bt.totalAmount - bt.claimedAmount, 50e6, "only 50 refundable");
        assertEq(usdc.balanceOf(address(batch)), 50e6);

        vm.warp(expiry);
        vm.prank(stranger);
        batch.refundExpired(id);

        assertEq(batch.getBatch(id).returnedAmount, 50e6, "refund is 50, never 100");
        assertEq(usdc.balanceOf(sender), START - 100e6 + 50e6);
        assertEq(usdc.balanceOf(address(batch)), 0);
        assertEq(usdc.balanceOf(stranger), 0);
        assertEq(uint8(_status(id, a)), uint8(ArcClaimBatch.AllocationStatus.CLAIMED));
        assertEq(uint8(_status(id, b)), uint8(ArcClaimBatch.AllocationStatus.CLAIMED));
        assertEq(uint8(_status(id, c)), uint8(ArcClaimBatch.AllocationStatus.REFUNDED));

        // Nothing further can move: C cannot claim, nobody can refund again.
        vm.prank(c);
        vm.expectRevert(ArcClaimBatch.BatchNotActive.selector);
        batch.claim(id);
        vm.expectRevert(ArcClaimBatch.BatchNotActive.selector);
        batch.refundExpired(id);
    }

    // ------------------------------------------------------------------ 3–5. allocation transitions

    /// 3 + 4: pending -> claimed is final; a later refund does not touch it.
    function test_3_4_ClaimedIsFinal_NeverRefunded() public {
        bytes32 id = _createAbc(expiry);
        assertEq(uint8(_status(id, a)), uint8(ArcClaimBatch.AllocationStatus.FUNDED));
        _claim(id, a);
        assertEq(uint8(_status(id, a)), uint8(ArcClaimBatch.AllocationStatus.CLAIMED));

        vm.warp(expiry);
        batch.refundExpired(id);
        assertEq(uint8(_status(id, a)), uint8(ArcClaimBatch.AllocationStatus.CLAIMED), "stays CLAIMED");
        assertEq(batch.getBatch(id).returnedAmount, 80e6, "A's 20 excluded from refund");
        assertEq(usdc.balanceOf(a), 20e6);
    }

    /// 3 + 5: pending -> refunded is final; the recipient can never claim afterwards.
    function test_3_5_RefundedIsFinal_NeverClaimed() public {
        bytes32 id = _createAbc(expiry);
        vm.warp(expiry);
        batch.refundExpired(id);
        assertEq(uint8(_status(id, c)), uint8(ArcClaimBatch.AllocationStatus.REFUNDED));

        vm.prank(c);
        vm.expectRevert(ArcClaimBatch.BatchNotActive.selector);
        batch.claim(id);
        vm.warp(block.timestamp + 365 days);
        vm.prank(c);
        vm.expectRevert(ArcClaimBatch.BatchNotActive.selector);
        batch.claim(id);
        assertEq(usdc.balanceOf(c), 0);
        assertEq(uint8(_status(id, c)), uint8(ArcClaimBatch.AllocationStatus.REFUNDED));
    }

    /// 3: the only other exit is pending -> cancelled (sender cancel), also final and never claimable.
    function test_3_CancelledIsFinal_NeverClaimed() public {
        bytes32 id = _createAbc(0);
        _claim(id, a);
        vm.prank(sender);
        batch.cancelBatch(id);
        assertEq(uint8(_status(id, a)), uint8(ArcClaimBatch.AllocationStatus.CLAIMED));
        assertEq(uint8(_status(id, b)), uint8(ArcClaimBatch.AllocationStatus.CANCELLED));
        vm.prank(b);
        vm.expectRevert(ArcClaimBatch.BatchNotActive.selector);
        batch.claim(id);
        assertEq(usdc.balanceOf(sender), START - 20e6);
    }

    /// 4: a claimed allocation can never be "refunded twice": double claim reverts, balance unchanged.
    function test_4_DoubleClaimReverts() public {
        bytes32 id = _createAbc(expiry);
        _claim(id, a);
        vm.prank(a);
        vm.expectRevert(ArcClaimBatch.AlreadyClaimed.selector);
        batch.claim(id);
        assertEq(usdc.balanceOf(a), 20e6);
    }

    // ------------------------------------------------------------------ 6. only the designated recipient

    function test_6_OnlyDesignatedRecipientClaims() public {
        bytes32 id = _createAbc(expiry);
        vm.prank(sender);
        vm.expectRevert(ArcClaimBatch.NotRecipient.selector);
        batch.claim(id);
        vm.prank(stranger);
        vm.expectRevert(ArcClaimBatch.NotRecipient.selector);
        batch.claim(id);

        // B claiming only ever pays B's own 30 — never A's or C's allocation.
        _claim(id, b);
        assertEq(usdc.balanceOf(b), 30e6);
        assertEq(uint8(_status(id, a)), uint8(ArcClaimBatch.AllocationStatus.FUNDED));
        assertEq(uint8(_status(id, c)), uint8(ArcClaimBatch.AllocationStatus.FUNDED));
    }

    function testFuzz_6_NonRecipientCannotClaim(address caller) public {
        vm.assume(caller != a && caller != b && caller != c);
        bytes32 id = _createAbc(expiry);
        vm.prank(caller);
        vm.expectRevert(ArcClaimBatch.NotRecipient.selector);
        batch.claim(id);
        assertEq(usdc.balanceOf(address(batch)), 100e6);
    }

    // ------------------------------------------------------------------ 7. anyone refunds, sender receives

    function testFuzz_7_AnyoneRefunds_FundsAlwaysToSender(address caller) public {
        vm.assume(caller != sender && caller != address(batch) && caller != address(0));
        bytes32 id = _createAbc(expiry);
        _claim(id, a);
        uint256 callerBefore = usdc.balanceOf(caller);
        vm.warp(expiry);
        vm.prank(caller);
        batch.refundExpired(id);
        assertEq(usdc.balanceOf(caller), callerBefore, "caller gets nothing");
        assertEq(usdc.balanceOf(sender), START - 20e6, "sender gets the 80 unclaimed");
    }

    // ------------------------------------------------------------------ 8. expiry boundary

    function test_8_Boundary_BeforeExpiry() public {
        bytes32 id = _createAbc(expiry);
        vm.warp(expiry - 1); // block.timestamp < expiry
        _claim(id, a); // claim allowed
        vm.expectRevert(ArcClaimBatch.BatchNotExpired.selector);
        batch.refundExpired(id); // refund not yet
        vm.prank(sender);
        batch.cancelBatch(id); // cancel allowed
    }

    function test_8_Boundary_AtExpiry() public {
        bytes32 id = _createAbc(expiry);
        vm.warp(expiry); // block.timestamp == expiry: already expired
        vm.prank(a);
        vm.expectRevert(ArcClaimBatch.BatchExpired.selector);
        batch.claim(id);
        vm.prank(sender);
        vm.expectRevert(ArcClaimBatch.BatchExpired.selector);
        batch.cancelBatch(id);
        (address[] memory r, uint256[] memory amt) = _people(1);
        vm.prank(sender);
        vm.expectRevert(ArcClaimBatch.BatchExpired.selector);
        batch.addAllocations(id, r, amt);
        batch.refundExpired(id); // refund allowed exactly at expiry
        assertEq(usdc.balanceOf(sender), START);
    }

    function test_8_Boundary_AfterExpiry() public {
        bytes32 id = _createAbc(expiry);
        vm.warp(expiry + 1);
        vm.prank(a);
        vm.expectRevert(ArcClaimBatch.BatchExpired.selector);
        batch.claim(id);
        vm.prank(sender);
        vm.expectRevert(ArcClaimBatch.BatchExpired.selector);
        batch.cancelBatch(id);
        batch.refundExpired(id);
        assertEq(usdc.balanceOf(sender), START);
    }

    /// For any time t: exactly one of {claim/cancel window, refund window} is open — no gap, no overlap.
    function testFuzz_8_WindowsPartitionTime(uint256 t) public {
        bytes32 id = _createAbc(expiry);
        t = bound(t, block.timestamp, expiry + 10 days);
        vm.warp(t);
        if (t < expiry) {
            vm.expectRevert(ArcClaimBatch.BatchNotExpired.selector);
            batch.refundExpired(id);
            _claim(id, c);
            assertEq(usdc.balanceOf(c), 50e6);
        } else {
            vm.prank(c);
            vm.expectRevert(ArcClaimBatch.BatchExpired.selector);
            batch.claim(id);
            batch.refundExpired(id);
            assertEq(usdc.balanceOf(sender), START);
        }
    }

    // ------------------------------------------------------------------ 9. never expire

    function test_9_NeverExpire_ClaimFarFuture_CancelOk_RefundImpossible() public {
        bytes32 id = _createAbc(0);
        vm.warp(block.timestamp + 100 * 365 days);
        _claim(id, a);
        assertEq(usdc.balanceOf(a), 20e6);

        vm.expectRevert(ArcClaimBatch.NeverExpires.selector);
        batch.refundExpired(id);
        vm.warp(type(uint64).max);
        vm.prank(sender);
        vm.expectRevert(ArcClaimBatch.NeverExpires.selector);
        batch.refundExpired(id);

        vm.prank(stranger);
        vm.expectRevert(ArcClaimBatch.NotSender.selector);
        batch.cancelBatch(id);
        vm.prank(sender);
        batch.cancelBatch(id);
        assertEq(usdc.balanceOf(sender), START - 20e6);
        assertEq(usdc.balanceOf(address(batch)), 0);
    }

    // ------------------------------------------------------------------ 10. input validation (no state change on revert)

    function _expectCreateRevert(address[] memory r, uint256[] memory amt, uint256 exp, bytes memory err) internal {
        uint256 countBefore = batch.batchCount();
        vm.startPrank(sender);
        usdc.approve(address(batch), type(uint256).max);
        vm.expectRevert(err);
        batch.createBatch(r, amt, exp);
        vm.stopPrank();
        assertEq(batch.batchCount(), countBefore, "no batch recorded");
        assertEq(usdc.balanceOf(sender), START, "no funds moved");
    }

    function test_10_Validation() public {
        (address[] memory r, uint256[] memory amt) = _abc();

        // lengths
        _expectCreateRevert(r, new uint256[](2), expiry, abi.encodeWithSelector(ArcClaimBatch.LengthMismatch.selector));
        _expectCreateRevert(
            new address[](2), amt, expiry, abi.encodeWithSelector(ArcClaimBatch.LengthMismatch.selector)
        );
        _expectCreateRevert(
            new address[](0), new uint256[](0), expiry, abi.encodeWithSelector(ArcClaimBatch.EmptyBatch.selector)
        );

        // zero recipient
        address[] memory r0 = new address[](3);
        (r0[0], r0[1], r0[2]) = (a, address(0), c);
        _expectCreateRevert(r0, amt, expiry, abi.encodeWithSelector(ArcClaimBatch.InvalidRecipient.selector, 1));

        // zero amount (also rules out a zero total: every row must be > 0)
        uint256[] memory a0 = new uint256[](3);
        (a0[0], a0[1], a0[2]) = (20e6, 30e6, 0);
        _expectCreateRevert(r, a0, expiry, abi.encodeWithSelector(ArcClaimBatch.InvalidAmount.selector, 2));
        (address[] memory one, uint256[] memory zero) = _people(1);
        zero[0] = 0;
        _expectCreateRevert(one, zero, expiry, abi.encodeWithSelector(ArcClaimBatch.InvalidAmount.selector, 0));

        // duplicates (exact and in the same call)
        address[] memory rd = new address[](3);
        (rd[0], rd[1], rd[2]) = (a, b, a);
        _expectCreateRevert(rd, amt, expiry, abi.encodeWithSelector(ArcClaimBatch.DuplicateRecipient.selector, a));

        // expiry
        _expectCreateRevert(r, amt, block.timestamp, abi.encodeWithSelector(ArcClaimBatch.InvalidExpiry.selector));
        _expectCreateRevert(r, amt, block.timestamp - 1, abi.encodeWithSelector(ArcClaimBatch.InvalidExpiry.selector));
    }

    function test_10_DuplicateAcrossChunksRejected_NoStateChange() public {
        bytes32 id = _createAbc(expiry);
        address[] memory r = new address[](2);
        uint256[] memory amt = new uint256[](2);
        (r[0], r[1]) = (stranger, b); // b already has an allocation
        (amt[0], amt[1]) = (1e6, 1e6);
        vm.startPrank(sender);
        usdc.approve(address(batch), 2e6);
        vm.expectRevert(abi.encodeWithSelector(ArcClaimBatch.DuplicateRecipient.selector, b));
        batch.addAllocations(id, r, amt);
        vm.stopPrank();
        assertEq(batch.getBatch(id).totalAmount, 100e6);
        assertEq(batch.getBatch(id).recipientCount, 3);
        assertEq(uint8(_status(id, stranger)), uint8(ArcClaimBatch.AllocationStatus.NONE));
    }

    // ------------------------------------------------------------------ 11. approval / exact transfer

    function test_11_ExactApprovalSucceeds_AllowanceConsumed() public {
        bytes32 id = _createAbc(expiry); // approves exactly 100
        assertEq(usdc.allowance(sender, address(batch)), 0);
        assertEq(usdc.balanceOf(address(batch)), 100e6);
        assertEq(batch.getBatch(id).totalAmount, 100e6);
    }

    function test_11_ApprovalOneUnitShortReverts() public {
        (address[] memory r, uint256[] memory amt) = _abc();
        vm.startPrank(sender);
        usdc.approve(address(batch), 100e6 - 1);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(batch), 100e6 - 1, 100e6)
        );
        batch.createBatch(r, amt, expiry);
        vm.stopPrank();
        assertEq(batch.batchCount(), 0);
        assertEq(usdc.balanceOf(sender), START);
    }

    function test_11_InsufficientBalanceReverts() public {
        (address[] memory r, uint256[] memory amt) = _abc();
        vm.startPrank(stranger); // has no USDC
        usdc.approve(address(batch), 100e6);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, stranger, 0, 100e6));
        batch.createBatch(r, amt, expiry);
        vm.stopPrank();
    }

    function test_11_PullsExactlyTheOnChainSum_NotMore() public {
        (address[] memory r, uint256[] memory amt) = _abc();
        vm.startPrank(sender);
        usdc.approve(address(batch), 1_000e6); // over-approve on purpose
        batch.createBatch(r, amt, expiry);
        vm.stopPrank();
        assertEq(START - usdc.balanceOf(sender), 100e6, "pulled exactly the computed sum");
        assertEq(usdc.allowance(sender, address(batch)), 900e6);
    }

    // ------------------------------------------------------------------ 12. reentrancy / CEI

    ReentrantToken internal rtoken;
    ArcClaimBatch internal rbatch;

    function _reentrantSetup(uint256 exp) internal returns (bytes32 id) {
        rtoken = new ReentrantToken();
        rbatch = new ArcClaimBatch(address(rtoken));
        rtoken.mint(sender, START);
        (address[] memory r, uint256[] memory amt) = _abc();
        vm.startPrank(sender);
        rtoken.approve(address(rbatch), type(uint256).max);
        id = rbatch.createBatch(r, amt, exp);
        vm.stopPrank();
    }

    function _assertReentryBlocked() internal view {
        assertTrue(rtoken.attempted(), "reentry attempted");
        assertFalse(rtoken.reentrySucceeded(), "reentry blocked");
    }

    function test_12_Reentrancy_ClaimIntoRefund() public {
        bytes32 id = _reentrantSetup(expiry);
        rtoken.arm(address(rbatch), abi.encodeCall(ArcClaimBatch.refundExpired, (id)));
        vm.prank(a);
        rbatch.claim(id);
        _assertReentryBlocked();
        assertEq(rtoken.balanceOf(address(rbatch)), 80e6);
    }

    function test_12_Reentrancy_RefundIntoClaimAndRefund() public {
        bytes32 id = _reentrantSetup(expiry);
        vm.warp(expiry);
        rtoken.arm(address(rbatch), abi.encodeCall(ArcClaimBatch.refundExpired, (id)));
        rbatch.refundExpired(id);
        _assertReentryBlocked();
        assertEq(rtoken.balanceOf(sender), START, "refunded exactly once");
        assertEq(rtoken.balanceOf(address(rbatch)), 0);
    }

    function test_12_Reentrancy_CancelIntoCancel() public {
        bytes32 id = _reentrantSetup(0);
        rtoken.arm(address(rbatch), abi.encodeCall(ArcClaimBatch.cancelBatch, (id)));
        vm.prank(sender);
        rbatch.cancelBatch(id);
        _assertReentryBlocked();
        assertEq(rtoken.balanceOf(sender), START);
    }

    function test_12_Reentrancy_DepositIntoClaim() public {
        bytes32 first = _reentrantSetup(expiry);
        // While createBatch pulls funds, the token tries to claim from an existing batch.
        rtoken.arm(address(rbatch), abi.encodeCall(ArcClaimBatch.claim, (first)));
        (address[] memory r, uint256[] memory amt) = _people(2);
        vm.prank(sender);
        rbatch.createBatch(r, amt, expiry);
        _assertReentryBlocked();
        assertEq(rtoken.balanceOf(address(rbatch)), 100e6 + 3e6);
    }

    // ------------------------------------------------------------------ 13. unauthorized claim / cancel / refund / add

    function test_13_Unauthorized() public {
        bytes32 id = _createAbc(expiry);

        vm.prank(stranger);
        vm.expectRevert(ArcClaimBatch.NotRecipient.selector);
        batch.claim(id);

        vm.prank(a);
        vm.expectRevert(ArcClaimBatch.NotSender.selector);
        batch.cancelBatch(id);
        vm.prank(stranger);
        vm.expectRevert(ArcClaimBatch.NotSender.selector);
        batch.cancelBatch(id);

        // Nobody — not even the sender — can refund before expiry.
        vm.prank(sender);
        vm.expectRevert(ArcClaimBatch.BatchNotExpired.selector);
        batch.refundExpired(id);
        vm.prank(stranger);
        vm.expectRevert(ArcClaimBatch.BatchNotExpired.selector);
        batch.refundExpired(id);

        (address[] memory r, uint256[] memory amt) = _people(1);
        usdc.mint(stranger, 1e6);
        vm.startPrank(stranger);
        usdc.approve(address(batch), 1e6);
        vm.expectRevert(ArcClaimBatch.NotSender.selector);
        batch.addAllocations(id, r, amt);
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(batch)), 100e6);
    }

    // ------------------------------------------------------------------ 14. 0 / 1 / N / mixed

    function _scenario(uint256 claimCount) internal returns (bytes32 id, uint256 claimed, address[] memory r) {
        uint256[] memory amt;
        (r, amt) = _people(5); // 1+2+3+4+5 = 15 USDC
        id = _create(r, amt, expiry);
        for (uint256 i; i < claimCount; ++i) {
            _claim(id, r[i]);
            claimed += amt[i];
        }
    }

    function _assertRefundOutcome(bytes32 id, uint256 claimed, uint256 claimCount, address[] memory r) internal {
        vm.warp(expiry);
        if (claimed == 15e6) {
            vm.expectRevert(ArcClaimBatch.NothingToRefund.selector);
            batch.refundExpired(id);
        } else {
            vm.prank(stranger);
            batch.refundExpired(id);
            assertEq(batch.getBatch(id).returnedAmount, 15e6 - claimed);
        }
        assertEq(usdc.balanceOf(sender), START - claimed, "sender net = -claimed");
        assertEq(usdc.balanceOf(address(batch)), 0, "contract drained exactly");
        for (uint256 i; i < r.length; ++i) {
            ArcClaimBatch.AllocationStatus expected =
                i < claimCount ? ArcClaimBatch.AllocationStatus.CLAIMED : ArcClaimBatch.AllocationStatus.REFUNDED;
            assertEq(uint8(_status(id, r[i])), uint8(expected));
            assertEq(usdc.balanceOf(r[i]), i < claimCount ? (i + 1) * 1e6 : 0);
        }
        assertEq(batch.getBatch(id).claimedCount, claimCount);
    }

    function test_14_ZeroClaimed() public {
        (bytes32 id, uint256 claimed, address[] memory r) = _scenario(0);
        _assertRefundOutcome(id, claimed, 0, r);
    }

    function test_14_OneOfNClaimed() public {
        (bytes32 id, uint256 claimed, address[] memory r) = _scenario(1);
        _assertRefundOutcome(id, claimed, 1, r);
    }

    function test_14_AllClaimed() public {
        (bytes32 id, uint256 claimed, address[] memory r) = _scenario(5);
        _assertRefundOutcome(id, claimed, 5, r);
    }

    function test_14_MixedClaimedAndRefunded() public {
        (bytes32 id, uint256 claimed, address[] memory r) = _scenario(3);
        _assertRefundOutcome(id, claimed, 3, r);
    }
}

/// @notice ArcClaimV2 expiry boundary + never-expire review.
contract V2ReviewTest is Test {
    ArcClaimV2 internal v2;
    TestUSDC internal usdc;
    address internal sender = makeAddr("sender");
    address internal recipient = makeAddr("recipient");
    address internal stranger = makeAddr("stranger");
    uint256 internal expiry;

    function setUp() public {
        vm.warp(1_700_000_000);
        usdc = new TestUSDC();
        v2 = new ArcClaimV2(address(usdc));
        expiry = block.timestamp + 1 days;
        usdc.mint(sender, 100e6);
        vm.prank(sender);
        usdc.approve(address(v2), type(uint256).max);
    }

    function _create(uint256 exp) internal returns (bytes32 id) {
        vm.prank(sender);
        id = v2.createPayment(recipient, 10e6, exp);
    }

    function test_8_V2_BeforeExpiry() public {
        bytes32 p1 = _create(expiry);
        bytes32 p2 = _create(expiry);
        vm.warp(expiry - 1);
        vm.expectRevert(ArcClaimV2.PaymentNotExpired.selector);
        v2.refundExpired(p1);
        vm.prank(recipient);
        v2.claim(p1);
        vm.prank(sender);
        v2.cancel(p2);
    }

    function test_8_V2_AtExpiry() public {
        bytes32 id = _create(expiry);
        vm.warp(expiry);
        vm.prank(recipient);
        vm.expectRevert(ArcClaimV2.PaymentExpired.selector);
        v2.claim(id);
        vm.prank(sender);
        vm.expectRevert(ArcClaimV2.PaymentExpired.selector);
        v2.cancel(id);
        vm.prank(stranger);
        v2.refundExpired(id);
        assertEq(usdc.balanceOf(sender), 100e6);
        assertEq(usdc.balanceOf(stranger), 0);
    }

    function test_8_V2_AfterExpiry() public {
        bytes32 id = _create(expiry);
        vm.warp(expiry + 1);
        vm.prank(recipient);
        vm.expectRevert(ArcClaimV2.PaymentExpired.selector);
        v2.claim(id);
        v2.refundExpired(id);
        assertEq(usdc.balanceOf(sender), 100e6);
    }

    function test_9_V2_NeverExpire() public {
        bytes32 claimLater = _create(0);
        bytes32 cancelLater = _create(0);
        vm.warp(block.timestamp + 100 * 365 days);
        vm.expectRevert(ArcClaimV2.NeverExpires.selector);
        v2.refundExpired(claimLater);
        vm.prank(recipient);
        v2.claim(claimLater);
        vm.prank(sender);
        v2.cancel(cancelLater);
        vm.expectRevert(ArcClaimV2.InvalidStatus.selector);
        v2.refundExpired(cancelLater);
        assertEq(usdc.balanceOf(recipient), 10e6);
        assertEq(usdc.balanceOf(sender), 90e6);
        assertEq(usdc.balanceOf(address(v2)), 0);
    }
}

/// @dev Random V2 operations; ghost totals checked by invariants below.
contract V2Handler is Test {
    ArcClaimV2 public v2;
    TestUSDC public usdc;
    address public sender = address(0x5E4D);
    address public recipient = address(0x2EC1);
    bytes32[] public ids;
    uint256 public funded; // Σ amounts of payments currently FUNDED

    constructor(ArcClaimV2 v2_, TestUSDC usdc_) {
        v2 = v2_;
        usdc = usdc_;
        usdc.mint(sender, type(uint128).max);
        vm.prank(sender);
        usdc.approve(address(v2), type(uint256).max);
    }

    function create(uint256 amount, bool never) external {
        amount = bound(amount, 1, 1_000_000e6);
        vm.prank(sender);
        ids.push(v2.createPayment(recipient, amount, never ? 0 : block.timestamp + 1 days));
        funded += amount;
    }

    function act(uint256 seed, uint8 kind) external {
        if (ids.length == 0) return;
        bytes32 id = ids[seed % ids.length];
        ArcClaimV2.Payment memory p = v2.getPayment(id);
        if (p.status != ArcClaimV2.PaymentStatus.FUNDED) return;
        bool expired = p.expiry != 0 && block.timestamp >= p.expiry;
        kind = kind % 3;
        if (kind == 0 && !expired) {
            vm.prank(recipient);
            v2.claim(id);
        } else if (kind == 1 && !expired) {
            vm.prank(sender);
            v2.cancel(id);
        } else if (kind == 2 && expired) {
            v2.refundExpired(id);
        } else {
            return;
        }
        funded -= p.amount;
    }

    function warp(uint256 by) external {
        vm.warp(block.timestamp + bound(by, 0, 2 days));
    }
}

contract V2InvariantTest is Test {
    ArcClaimV2 internal v2;
    TestUSDC internal usdc;
    V2Handler internal handler;

    function setUp() public {
        vm.warp(1_700_000_000);
        usdc = new TestUSDC();
        v2 = new ArcClaimV2(address(usdc));
        handler = new V2Handler(v2, usdc);
        targetContract(address(handler));
    }

    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 60
    function invariant_V2_BalanceEqualsFundedPayments() public view {
        assertEq(usdc.balanceOf(address(v2)), handler.funded());
    }
}
