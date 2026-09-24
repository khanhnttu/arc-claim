// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ArcClaimV2
/// @notice Programmable USDC payments to a single recipient, with an optional deadline.
///         `expiry == 0` means the payment never expires: the recipient can claim at any time and the
///         sender can cancel at any time before it is claimed. Payments with an expiry can be claimed or
///         cancelled before it, and refunded to the sender by anyone after it.
/// @dev No owner, no admin, no upgradeability. Funds only ever move to a payment's sender or recipient.
///      Payment ids are opaque but NOT secret; authorization is always checked against msg.sender.
contract ArcClaimV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum PaymentStatus {
        NONE,
        FUNDED,
        CLAIMED,
        CANCELLED,
        REFUNDED
    }

    struct Payment {
        address sender;
        address recipient;
        uint256 amount;
        /// @dev Unix timestamp; 0 = never expires.
        uint256 expiry;
        PaymentStatus status;
    }

    /// @notice The USDC token used for all payments.
    IERC20 public immutable usdc;

    /// @notice Number of payments created so far (also the nonce of the latest payment id).
    uint256 public paymentCount;

    mapping(bytes32 paymentId => Payment) private _payments;

    event PaymentCreated(
        bytes32 indexed paymentId, address indexed sender, address indexed recipient, uint256 amount, uint256 expiry
    );
    event PaymentClaimed(bytes32 indexed paymentId, address indexed recipient, uint256 amount);
    event PaymentCancelled(bytes32 indexed paymentId, address indexed sender, uint256 amount);
    event PaymentRefunded(bytes32 indexed paymentId, address indexed sender, uint256 amount);

    error InvalidToken();
    error InvalidRecipient();
    error InvalidAmount();
    error InvalidExpiry();
    error PaymentNotFound();
    error InvalidStatus();
    error NotRecipient();
    error NotSender();
    error PaymentExpired();
    error PaymentNotExpired();
    error NeverExpires();
    error TransferAmountMismatch();

    /// @param usdc_ Address of the USDC (ERC-20) token.
    constructor(address usdc_) {
        if (usdc_ == address(0)) revert InvalidToken();
        usdc = IERC20(usdc_);
    }

    /// @notice Create a payment and lock `amount` USDC from the caller for `recipient`.
    /// @dev The caller must have approved this contract for at least `amount` USDC.
    /// @param recipient The only address allowed to claim the funds.
    /// @param amount The USDC amount to lock (token base units).
    /// @param expiry Unix timestamp after which the payment can no longer be claimed, or 0 to never expire.
    /// @return paymentId The opaque id of the new payment.
    function createPayment(address recipient, uint256 amount, uint256 expiry)
        external
        nonReentrant
        returns (bytes32 paymentId)
    {
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient();
        if (amount == 0) revert InvalidAmount();
        if (expiry != 0 && expiry <= block.timestamp) revert InvalidExpiry();

        paymentId = keccak256(abi.encode(block.chainid, address(this), ++paymentCount));
        _payments[paymentId] = Payment({
            sender: msg.sender, recipient: recipient, amount: amount, expiry: expiry, status: PaymentStatus.FUNDED
        });

        emit PaymentCreated(paymentId, msg.sender, recipient, amount, expiry);

        uint256 balanceBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        if (usdc.balanceOf(address(this)) - balanceBefore != amount) revert TransferAmountMismatch();
    }

    /// @notice Claim a payment. Only its recipient may call, and only while it has not expired.
    /// @param paymentId The id of the payment.
    function claim(bytes32 paymentId) external nonReentrant {
        Payment storage p = _fundedPayment(paymentId);
        if (msg.sender != p.recipient) revert NotRecipient();
        if (_isExpired(p.expiry)) revert PaymentExpired();

        p.status = PaymentStatus.CLAIMED;
        uint256 amount = p.amount;

        emit PaymentClaimed(paymentId, msg.sender, amount);

        usdc.safeTransfer(msg.sender, amount);
    }

    /// @notice Cancel an unclaimed payment and return the USDC to the sender. Only the sender may call,
    ///         and only while the payment has not expired (never-expire payments: any time).
    /// @param paymentId The id of the payment.
    function cancel(bytes32 paymentId) external nonReentrant {
        Payment storage p = _fundedPayment(paymentId);
        if (msg.sender != p.sender) revert NotSender();
        if (_isExpired(p.expiry)) revert PaymentExpired();

        p.status = PaymentStatus.CANCELLED;
        uint256 amount = p.amount;

        emit PaymentCancelled(paymentId, msg.sender, amount);

        usdc.safeTransfer(msg.sender, amount);
    }

    /// @notice Return an expired, unclaimed payment to its sender. Callable by anyone.
    ///         Never available for payments that never expire.
    /// @param paymentId The id of the payment.
    function refundExpired(bytes32 paymentId) external nonReentrant {
        Payment storage p = _fundedPayment(paymentId);
        if (p.expiry == 0) revert NeverExpires();
        if (block.timestamp < p.expiry) revert PaymentNotExpired();

        p.status = PaymentStatus.REFUNDED;
        address sender = p.sender;
        uint256 amount = p.amount;

        emit PaymentRefunded(paymentId, sender, amount);

        usdc.safeTransfer(sender, amount);
    }

    /// @notice Return the full data of a payment.
    /// @param paymentId The id of the payment.
    /// @return The payment (all-zero with status NONE if it does not exist).
    function getPayment(bytes32 paymentId) external view returns (Payment memory) {
        return _payments[paymentId];
    }

    /// @notice The id that was (or will be) assigned to the payment with the given 1-based nonce.
    /// @param nonce The creation index of the payment.
    function paymentIdAt(uint256 nonce) external view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), nonce));
    }

    /// @dev Load a payment that exists and is FUNDED, reverting otherwise.
    function _fundedPayment(bytes32 paymentId) private view returns (Payment storage p) {
        p = _payments[paymentId];
        if (p.status == PaymentStatus.NONE) revert PaymentNotFound();
        if (p.status != PaymentStatus.FUNDED) revert InvalidStatus();
    }

    /// @dev A zero expiry never expires.
    function _isExpired(uint256 expiry) private view returns (bool) {
        return expiry != 0 && block.timestamp >= expiry;
    }
}
