// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ArcClaimBatch} from "../src/ArcClaimBatch.sol";
import {FeeOnTransferToken, ReentrantToken, TestUSDC} from "./utils/TestTokens.sol";

contract ArcClaimBatchTest is Test {
    ArcClaimBatch internal batch;
    TestUSDC internal usdc;

    address internal sender = makeAddr("sender");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal david = makeAddr("david");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant START = 10_000_000e6;
    uint256 internal constant NEVER = 0;
    uint256 internal expiry;

    event BatchCreated(bytes32 indexed batchId, address indexed sender, uint256 expiry);
    event AllocationFunded(bytes32 indexed batchId, address indexed recipient, uint256 amount);
    event AllocationClaimed(bytes32 indexed batchId, address indexed recipient, uint256 amount);
    event BatchRefunded(bytes32 indexed batchId, address indexed sender, uint256 amount);
    event BatchCancelled(bytes32 indexed batchId, address indexed sender, uint256 amount);

    function setUp() public {
        vm.warp(1_700_000_000);
        usdc = new TestUSDC();
        batch = new ArcClaimBatch(address(usdc));
        expiry = block.timestamp + 7 days;

        usdc.mint(sender, START);
        vm.prank(sender);
        usdc.approve(address(batch), type(uint256).max);
    }

    /// Alice 20, Bob 10, Carol 30, David 40 = 100 USDC
    function _abcd() internal view returns (address[] memory r, uint256[] memory a) {
        r = new address[](4);
        a = new uint256[](4);
        (r[0], r[1], r[2], r[3]) = (alice, bob, carol, david);
        (a[0], a[1], a[2], a[3]) = (20e6, 10e6, 30e6, 40e6);
    }

    function _createAbcd(uint256 exp) internal returns (bytes32 id) {
        (address[] memory r, uint256[] memory a) = _abcd();
        vm.prank(sender);
        id = batch.createBatch(r, a, exp);
    }

    function _claim(bytes32 id, address who) internal {
        vm.prank(who);
        batch.claim(id);
    }

    function _alloc(bytes32 id, address who) internal view returns (uint256 amount, ArcClaimBatch.AllocationStatus s) {
        return batch.getAllocation(id, who);
    }

    function _assertAlloc(bytes32 id, address who, ArcClaimBatch.AllocationStatus expected) internal view {
        (, ArcClaimBatch.AllocationStatus s) = _alloc(id, who);
        assertEq(uint8(s), uint8(expected));
    }

    function _one(address r, uint256 a) internal pure returns (address[] memory rs, uint256[] memory as_) {
        rs = new address[](1);
        as_ = new uint256[](1);
        rs[0] = r;
        as_[0] = a;
    }

    // ------------------------------------------------------------------
    // Create
    // ------------------------------------------------------------------

    function test_Create_Batch() public {
        bytes32 id = _createAbcd(expiry);
        ArcClaimBatch.Batch memory b = batch.getBatch(id);

        assertEq(id, batch.batchIdAt(1));
        assertEq(b.sender, sender);
        assertEq(b.expiry, expiry);
        assertEq(uint8(b.status), uint8(ArcClaimBatch.BatchStatus.ACTIVE));
        assertEq(b.recipientCount, 4);
        assertEq(b.claimedCount, 0);
        assertEq(b.claimedAmount, 0);
    }

    function test_Create_CorrectTotalComputedOnChain() public {
        bytes32 id = _createAbcd(expiry);
        assertEq(batch.getBatch(id).totalAmount, 100e6);
        assertEq(usdc.balanceOf(address(batch)), 100e6);
        assertEq(usdc.balanceOf(sender), START - 100e6);
    }

    function test_Create_MultipleRecipientsHaveIndependentAllocations() public {
        bytes32 id = _createAbcd(expiry);
        (address[] memory r, uint256[] memory a) = _abcd();
        for (uint256 i; i < r.length; ++i) {
            (uint256 amount, ArcClaimBatch.AllocationStatus s) = _alloc(id, r[i]);
            assertEq(amount, a[i]);
            assertEq(uint8(s), uint8(ArcClaimBatch.AllocationStatus.FUNDED));
        }
        (uint256 none, ArcClaimBatch.AllocationStatus ns) = _alloc(id, stranger);
        assertEq(none, 0);
        assertEq(uint8(ns), uint8(ArcClaimBatch.AllocationStatus.NONE));
    }

    function test_Create_EmitsEvents() public {
        (address[] memory r, uint256[] memory a) = _abcd();
        bytes32 id = batch.batchIdAt(1);
        vm.expectEmit(true, true, true, true, address(batch));
        emit BatchCreated(id, sender, expiry);
        for (uint256 i; i < r.length; ++i) {
            vm.expectEmit(true, true, true, true, address(batch));
            emit AllocationFunded(id, r[i], a[i]);
        }
        vm.prank(sender);
        batch.createBatch(r, a, expiry);
    }

    function test_Create_BatchIdsUnique() public {
        bytes32 a = _createAbcd(expiry);
        bytes32 b = _createAbcd(NEVER);
        assertTrue(a != b);
        assertEq(batch.batchCount(), 2);
    }

    function test_Create_RevertsOnDuplicateRecipient() public {
        address[] memory r = new address[](3);
        uint256[] memory a = new uint256[](3);
        (r[0], r[1], r[2]) = (alice, bob, alice);
        (a[0], a[1], a[2]) = (1e6, 1e6, 1e6);
        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSelector(ArcClaimBatch.DuplicateRecipient.selector, alice));
        batch.createBatch(r, a, expiry);
    }

    function test_Create_RevertsOnLengthMismatch() public {
        address[] memory r = new address[](2);
        uint256[] memory a = new uint256[](1);
        (r[0], r[1]) = (alice, bob);
        a[0] = 1e6;
        vm.prank(sender);
        vm.expectRevert(ArcClaimBatch.LengthMismatch.selector);
        batch.createBatch(r, a, expiry);
    }

    function test_Create_RevertsOnEmpty() public {
        vm.prank(sender);
        vm.expectRevert(ArcClaimBatch.EmptyBatch.selector);
        batch.createBatch(new address[](0), new uint256[](0), expiry);
    }

    function test_Create_RevertsOnZeroRecipient() public {
        (address[] memory r, uint256[] memory a) = _abcd();
        r[2] = address(0);
        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSelector(ArcClaimBatch.InvalidRecipient.selector, 2));
        batch.createBatch(r, a, expiry);
    }

    function test_Create_RevertsOnContractAsRecipient() public {
        (address[] memory r, uint256[] memory a) = _one(address(batch), 1e6);
        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSelector(ArcClaimBatch.InvalidRecipient.selector, 0));
        batch.createBatch(r, a, expiry);
    }

    function test_Create_RevertsOnZeroAmount() public {
        (address[] memory r, uint256[] memory a) = _abcd();
        a[1] = 0;
        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSelector(ArcClaimBatch.InvalidAmount.selector, 1));
        batch.createBatch(r, a, expiry);
    }

    function test_Create_RevertsOnAmountOverflowingUint128() public {
        (address[] memory r, uint256[] memory a) = _one(alice, uint256(type(uint128).max) + 1);
        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSelector(ArcClaimBatch.InvalidAmount.selector, 0));
        batch.createBatch(r, a, expiry);
    }

    function test_Create_RevertsOnInvalidExpiry() public {
        (address[] memory r, uint256[] memory a) = _abcd();
        vm.startPrank(sender);
        vm.expectRevert(ArcClaimBatch.InvalidExpiry.selector);
        batch.createBatch(r, a, block.timestamp);
        vm.expectRevert(ArcClaimBatch.InvalidExpiry.selector);
        batch.createBatch(r, a, 1);
        vm.stopPrank();
    }

    function test_Create_RevertsOnTooManyRecipients() public {
        uint256 n = batch.MAX_RECIPIENTS_PER_CALL() + 1;
        address[] memory r = new address[](n);
        uint256[] memory a = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            r[i] = address(uint160(0x1000 + i));
            a[i] = 1;
        }
        vm.prank(sender);
        vm.expectRevert(ArcClaimBatch.TooManyRecipients.selector);
        batch.createBatch(r, a, expiry);
    }

    function test_Create_MaxRecipientsFitsInBlock() public {
        uint256 n = batch.MAX_RECIPIENTS_PER_CALL();
        address[] memory r = new address[](n);
        uint256[] memory a = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            r[i] = address(uint160(0x1000 + i));
            a[i] = 1e6;
        }
        vm.prank(sender);
        uint256 gasBefore = gasleft();
        bytes32 id = batch.createBatch(r, a, expiry);
        uint256 used = gasBefore - gasleft();
        emit log_named_uint("gas for MAX_RECIPIENTS_PER_CALL rows", used);
        assertLt(used, 10_000_000, "should use well under Arc's 30M block gas limit");
        assertEq(batch.getBatch(id).totalAmount, n * 1e6);
    }

    function test_Create_RevertsOnFeeOnTransferToken() public {
        FeeOnTransferToken fee = new FeeOnTransferToken();
        ArcClaimBatch feeBatch = new ArcClaimBatch(address(fee));
        fee.mint(sender, 100e6);
        (address[] memory r, uint256[] memory a) = _abcd();
        vm.startPrank(sender);
        fee.approve(address(feeBatch), type(uint256).max);
        vm.expectRevert(ArcClaimBatch.TransferAmountMismatch.selector);
        feeBatch.createBatch(r, a, expiry);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // Add allocations (large airdrops across several transactions)
    // ------------------------------------------------------------------

    function test_AddAllocations_AppendsAndPullsFunds() public {
        (address[] memory r, uint256[] memory a) = _one(alice, 20e6);
        vm.prank(sender);
        bytes32 id = batch.createBatch(r, a, expiry);

        (r, a) = _one(bob, 10e6);
        vm.prank(sender);
        batch.addAllocations(id, r, a);

        ArcClaimBatch.Batch memory b = batch.getBatch(id);
        assertEq(b.totalAmount, 30e6);
        assertEq(b.recipientCount, 2);
        assertEq(usdc.balanceOf(address(batch)), 30e6);
        _claim(id, bob);
        assertEq(usdc.balanceOf(bob), 10e6);
    }

    function test_AddAllocations_RejectsDuplicateAcrossCalls() public {
        bytes32 id = _createAbcd(expiry);
        (address[] memory r, uint256[] memory a) = _one(carol, 5e6);
        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSelector(ArcClaimBatch.DuplicateRecipient.selector, carol));
        batch.addAllocations(id, r, a);
    }

    function test_AddAllocations_OnlySender() public {
        bytes32 id = _createAbcd(expiry);
        usdc.mint(stranger, 5e6);
        (address[] memory r, uint256[] memory a) = _one(stranger, 5e6);
        vm.startPrank(stranger);
        usdc.approve(address(batch), 5e6);
        vm.expectRevert(ArcClaimBatch.NotSender.selector);
        batch.addAllocations(id, r, a);
        vm.stopPrank();
    }

    function test_AddAllocations_RevertsAfterExpiryOrClose() public {
        bytes32 id = _createAbcd(expiry);
        (address[] memory r, uint256[] memory a) = _one(stranger, 5e6);
        vm.warp(expiry);
        vm.prank(sender);
        vm.expectRevert(ArcClaimBatch.BatchExpired.selector);
        batch.addAllocations(id, r, a);

        bytes32 never = _createAbcd(NEVER);
        vm.startPrank(sender);
        batch.cancelBatch(never);
        vm.expectRevert(ArcClaimBatch.BatchNotActive.selector);
        batch.addAllocations(never, r, a);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // Claim
    // ------------------------------------------------------------------

    function test_Claim_Individual() public {
        bytes32 id = _createAbcd(expiry);
        vm.expectEmit(true, true, true, true, address(batch));
        emit AllocationClaimed(id, alice, 20e6);
        _claim(id, alice);

        assertEq(usdc.balanceOf(alice), 20e6);
        _assertAlloc(id, alice, ArcClaimBatch.AllocationStatus.CLAIMED);
        _assertAlloc(id, bob, ArcClaimBatch.AllocationStatus.FUNDED);
        ArcClaimBatch.Batch memory b = batch.getBatch(id);
        assertEq(b.claimedAmount, 20e6);
        assertEq(b.claimedCount, 1);
        assertEq(usdc.balanceOf(address(batch)), 80e6);
    }

    function test_Claim_UnauthorizedReverts() public {
        bytes32 id = _createAbcd(expiry);
        vm.prank(stranger);
        vm.expectRevert(ArcClaimBatch.NotRecipient.selector);
        batch.claim(id);
        // The sender cannot claim recipient allocations.
        vm.prank(sender);
        vm.expectRevert(ArcClaimBatch.NotRecipient.selector);
        batch.claim(id);
        assertEq(usdc.balanceOf(address(batch)), 100e6);
    }

    function test_Claim_RecipientOnlyGetsOwnAllocation() public {
        bytes32 id = _createAbcd(expiry);
        _claim(id, bob);
        assertEq(usdc.balanceOf(bob), 10e6);
        _assertAlloc(id, alice, ArcClaimBatch.AllocationStatus.FUNDED);
    }

    function test_Claim_DoubleClaimReverts() public {
        bytes32 id = _createAbcd(expiry);
        _claim(id, alice);
        vm.prank(alice);
        vm.expectRevert(ArcClaimBatch.AlreadyClaimed.selector);
        batch.claim(id);
    }

    function test_Claim_RevertsAfterExpiry() public {
        bytes32 id = _createAbcd(expiry);
        vm.warp(expiry);
        vm.prank(alice);
        vm.expectRevert(ArcClaimBatch.BatchExpired.selector);
        batch.claim(id);
    }

    function test_Claim_RevertsAfterRefundOrCancel() public {
        bytes32 a = _createAbcd(expiry);
        vm.warp(expiry);
        batch.refundExpired(a);
        vm.prank(alice);
        vm.expectRevert(ArcClaimBatch.BatchNotActive.selector);
        batch.claim(a);

        bytes32 b = _createAbcd(NEVER);
        vm.prank(sender);
        batch.cancelBatch(b);
        vm.prank(alice);
        vm.expectRevert(ArcClaimBatch.BatchNotActive.selector);
        batch.claim(b);
    }

    function test_Claim_UnknownBatchReverts() public {
        vm.prank(alice);
        vm.expectRevert(ArcClaimBatch.BatchNotFound.selector);
        batch.claim(keccak256("nope"));
    }

    function test_Claim_PartialClaims() public {
        bytes32 id = _createAbcd(expiry);
        _claim(id, alice);
        _claim(id, carol);

        ArcClaimBatch.Batch memory b = batch.getBatch(id);
        assertEq(b.claimedAmount, 50e6);
        assertEq(b.claimedCount, 2);
        _assertAlloc(id, alice, ArcClaimBatch.AllocationStatus.CLAIMED);
        _assertAlloc(id, bob, ArcClaimBatch.AllocationStatus.FUNDED);
        _assertAlloc(id, carol, ArcClaimBatch.AllocationStatus.CLAIMED);
        _assertAlloc(id, david, ArcClaimBatch.AllocationStatus.FUNDED);
        assertEq(usdc.balanceOf(address(batch)), 50e6);
    }

    function test_Claim_FullClaims() public {
        bytes32 id = _createAbcd(expiry);
        _claim(id, alice);
        _claim(id, bob);
        _claim(id, carol);
        _claim(id, david);

        ArcClaimBatch.Batch memory b = batch.getBatch(id);
        assertEq(b.claimedAmount, 100e6);
        assertEq(b.claimedCount, 4);
        assertEq(usdc.balanceOf(address(batch)), 0);
        assertEq(usdc.balanceOf(david), 40e6);
    }

    function test_Claim_NeverExpireBatchYearsLater() public {
        bytes32 id = _createAbcd(NEVER);
        vm.warp(block.timestamp + 50 * 365 days);
        _claim(id, david);
        assertEq(usdc.balanceOf(david), 40e6);
    }

    // ------------------------------------------------------------------
    // Expired refund
    // ------------------------------------------------------------------

    function test_Refund_NoneClaimed_BySender() public {
        bytes32 id = _createAbcd(expiry);
        vm.warp(expiry);
        vm.expectEmit(true, true, true, true, address(batch));
        emit BatchRefunded(id, sender, 100e6);
        vm.prank(sender);
        batch.refundExpired(id);

        ArcClaimBatch.Batch memory b = batch.getBatch(id);
        assertEq(uint8(b.status), uint8(ArcClaimBatch.BatchStatus.REFUNDED));
        assertEq(b.returnedAmount, 100e6);
        assertEq(usdc.balanceOf(sender), START);
        assertEq(usdc.balanceOf(address(batch)), 0);
        _assertAlloc(id, alice, ArcClaimBatch.AllocationStatus.REFUNDED);
    }

    function test_Refund_PartialClaimed_OnlyUnclaimedReturned() public {
        bytes32 id = _createAbcd(expiry);
        _claim(id, alice); // 20
        _claim(id, carol); // 30
        vm.warp(expiry);
        batch.refundExpired(id);

        assertEq(batch.getBatch(id).returnedAmount, 50e6);
        assertEq(usdc.balanceOf(sender), START - 100e6 + 50e6);
        assertEq(usdc.balanceOf(alice), 20e6);
        assertEq(usdc.balanceOf(carol), 30e6);
        assertEq(usdc.balanceOf(address(batch)), 0);
        // Claimed allocations stay CLAIMED; unclaimed ones are reported REFUNDED.
        _assertAlloc(id, alice, ArcClaimBatch.AllocationStatus.CLAIMED);
        _assertAlloc(id, bob, ArcClaimBatch.AllocationStatus.REFUNDED);
        _assertAlloc(id, carol, ArcClaimBatch.AllocationStatus.CLAIMED);
        _assertAlloc(id, david, ArcClaimBatch.AllocationStatus.REFUNDED);
    }

    function test_Refund_ThirdPartyTriggers_FundsGoToSender() public {
        bytes32 id = _createAbcd(expiry);
        _claim(id, bob);
        vm.warp(expiry + 1);
        vm.prank(stranger);
        batch.refundExpired(id);

        assertEq(usdc.balanceOf(stranger), 0);
        assertEq(usdc.balanceOf(sender), START - 10e6);
    }

    function test_Refund_RecipientTriggers_FundsGoToSender() public {
        bytes32 id = _createAbcd(expiry);
        vm.warp(expiry);
        vm.prank(alice);
        batch.refundExpired(id);
        assertEq(usdc.balanceOf(alice), 0);
        assertEq(usdc.balanceOf(sender), START);
    }

    function test_Refund_AllClaimed_NothingToRefund() public {
        bytes32 id = _createAbcd(expiry);
        _claim(id, alice);
        _claim(id, bob);
        _claim(id, carol);
        _claim(id, david);
        vm.warp(expiry);
        vm.expectRevert(ArcClaimBatch.NothingToRefund.selector);
        batch.refundExpired(id);
        assertEq(usdc.balanceOf(sender), START - 100e6);
    }

    function test_Refund_DoubleRefundReverts() public {
        bytes32 id = _createAbcd(expiry);
        vm.warp(expiry);
        batch.refundExpired(id);
        vm.expectRevert(ArcClaimBatch.BatchNotActive.selector);
        batch.refundExpired(id);
        vm.prank(sender);
        vm.expectRevert(ArcClaimBatch.BatchNotActive.selector);
        batch.refundExpired(id);
        assertEq(usdc.balanceOf(sender), START);
    }

    function test_Refund_AlreadyClaimedAllocationCannotBeRefunded() public {
        bytes32 id = _createAbcd(expiry);
        _claim(id, david); // 40 claimed
        vm.warp(expiry);
        batch.refundExpired(id);
        // Sender gets back exactly 60, never David's claimed 40.
        assertEq(usdc.balanceOf(sender), START - 40e6);
        assertEq(usdc.balanceOf(david), 40e6);
        _assertAlloc(id, david, ArcClaimBatch.AllocationStatus.CLAIMED);
    }

    function test_Refund_RevertsBeforeExpiry() public {
        bytes32 id = _createAbcd(expiry);
        vm.warp(expiry - 1);
        vm.expectRevert(ArcClaimBatch.BatchNotExpired.selector);
        batch.refundExpired(id);
    }

    function test_Refund_NeverExpireBatchCannotRefund() public {
        bytes32 id = _createAbcd(NEVER);
        vm.expectRevert(ArcClaimBatch.NeverExpires.selector);
        batch.refundExpired(id);
        vm.warp(type(uint64).max);
        vm.prank(sender);
        vm.expectRevert(ArcClaimBatch.NeverExpires.selector);
        batch.refundExpired(id);
        assertEq(usdc.balanceOf(address(batch)), 100e6);
        assertEq(uint8(batch.getBatch(id).status), uint8(ArcClaimBatch.BatchStatus.ACTIVE));
    }

    function test_Refund_OneBatchDoesNotTouchAnother() public {
        bytes32 a = _createAbcd(expiry);
        bytes32 b = _createAbcd(NEVER);
        vm.warp(expiry);
        batch.refundExpired(a);
        assertEq(usdc.balanceOf(address(batch)), 100e6);
        _claim(b, alice);
        assertEq(usdc.balanceOf(alice), 20e6);
    }

    // ------------------------------------------------------------------
    // Cancel
    // ------------------------------------------------------------------

    function test_Cancel_NeverExpire_ReturnsOnlyUnclaimed() public {
        bytes32 id = _createAbcd(NEVER);
        _claim(id, alice);
        vm.warp(block.timestamp + 10 * 365 days);
        vm.expectEmit(true, true, true, true, address(batch));
        emit BatchCancelled(id, sender, 80e6);
        vm.prank(sender);
        batch.cancelBatch(id);

        assertEq(usdc.balanceOf(sender), START - 20e6);
        assertEq(usdc.balanceOf(address(batch)), 0);
        _assertAlloc(id, alice, ArcClaimBatch.AllocationStatus.CLAIMED);
        _assertAlloc(id, bob, ArcClaimBatch.AllocationStatus.CANCELLED);
    }

    function test_Cancel_OnlySender() public {
        bytes32 id = _createAbcd(expiry);
        vm.prank(stranger);
        vm.expectRevert(ArcClaimBatch.NotSender.selector);
        batch.cancelBatch(id);
        vm.prank(alice);
        vm.expectRevert(ArcClaimBatch.NotSender.selector);
        batch.cancelBatch(id);
    }

    function test_Cancel_RevertsAfterExpiry() public {
        bytes32 id = _createAbcd(expiry);
        vm.warp(expiry);
        vm.prank(sender);
        vm.expectRevert(ArcClaimBatch.BatchExpired.selector);
        batch.cancelBatch(id);
    }

    function test_Cancel_TwiceReverts_AndBlocksRefund() public {
        bytes32 id = _createAbcd(expiry);
        vm.startPrank(sender);
        batch.cancelBatch(id);
        vm.expectRevert(ArcClaimBatch.BatchNotActive.selector);
        batch.cancelBatch(id);
        vm.stopPrank();
        vm.warp(expiry);
        vm.expectRevert(ArcClaimBatch.BatchNotActive.selector);
        batch.refundExpired(id);
        assertEq(usdc.balanceOf(sender), START);
    }

    function test_Cancel_AllClaimed_NothingToRefund() public {
        bytes32 id = _createAbcd(NEVER);
        _claim(id, alice);
        _claim(id, bob);
        _claim(id, carol);
        _claim(id, david);
        vm.prank(sender);
        vm.expectRevert(ArcClaimBatch.NothingToRefund.selector);
        batch.cancelBatch(id);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function test_GetAllocations_Batched() public {
        bytes32 id = _createAbcd(expiry);
        _claim(id, bob);
        address[] memory who = new address[](3);
        (who[0], who[1], who[2]) = (alice, bob, stranger);
        (uint256[] memory amounts, ArcClaimBatch.AllocationStatus[] memory statuses) = batch.getAllocations(id, who);
        assertEq(amounts[0], 20e6);
        assertEq(amounts[1], 10e6);
        assertEq(amounts[2], 0);
        assertEq(uint8(statuses[0]), uint8(ArcClaimBatch.AllocationStatus.FUNDED));
        assertEq(uint8(statuses[1]), uint8(ArcClaimBatch.AllocationStatus.CLAIMED));
        assertEq(uint8(statuses[2]), uint8(ArcClaimBatch.AllocationStatus.NONE));
    }

    // ------------------------------------------------------------------
    // Reentrancy
    // ------------------------------------------------------------------

    function test_Reentrancy_ClaimCannotReenterRefund() public {
        ReentrantToken token = new ReentrantToken();
        ArcClaimBatch rBatch = new ArcClaimBatch(address(token));
        token.mint(sender, 100e6);
        (address[] memory r, uint256[] memory a) = _abcd();
        vm.startPrank(sender);
        token.approve(address(rBatch), type(uint256).max);
        bytes32 id = rBatch.createBatch(r, a, NEVER);
        vm.stopPrank();

        token.arm(address(rBatch), abi.encodeCall(ArcClaimBatch.claim, (id)));
        vm.prank(alice);
        rBatch.claim(id);

        assertTrue(token.attempted());
        assertFalse(token.reentrySucceeded());
        assertEq(token.balanceOf(alice), 20e6);
        assertEq(token.balanceOf(address(rBatch)), 80e6);
    }

    // ------------------------------------------------------------------
    // Fuzz
    // ------------------------------------------------------------------

    /// Random batch, random subset claimed, then refund: every unit ends up with exactly one party.
    function testFuzz_ClaimSubsetThenRefund(uint8 n, uint256 seed, uint256 claimMask) public {
        n = uint8(bound(n, 1, 40));
        address[] memory r = new address[](n);
        uint256[] memory a = new uint256[](n);
        uint256 total;
        for (uint256 i; i < n; ++i) {
            r[i] = address(uint160(uint256(keccak256(abi.encode(seed, i))) | 1));
            a[i] = bound(uint256(keccak256(abi.encode(seed, i, "amt"))), 1, 50_000e6);
            total += a[i];
        }
        vm.prank(sender);
        bytes32 id = batch.createBatch(r, a, expiry);
        assertEq(batch.getBatch(id).totalAmount, total);

        uint256 claimed;
        for (uint256 i; i < n; ++i) {
            if ((claimMask >> i) & 1 == 1) {
                _claim(id, r[i]);
                claimed += a[i];
            }
        }
        assertEq(usdc.balanceOf(address(batch)), total - claimed);

        vm.warp(expiry);
        if (claimed == total) {
            vm.expectRevert(ArcClaimBatch.NothingToRefund.selector);
            batch.refundExpired(id);
        } else {
            vm.prank(stranger);
            batch.refundExpired(id);
            assertEq(batch.getBatch(id).returnedAmount, total - claimed);
        }
        assertEq(usdc.balanceOf(address(batch)), 0);
        assertEq(usdc.balanceOf(sender), START - claimed);
        assertEq(usdc.balanceOf(stranger), 0);
    }

    function testFuzz_UnauthorizedCannotClaim(address caller) public {
        vm.assume(caller != alice && caller != bob && caller != carol && caller != david);
        bytes32 id = _createAbcd(NEVER);
        vm.prank(caller);
        vm.expectRevert(ArcClaimBatch.NotRecipient.selector);
        batch.claim(id);
    }
}

/// @dev Random sequences of create / claim / refund / cancel / time jumps for invariant testing.
///      Keeps ghost state to check accounting and that allocation statuses only move forward.
contract BatchHandler is Test {
    ArcClaimBatch public batch;
    TestUSDC public usdc;
    address public sender = address(0xA11CE);
    address[4] public people = [address(0xB0B), address(0xCA201), address(0xDA71D), address(0xE11E)];
    bytes32[] public ids;

    uint256 public constant MINTED = type(uint128).max;
    uint256 public totalClaimed;
    uint256 public totalReturned;
    uint256 public totalDeposited;

    /// Status recorded when an allocation left FUNDED (0 = still funded / not in batch).
    mapping(bytes32 => mapping(address => uint8)) public settledStatus;
    /// Sum of allocations each person has claimed.
    mapping(address => uint256) public receivedBy;

    constructor(ArcClaimBatch batch_, TestUSDC usdc_) {
        batch = batch_;
        usdc = usdc_;
        usdc.mint(sender, MINTED);
        vm.prank(sender);
        usdc.approve(address(batch), type(uint256).max);
    }

    function create(uint256 seed, bool never, uint8 mask) external {
        mask = uint8(bound(mask, 1, 15)); // non-empty subset of the 4 people
        uint256 n;
        for (uint256 i; i < 4; ++i) {
            if ((mask >> i) & 1 == 1) ++n;
        }
        address[] memory r = new address[](n);
        uint256[] memory a = new uint256[](n);
        uint256 k;
        for (uint256 i; i < 4; ++i) {
            if ((mask >> i) & 1 == 0) continue;
            r[k] = people[i];
            a[k] = bound(uint256(keccak256(abi.encode(seed, i))), 1, 1_000_000e6);
            totalDeposited += a[k];
            ++k;
        }
        vm.prank(sender);
        ids.push(batch.createBatch(r, a, never ? 0 : block.timestamp + 1 days));
    }

    function claim(uint256 idSeed, uint256 who) external {
        if (ids.length == 0) return;
        bytes32 id = ids[idSeed % ids.length];
        address p = people[who % 4];
        (uint256 amount, ArcClaimBatch.AllocationStatus s) = batch.getAllocation(id, p);
        ArcClaimBatch.Batch memory b = batch.getBatch(id);
        bool open = b.expiry == 0 || block.timestamp < b.expiry;
        if (s != ArcClaimBatch.AllocationStatus.FUNDED || !open) return;
        vm.prank(p);
        batch.claim(id);
        totalClaimed += amount;
        receivedBy[p] += amount;
        settledStatus[id][p] = uint8(ArcClaimBatch.AllocationStatus.CLAIMED);
    }

    function refund(uint256 idSeed) external {
        if (ids.length == 0) return;
        bytes32 id = ids[idSeed % ids.length];
        ArcClaimBatch.Batch memory b = batch.getBatch(id);
        if (
            b.status != ArcClaimBatch.BatchStatus.ACTIVE || b.expiry == 0 || block.timestamp < b.expiry
                || b.totalAmount == b.claimedAmount
        ) return;
        batch.refundExpired(id);
        totalReturned += b.totalAmount - b.claimedAmount;
        _markClosed(id, ArcClaimBatch.AllocationStatus.REFUNDED);
    }

    function cancel(uint256 idSeed) external {
        if (ids.length == 0) return;
        bytes32 id = ids[idSeed % ids.length];
        ArcClaimBatch.Batch memory b = batch.getBatch(id);
        bool open = b.expiry == 0 || block.timestamp < b.expiry;
        if (b.status != ArcClaimBatch.BatchStatus.ACTIVE || !open || b.totalAmount == b.claimedAmount) return;
        vm.prank(sender);
        batch.cancelBatch(id);
        totalReturned += b.totalAmount - b.claimedAmount;
        _markClosed(id, ArcClaimBatch.AllocationStatus.CANCELLED);
    }

    function _markClosed(bytes32 id, ArcClaimBatch.AllocationStatus to) internal {
        for (uint256 i; i < 4; ++i) {
            (, ArcClaimBatch.AllocationStatus s) = batch.getAllocation(id, people[i]);
            if (s == to) settledStatus[id][people[i]] = uint8(to);
        }
    }

    function warp(uint256 by) external {
        vm.warp(block.timestamp + bound(by, 0, 2 days));
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    function person(uint256 i) external view returns (address) {
        return people[i];
    }
}

contract ArcClaimBatchInvariantTest is Test {
    ArcClaimBatch internal batch;
    TestUSDC internal usdc;
    BatchHandler internal handler;

    function setUp() public {
        vm.warp(1_700_000_000);
        usdc = new TestUSDC();
        batch = new ArcClaimBatch(address(usdc));
        handler = new BatchHandler(batch, usdc);
        targetContract(address(handler));
    }

    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 60
    /// Contract balance == deposits - claims - refunds/cancels.
    function invariant_BalanceMatchesAccounting() public view {
        assertEq(
            usdc.balanceOf(address(batch)), handler.totalDeposited() - handler.totalClaimed() - handler.totalReturned()
        );
    }

    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 60
    /// Per batch: sum of allocations == total; sum of CLAIMED allocations == claimedAmount; closed batches
    /// returned exactly the unclaimed rest; contract balance == sum of unclaimed in ACTIVE batches.
    function invariant_PerBatchAccounting() public view {
        uint256 owed;
        for (uint256 i; i < handler.idsLength(); ++i) {
            bytes32 id = handler.ids(i);
            ArcClaimBatch.Batch memory b = batch.getBatch(id);
            uint256 sumAll;
            uint256 sumClaimed;
            uint256 claimedCount;
            for (uint256 j; j < 4; ++j) {
                (uint256 amt, ArcClaimBatch.AllocationStatus s) = batch.getAllocation(id, handler.person(j));
                sumAll += amt;
                if (s == ArcClaimBatch.AllocationStatus.CLAIMED) {
                    sumClaimed += amt;
                    ++claimedCount;
                }
            }
            assertEq(sumAll, b.totalAmount, "sum of allocations == total");
            assertEq(sumClaimed, b.claimedAmount, "sum of claimed allocations == claimedAmount");
            assertEq(claimedCount, b.claimedCount, "claimed count");
            if (b.status == ArcClaimBatch.BatchStatus.ACTIVE) {
                owed += b.totalAmount - b.claimedAmount;
                assertEq(b.returnedAmount, 0);
            } else {
                assertEq(b.returnedAmount, b.totalAmount - b.claimedAmount, "returned only the unclaimed rest");
            }
        }
        assertEq(usdc.balanceOf(address(batch)), owed);
    }

    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 60
    /// Allocation statuses only move forward: once CLAIMED / REFUNDED / CANCELLED they never change again.
    function invariant_AllocationStatusIsFinal() public view {
        for (uint256 i; i < handler.idsLength(); ++i) {
            bytes32 id = handler.ids(i);
            for (uint256 j; j < 4; ++j) {
                address p = handler.person(j);
                uint8 seen = handler.settledStatus(id, p);
                if (seen == 0) continue;
                (, ArcClaimBatch.AllocationStatus s) = batch.getAllocation(id, p);
                assertEq(uint8(s), seen, "settled allocation changed");
            }
        }
    }

    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 60
    /// Recipients hold exactly what they claimed; the sender holds minted - deposited + returned.
    function invariant_FundsOnlyReachSenderOrOwnRecipient() public view {
        for (uint256 j; j < 4; ++j) {
            address p = handler.person(j);
            assertEq(usdc.balanceOf(p), handler.receivedBy(p), "recipient got exactly their claims");
        }
        assertEq(
            usdc.balanceOf(handler.sender()),
            handler.MINTED() - handler.totalDeposited() + handler.totalReturned(),
            "sender ledger"
        );
    }
}
