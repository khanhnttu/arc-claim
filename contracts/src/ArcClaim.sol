// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ArcClaim
/// @notice Programmable, expiring USDC payments. A sender locks USDC for a recipient, who can
///         claim it before the expiry. Unclaimed funds can be cancelled by the sender before
///         expiry, or refunded to the sender by anyone after expiry.
/// @dev No owner, no admin, no upgradeability. Funds can only ever move to a claim's sender or recipient.
contract ArcClaim is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum ClaimStatus {
        NONE,
        FUNDED,
        CLAIMED,
        CANCELLED,
        REFUNDED
    }

    struct Claim {
        address sender;
        address recipient;
        uint256 amount;
        uint256 expiry;
        ClaimStatus status;
    }

    /// @notice The USDC token used for all claims.
    IERC20 public immutable usdc;

    /// @notice The id that the next created claim will receive. Ids start at 1.
    uint256 public nextClaimId = 1;

    mapping(uint256 claimId => Claim) private _claims;

    event ClaimCreated(
        uint256 indexed claimId, address indexed sender, address indexed recipient, uint256 amount, uint256 expiry
    );
    event Claimed(uint256 indexed claimId, address indexed recipient, uint256 amount);
    event Cancelled(uint256 indexed claimId, address indexed sender, uint256 amount);
    event ExpiredRefunded(uint256 indexed claimId, address indexed sender, uint256 amount);

    error InvalidToken();
    error InvalidRecipient();
    error InvalidAmount();
    error InvalidExpiry();
    error ClaimNotFound();
    error InvalidStatus();
    error NotRecipient();
    error NotSender();
    error ClaimExpired();
    error ClaimNotExpired();

    /// @param usdc_ Address of the USDC (ERC-20) token.
    constructor(address usdc_) {
        if (usdc_ == address(0)) revert InvalidToken();
        usdc = IERC20(usdc_);
    }

    /// @notice Create a claim and lock `amount` USDC from the caller for `recipient`.
    /// @dev The caller must have approved this contract for at least `amount` USDC.
    /// @param recipient The only address allowed to claim the funds.
    /// @param amount The USDC amount to lock (token base units).
    /// @param expiry Unix timestamp; the claim can be claimed while `block.timestamp < expiry`.
    /// @return claimId The id of the newly created claim.
    function createClaim(address recipient, uint256 amount, uint256 expiry)
        external
        nonReentrant
        returns (uint256 claimId)
    {
        if (recipient == address(0)) revert InvalidRecipient();
        if (amount == 0) revert InvalidAmount();
        if (expiry <= block.timestamp) revert InvalidExpiry();

        claimId = nextClaimId++;
        _claims[claimId] = Claim({
            sender: msg.sender, recipient: recipient, amount: amount, expiry: expiry, status: ClaimStatus.FUNDED
        });

        emit ClaimCreated(claimId, msg.sender, recipient, amount, expiry);

        usdc.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Claim the locked USDC. Only the claim's recipient may call, and only before expiry.
    /// @param claimId The id of the claim.
    function claim(uint256 claimId) external nonReentrant {
        Claim storage c = _fundedClaim(claimId);
        if (msg.sender != c.recipient) revert NotRecipient();
        if (block.timestamp >= c.expiry) revert ClaimExpired();

        c.status = ClaimStatus.CLAIMED;
        uint256 amount = c.amount;

        emit Claimed(claimId, msg.sender, amount);

        usdc.safeTransfer(msg.sender, amount);
    }

    /// @notice Cancel an unclaimed, unexpired claim and return the USDC to the sender.
    /// @param claimId The id of the claim.
    function cancel(uint256 claimId) external nonReentrant {
        Claim storage c = _fundedClaim(claimId);
        if (msg.sender != c.sender) revert NotSender();
        if (block.timestamp >= c.expiry) revert ClaimExpired();

        c.status = ClaimStatus.CANCELLED;
        uint256 amount = c.amount;

        emit Cancelled(claimId, msg.sender, amount);

        usdc.safeTransfer(msg.sender, amount);
    }

    /// @notice Return the USDC of an expired, unclaimed claim to its sender. Callable by anyone.
    /// @param claimId The id of the claim.
    function refundExpired(uint256 claimId) external nonReentrant {
        Claim storage c = _fundedClaim(claimId);
        if (block.timestamp < c.expiry) revert ClaimNotExpired();

        c.status = ClaimStatus.REFUNDED;
        address sender = c.sender;
        uint256 amount = c.amount;

        emit ExpiredRefunded(claimId, sender, amount);

        usdc.safeTransfer(sender, amount);
    }

    /// @notice Return the full data of a claim.
    /// @param claimId The id of the claim.
    /// @return The claim (all-zero with status NONE if it does not exist).
    function getClaim(uint256 claimId) external view returns (Claim memory) {
        return _claims[claimId];
    }

    /// @dev Load a claim that exists and is FUNDED, reverting otherwise.
    function _fundedClaim(uint256 claimId) private view returns (Claim storage c) {
        c = _claims[claimId];
        if (c.status == ClaimStatus.NONE) revert ClaimNotFound();
        if (c.status != ClaimStatus.FUNDED) revert InvalidStatus();
    }
}
