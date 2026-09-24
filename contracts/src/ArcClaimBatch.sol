// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ArcClaimBatch
/// @notice One sender locks USDC for many recipients (batch payments / airdrops). Every recipient has an
///         independent allocation that only they can claim. After expiry anyone can return all unclaimed
///         USDC to the sender; before expiry the sender can cancel and take back the unclaimed USDC.
///         Claimed allocations can never be refunded. `expiry == 0` means the batch never expires.
/// @dev No owner, no admin, no upgradeability. Accounting is computed entirely on-chain:
///      unclaimed = totalAmount - claimedAmount, and refunds always go to the batch sender.
///      Batch ids are opaque but NOT secret; authorization is always checked against msg.sender.
contract ArcClaimBatch is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum BatchStatus {
        NONE,
        ACTIVE,
        REFUNDED,
        CANCELLED
    }

    /// @dev Only NONE / FUNDED / CLAIMED are stored. REFUNDED and CANCELLED are derived from the batch
    ///      status for allocations that were still FUNDED when the batch was closed.
    enum AllocationStatus {
        NONE,
        FUNDED,
        CLAIMED,
        REFUNDED,
        CANCELLED
    }

    struct Batch {
        address sender;
        /// @dev Unix timestamp; 0 = never expires.
        uint256 expiry;
        BatchStatus status;
        uint256 totalAmount;
        uint256 claimedAmount;
        /// @dev Amount returned to the sender when the batch was refunded or cancelled.
        uint256 returnedAmount;
        uint256 recipientCount;
        uint256 claimedCount;
    }

    struct Allocation {
        uint128 amount;
        AllocationStatus status;
    }

    /// @notice Maximum number of recipients per createBatch / addAllocations call (block gas limit bound).
    uint256 public constant MAX_RECIPIENTS_PER_CALL = 200;

    /// @notice The USDC token used for all batches.
    IERC20 public immutable usdc;

    /// @notice Number of batches created so far (also the nonce of the latest batch id).
    uint256 public batchCount;

    mapping(bytes32 batchId => Batch) private _batches;
    mapping(bytes32 batchId => mapping(address recipient => Allocation)) private _allocations;

    event BatchCreated(bytes32 indexed batchId, address indexed sender, uint256 expiry);
    event AllocationFunded(bytes32 indexed batchId, address indexed recipient, uint256 amount);
    event AllocationClaimed(bytes32 indexed batchId, address indexed recipient, uint256 amount);
    event BatchRefunded(bytes32 indexed batchId, address indexed sender, uint256 amount);
    event BatchCancelled(bytes32 indexed batchId, address indexed sender, uint256 amount);

    error InvalidToken();
    error InvalidExpiry();
    error EmptyBatch();
    error TooManyRecipients();
    error LengthMismatch();
    error InvalidRecipient(uint256 index);
    error InvalidAmount(uint256 index);
    error DuplicateRecipient(address recipient);
    error BatchNotFound();
    error BatchNotActive();
    error NotSender();
    error NotRecipient();
    error AlreadyClaimed();
    error BatchExpired();
    error BatchNotExpired();
    error NeverExpires();
    error NothingToRefund();
    error TransferAmountMismatch();

    /// @param usdc_ Address of the USDC (ERC-20) token.
    constructor(address usdc_) {
        if (usdc_ == address(0)) revert InvalidToken();
        usdc = IERC20(usdc_);
    }

    /// @notice Create a batch and lock the sum of `amounts` USDC from the caller.
    /// @dev The caller must have approved this contract for at least the sum of `amounts`.
    ///      Each recipient may appear only once per batch.
    /// @param recipients Recipient addresses (1..MAX_RECIPIENTS_PER_CALL, unique, non-zero).
    /// @param amounts USDC amount per recipient (token base units, each > 0).
    /// @param expiry Unix timestamp after which allocations can no longer be claimed, or 0 to never expire.
    /// @return batchId The opaque id of the new batch.
    function createBatch(address[] calldata recipients, uint256[] calldata amounts, uint256 expiry)
        external
        nonReentrant
        returns (bytes32 batchId)
    {
        if (expiry != 0 && expiry <= block.timestamp) revert InvalidExpiry();

        batchId = keccak256(abi.encode(block.chainid, address(this), ++batchCount));
        Batch storage b = _batches[batchId];
        b.sender = msg.sender;
        b.expiry = expiry;
        b.status = BatchStatus.ACTIVE;

        emit BatchCreated(batchId, msg.sender, expiry);

        _fund(batchId, b, recipients, amounts);
    }

    /// @notice Add more recipients to an active, unexpired batch (for airdrops larger than one call).
    ///         Only the batch sender may call.
    /// @param batchId The id of the batch.
    /// @param recipients Recipient addresses (1..MAX_RECIPIENTS_PER_CALL, unique within the batch, non-zero).
    /// @param amounts USDC amount per recipient (token base units, each > 0).
    function addAllocations(bytes32 batchId, address[] calldata recipients, uint256[] calldata amounts)
        external
        nonReentrant
    {
        Batch storage b = _activeBatch(batchId);
        if (msg.sender != b.sender) revert NotSender();
        if (_isExpired(b.expiry)) revert BatchExpired();

        _fund(batchId, b, recipients, amounts);
    }

    /// @notice Claim the caller's allocation in a batch. Only possible while the batch is active and unexpired.
    /// @param batchId The id of the batch.
    function claim(bytes32 batchId) external nonReentrant {
        Batch storage b = _activeBatch(batchId);
        if (_isExpired(b.expiry)) revert BatchExpired();

        Allocation storage a = _allocations[batchId][msg.sender];
        if (a.status == AllocationStatus.NONE) revert NotRecipient();
        if (a.status != AllocationStatus.FUNDED) revert AlreadyClaimed();

        uint256 amount = a.amount;
        a.status = AllocationStatus.CLAIMED;
        b.claimedAmount += amount;
        b.claimedCount += 1;

        emit AllocationClaimed(batchId, msg.sender, amount);

        usdc.safeTransfer(msg.sender, amount);
    }

    /// @notice Return all unclaimed USDC of an expired batch to its sender. Callable by anyone;
    ///         the funds always go to the batch sender. Never available for batches that never expire.
    /// @param batchId The id of the batch.
    function refundExpired(bytes32 batchId) external nonReentrant {
        Batch storage b = _activeBatch(batchId);
        if (b.expiry == 0) revert NeverExpires();
        if (block.timestamp < b.expiry) revert BatchNotExpired();

        uint256 unclaimed = _close(b, BatchStatus.REFUNDED);

        emit BatchRefunded(batchId, b.sender, unclaimed);

        usdc.safeTransfer(b.sender, unclaimed);
    }

    /// @notice Cancel an active, unexpired batch and return all unclaimed USDC to the sender.
    ///         Only the batch sender may call. Already-claimed allocations are unaffected.
    /// @param batchId The id of the batch.
    function cancelBatch(bytes32 batchId) external nonReentrant {
        Batch storage b = _activeBatch(batchId);
        if (msg.sender != b.sender) revert NotSender();
        if (_isExpired(b.expiry)) revert BatchExpired();

        uint256 unclaimed = _close(b, BatchStatus.CANCELLED);

        emit BatchCancelled(batchId, msg.sender, unclaimed);

        usdc.safeTransfer(msg.sender, unclaimed);
    }

    /// @notice Return the full data of a batch.
    /// @param batchId The id of the batch.
    /// @return The batch (all-zero with status NONE if it does not exist).
    function getBatch(bytes32 batchId) external view returns (Batch memory) {
        return _batches[batchId];
    }

    /// @notice Return a recipient's allocation in a batch, with REFUNDED / CANCELLED derived from the batch.
    /// @param batchId The id of the batch.
    /// @param recipient The recipient address.
    /// @return amount The allocated USDC amount (0 if none).
    /// @return status The allocation status.
    function getAllocation(bytes32 batchId, address recipient)
        public
        view
        returns (uint256 amount, AllocationStatus status)
    {
        Allocation memory a = _allocations[batchId][recipient];
        amount = a.amount;
        status = a.status;
        if (status == AllocationStatus.FUNDED) {
            BatchStatus bs = _batches[batchId].status;
            if (bs == BatchStatus.REFUNDED) status = AllocationStatus.REFUNDED;
            else if (bs == BatchStatus.CANCELLED) status = AllocationStatus.CANCELLED;
        }
    }

    /// @notice Batched version of getAllocation for dashboards.
    /// @param batchId The id of the batch.
    /// @param recipients The recipient addresses to look up.
    /// @return amounts Allocated amounts, in the same order as `recipients`.
    /// @return statuses Allocation statuses, in the same order as `recipients`.
    function getAllocations(bytes32 batchId, address[] calldata recipients)
        external
        view
        returns (uint256[] memory amounts, AllocationStatus[] memory statuses)
    {
        amounts = new uint256[](recipients.length);
        statuses = new AllocationStatus[](recipients.length);
        for (uint256 i; i < recipients.length; ++i) {
            (amounts[i], statuses[i]) = getAllocation(batchId, recipients[i]);
        }
    }

    /// @notice The id that was (or will be) assigned to the batch with the given 1-based nonce.
    /// @param nonce The creation index of the batch.
    function batchIdAt(uint256 nonce) external view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), nonce));
    }

    /// @dev Validate rows, record allocations, and pull exactly their sum from msg.sender.
    function _fund(bytes32 batchId, Batch storage b, address[] calldata recipients, uint256[] calldata amounts)
        private
    {
        uint256 count = recipients.length;
        if (count == 0) revert EmptyBatch();
        if (count > MAX_RECIPIENTS_PER_CALL) revert TooManyRecipients();
        if (count != amounts.length) revert LengthMismatch();

        mapping(address => Allocation) storage allocations = _allocations[batchId];
        uint256 total;
        for (uint256 i; i < count; ++i) {
            address recipient = recipients[i];
            uint256 amount = amounts[i];
            if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient(i);
            if (amount == 0 || amount > type(uint128).max) revert InvalidAmount(i);
            if (allocations[recipient].status != AllocationStatus.NONE) revert DuplicateRecipient(recipient);

            // forge-lint: disable-next-line(unsafe-typecast)
            allocations[recipient] = Allocation({amount: uint128(amount), status: AllocationStatus.FUNDED});
            total += amount;

            emit AllocationFunded(batchId, recipient, amount);
        }

        b.totalAmount += total;
        b.recipientCount += count;

        uint256 balanceBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), total);
        if (usdc.balanceOf(address(this)) - balanceBefore != total) revert TransferAmountMismatch();
    }

    /// @dev Mark the batch closed and return the unclaimed amount to be sent back to the sender.
    function _close(Batch storage b, BatchStatus status) private returns (uint256 unclaimed) {
        unclaimed = b.totalAmount - b.claimedAmount;
        if (unclaimed == 0) revert NothingToRefund();
        b.status = status;
        b.returnedAmount = unclaimed;
    }

    /// @dev Load a batch that exists and is ACTIVE, reverting otherwise.
    function _activeBatch(bytes32 batchId) private view returns (Batch storage b) {
        b = _batches[batchId];
        if (b.status == BatchStatus.NONE) revert BatchNotFound();
        if (b.status != BatchStatus.ACTIVE) revert BatchNotActive();
    }

    /// @dev A zero expiry never expires.
    function _isExpired(uint256 expiry) private view returns (bool) {
        return expiry != 0 && block.timestamp >= expiry;
    }
}
