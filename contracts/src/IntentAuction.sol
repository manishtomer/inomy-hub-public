// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title IAgentRegistry
 * @notice Interface for AgentRegistry contract
 */
interface IAgentRegistry {
    struct Agent {
        uint256 id;
        address creator;
        address walletAddress;
        address tokenAddress;
        string name;
        uint8 agentType;
        uint8 status;
        string metadataURI;
        uint256 reputation;
        uint256 createdAt;
        uint256 totalTasksCompleted;
        uint256 totalTasksFailed;
        uint256 totalRevenue;
    }

    function getAgent(uint256 agentId) external view returns (Agent memory);
    function isAgentActive(uint256 agentId) external view returns (bool);
}

/**
 * @title ITreasury
 * @notice Interface for Treasury contract
 */
interface ITreasury {
    function deposit() external payable;
}

/**
 * @title IntentAuction
 * @notice Manages shopping intents where SELLER agents compete for customer orders
 * @dev Implements PRD-001 F3 requirements:
 *      - Anyone can create an intent with product reference, max budget, and auction duration
 *      - Registered SELLER agents can bid by paying a fee and offering a price
 *      - Offer price must be <= max budget
 *      - All bid fees are collected (not just winner's)
 *      - Winner determined by score: bidFee × (maxBudget - offerPrice) / maxBudget
 *      - Highest score wins
 *      - All collected fees go to Treasury
 *
 * Protocol Economics:
 *   SELLERS pay bid fees → IntentAuction → TREASURY
 *   Higher bid fee + lower offer price = higher score = more likely to win
 */
contract IntentAuction is AccessControl, ReentrancyGuard, Pausable {
    // ============================================================================
    // ROLES
    // ============================================================================

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // ============================================================================
    // ENUMS
    // ============================================================================

    enum IntentStatus {
        Open,       // 0 - Accepting bids during auction window
        Auction,    // 1 - Auction in progress (alias for clarity)
        Closed,     // 2 - Auction ended, winner selected
        Expired,    // 3 - Auction ended with no bids or cancelled
        Fulfilled,  // 4 - Winner completed the order
        Disputed    // 5 - Dispute raised on fulfillment
    }

    enum OfferStatus {
        Pending,    // 0 - Awaiting auction close
        Won,        // 1 - Highest score, selected as winner
        Lost,       // 2 - Outscored by another seller
        Withdrawn   // 3 - Withdrawn by seller before close
    }

    // ============================================================================
    // CONSTANTS
    // ============================================================================

    /// @notice Agent type for SELLER (from AgentRegistry)
    uint8 public constant SELLER_AGENT_TYPE = 3;

    /// @notice Minimum bid fee required
    uint256 public constant MIN_BID_FEE = 0.001 ether;

    // ============================================================================
    // STRUCTS
    // ============================================================================

    struct Intent {
        uint256 id;
        address consumer;           // Who created the intent (buyer)
        bytes32 productHash;        // Hash of product data (off-chain reference)
        string metadataURI;         // URI with detailed intent requirements
        uint256 maxBudget;          // Maximum price consumer will pay
        uint256 auctionDeadline;    // When auction closes
        IntentStatus status;
        uint256 winningOfferId;     // ID of winning offer (0 if none yet)
        uint256 winningOfferPrice;  // Price offered by winner
        uint256 totalFeesCollected; // Sum of all bid fees
        uint256 createdAt;
    }

    struct Offer {
        uint256 id;
        uint256 intentId;
        uint256 agentId;            // Agent ID from AgentRegistry
        address sellerWallet;       // Seller's wallet address
        uint256 bidFee;             // Fee paid to bid (goes to Treasury)
        uint256 offerPrice;         // Price seller is offering for the product
        uint256 score;              // Calculated score: bidFee × (maxBudget - offerPrice) / maxBudget
        OfferStatus status;
        uint256 submittedAt;
    }

    // ============================================================================
    // STATE VARIABLES
    // ============================================================================

    IAgentRegistry public agentRegistry;
    ITreasury public treasury;

    uint256 public intentCounter;
    uint256 public offerCounter;

    // Default timing parameters
    uint256 public defaultAuctionDuration = 60 seconds; // PRD spec: 60 seconds

    // Storage mappings
    mapping(uint256 => Intent) public intents;
    mapping(uint256 => Offer) public offers;

    // Index mappings
    mapping(uint256 => uint256[]) public intentOffers;              // intentId => offerIds
    mapping(uint256 => uint256[]) public agentOffers;               // agentId => offerIds
    mapping(uint256 => mapping(uint256 => bool)) public hasAgentOfferedOnIntent; // intentId => agentId => bool

    // Accumulated fees pending transfer to Treasury
    uint256 public pendingTreasuryFees;

    // ============================================================================
    // EVENTS
    // ============================================================================

    event IntentCreated(
        uint256 indexed intentId,
        address indexed consumer,
        bytes32 productHash,
        uint256 maxBudget,
        uint256 auctionDeadline
    );

    event IntentCancelled(uint256 indexed intentId);

    event OfferSubmitted(
        uint256 indexed offerId,
        uint256 indexed intentId,
        uint256 indexed agentId,
        uint256 bidFee,
        uint256 offerPrice,
        uint256 score
    );

    event OfferWithdrawn(
        uint256 indexed offerId,
        uint256 indexed intentId,
        uint256 indexed agentId
    );

    event AuctionClosed(
        uint256 indexed intentId,
        uint256 indexed winningOfferId,
        uint256 indexed winningAgentId,
        uint256 winningOfferPrice,
        uint256 totalFeesCollected
    );

    event FeesTransferredToTreasury(uint256 amount);

    event IntentFulfilled(uint256 indexed intentId, uint256 indexed agentId);

    event IntentDisputed(uint256 indexed intentId, string reason);

    // ============================================================================
    // ERRORS
    // ============================================================================

    error ZeroAddress();
    error IntentNotFound(uint256 intentId);
    error OfferNotFound(uint256 offerId);
    error InvalidIntentStatus(uint256 intentId, IntentStatus current, IntentStatus expected);
    error InvalidOfferStatus(uint256 offerId, OfferStatus current);
    error AuctionWindowClosed(uint256 intentId, uint256 deadline);
    error AuctionWindowNotClosed(uint256 intentId, uint256 deadline);
    error AgentNotActive(uint256 agentId);
    error NotSellerAgent(uint256 agentId, uint8 agentType);
    error AgentAlreadyOffered(uint256 intentId, uint256 agentId);
    error OfferPriceExceedsBudget(uint256 offerPrice, uint256 maxBudget);
    error InsufficientBidFee(uint256 provided, uint256 minimum);
    error NotOfferOwner(uint256 offerId, address caller);
    error NoOffersSubmitted(uint256 intentId);
    error NotIntentConsumer(uint256 intentId, address caller);
    error TransferFailed();
    error InvalidMaxBudget();

    // ============================================================================
    // CONSTRUCTOR
    // ============================================================================

    constructor(address _agentRegistry, address _treasury) {
        if (_agentRegistry == address(0)) revert ZeroAddress();
        if (_treasury == address(0)) revert ZeroAddress();

        agentRegistry = IAgentRegistry(_agentRegistry);
        treasury = ITreasury(_treasury);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
    }

    // ============================================================================
    // INTENT CREATION
    // ============================================================================

    /**
     * @notice Create a new shopping intent
     * @param productHash Hash of product data (off-chain reference)
     * @param metadataURI URI pointing to detailed intent requirements
     * @param maxBudget Maximum price consumer will pay
     * @param auctionDuration How long the auction runs (0 = use default)
     * @return intentId The ID of the created intent
     *
     * PRD Acceptance: Intent created with OPEN status
     */
    function createIntent(
        bytes32 productHash,
        string calldata metadataURI,
        uint256 maxBudget,
        uint256 auctionDuration
    ) external nonReentrant whenNotPaused returns (uint256 intentId) {
        if (maxBudget == 0) revert InvalidMaxBudget();

        // Use default if not specified
        if (auctionDuration == 0) auctionDuration = defaultAuctionDuration;

        uint256 auctionDeadline = block.timestamp + auctionDuration;

        intentCounter++;
        intentId = intentCounter;

        intents[intentId] = Intent({
            id: intentId,
            consumer: msg.sender,
            productHash: productHash,
            metadataURI: metadataURI,
            maxBudget: maxBudget,
            auctionDeadline: auctionDeadline,
            status: IntentStatus.Open,
            winningOfferId: 0,
            winningOfferPrice: 0,
            totalFeesCollected: 0,
            createdAt: block.timestamp
        });

        emit IntentCreated(intentId, msg.sender, productHash, maxBudget, auctionDeadline);
    }

    /**
     * @notice Cancel an open intent (consumer only)
     * @param intentId The intent to cancel
     */
    function cancelIntent(uint256 intentId) external nonReentrant {
        Intent storage intent = intents[intentId];

        if (intent.id == 0) revert IntentNotFound(intentId);
        if (intent.consumer != msg.sender) revert NotIntentConsumer(intentId, msg.sender);
        if (intent.status != IntentStatus.Open) {
            revert InvalidIntentStatus(intentId, intent.status, IntentStatus.Open);
        }

        intent.status = IntentStatus.Expired;

        // Transfer any collected fees to treasury
        if (intent.totalFeesCollected > 0) {
            _transferFeesToTreasury();
        }

        emit IntentCancelled(intentId);
    }

    // ============================================================================
    // SELLER BIDDING
    // ============================================================================

    /**
     * @notice Submit an offer on an intent
     * @param intentId The intent to bid on
     * @param agentId The seller agent ID (from AgentRegistry)
     * @param offerPrice The price the seller is offering for the product
     * @return offerId The ID of the submitted offer
     *
     * PRD Acceptance:
     *   - Only SELLER type agents can bid
     *   - Bid requires payment (msg.value > 0)
     *   - Bid rejected if offerPrice > maxBudget
     *   - Score calculated correctly per formula
     */
    function submitOffer(
        uint256 intentId,
        uint256 agentId,
        uint256 offerPrice
    ) external payable nonReentrant whenNotPaused returns (uint256 offerId) {
        Intent storage intent = intents[intentId];

        // Validate intent
        if (intent.id == 0) revert IntentNotFound(intentId);
        if (intent.status != IntentStatus.Open) {
            revert InvalidIntentStatus(intentId, intent.status, IntentStatus.Open);
        }
        if (block.timestamp >= intent.auctionDeadline) {
            revert AuctionWindowClosed(intentId, intent.auctionDeadline);
        }

        // Validate bid fee (PRD: Bid requires payment)
        if (msg.value < MIN_BID_FEE) {
            revert InsufficientBidFee(msg.value, MIN_BID_FEE);
        }

        // Validate offer price (PRD: Bid rejected if offerPrice > maxBudget)
        if (offerPrice > intent.maxBudget) {
            revert OfferPriceExceedsBudget(offerPrice, intent.maxBudget);
        }

        // Validate agent
        if (!agentRegistry.isAgentActive(agentId)) {
            revert AgentNotActive(agentId);
        }

        // Get agent details and verify caller + agent type
        IAgentRegistry.Agent memory agent = agentRegistry.getAgent(agentId);

        if (agent.walletAddress != msg.sender) {
            revert NotOfferOwner(0, msg.sender);
        }

        // PRD: Only SELLER type agents can bid
        if (agent.agentType != SELLER_AGENT_TYPE) {
            revert NotSellerAgent(agentId, agent.agentType);
        }

        // Check agent hasn't already bid on this intent
        if (hasAgentOfferedOnIntent[intentId][agentId]) {
            revert AgentAlreadyOffered(intentId, agentId);
        }

        // Calculate score: bidFee × (maxBudget - offerPrice) / maxBudget
        // This rewards: higher bid fees AND lower offer prices
        // Score in basis points for precision (multiply by 10000)
        uint256 score = _calculateScore(msg.value, offerPrice, intent.maxBudget);

        // Create offer
        offerCounter++;
        offerId = offerCounter;

        offers[offerId] = Offer({
            id: offerId,
            intentId: intentId,
            agentId: agentId,
            sellerWallet: agent.walletAddress,
            bidFee: msg.value,
            offerPrice: offerPrice,
            score: score,
            status: OfferStatus.Pending,
            submittedAt: block.timestamp
        });

        // Update intent fees
        intent.totalFeesCollected += msg.value;
        pendingTreasuryFees += msg.value;

        // Update indexes
        intentOffers[intentId].push(offerId);
        agentOffers[agentId].push(offerId);
        hasAgentOfferedOnIntent[intentId][agentId] = true;

        emit OfferSubmitted(offerId, intentId, agentId, msg.value, offerPrice, score);
    }

    /**
     * @notice Calculate offer score
     * @dev Score = bidFee × (maxBudget - offerPrice) / maxBudget
     *      Higher bid fee + lower offer price = higher score
     * @param bidFee The bid fee paid
     * @param offerPrice The price being offered
     * @param maxBudget The intent's max budget
     * @return score The calculated score (scaled by 1e18 for precision)
     */
    function _calculateScore(
        uint256 bidFee,
        uint256 offerPrice,
        uint256 maxBudget
    ) internal pure returns (uint256 score) {
        // score = bidFee × (maxBudget - offerPrice) / maxBudget
        // Scale by 1e18 for precision
        uint256 discount = maxBudget - offerPrice;
        score = (bidFee * discount * 1e18) / maxBudget;
    }

    /**
     * @notice Withdraw a pending offer (before auction closes)
     * @param offerId The offer to withdraw
     * @dev Note: Bid fee is NOT refunded (collected as protocol revenue)
     */
    function withdrawOffer(uint256 offerId) external {
        Offer storage offer = offers[offerId];

        if (offer.id == 0) revert OfferNotFound(offerId);
        if (offer.status != OfferStatus.Pending) {
            revert InvalidOfferStatus(offerId, offer.status);
        }
        if (offer.sellerWallet != msg.sender) {
            revert NotOfferOwner(offerId, msg.sender);
        }

        Intent storage intent = intents[offer.intentId];
        if (block.timestamp >= intent.auctionDeadline) {
            revert AuctionWindowClosed(offer.intentId, intent.auctionDeadline);
        }

        offer.status = OfferStatus.Withdrawn;

        emit OfferWithdrawn(offerId, offer.intentId, offer.agentId);
    }

    // ============================================================================
    // AUCTION CLOSING
    // ============================================================================

    /**
     * @notice Close the auction and select winner (highest score wins)
     * @param intentId The intent auction to close
     *
     * PRD Acceptance:
     *   - closeAuction() selects highest score as winner
     *   - All bid amounts transferred to Treasury
     *   - Intent status updated to CLOSED
     */
    function closeAuction(uint256 intentId) external nonReentrant {
        Intent storage intent = intents[intentId];

        if (intent.id == 0) revert IntentNotFound(intentId);
        if (intent.status != IntentStatus.Open) {
            revert InvalidIntentStatus(intentId, intent.status, IntentStatus.Open);
        }
        if (block.timestamp < intent.auctionDeadline) {
            revert AuctionWindowNotClosed(intentId, intent.auctionDeadline);
        }

        uint256[] memory offerIds = intentOffers[intentId];

        // Check if there are any valid (pending) offers
        uint256 highestOfferId = 0;
        uint256 highestScore = 0;

        for (uint256 i = 0; i < offerIds.length; i++) {
            Offer storage offer = offers[offerIds[i]];
            if (offer.status == OfferStatus.Pending && offer.score > highestScore) {
                highestScore = offer.score;
                highestOfferId = offer.id;
            }
        }

        if (highestOfferId == 0) {
            // No valid offers - expire the intent
            intent.status = IntentStatus.Expired;

            // Still transfer any fees to treasury
            if (intent.totalFeesCollected > 0) {
                _transferFeesToTreasury();
            }

            return;
        }

        // Mark winning offer
        Offer storage winningOffer = offers[highestOfferId];
        winningOffer.status = OfferStatus.Won;

        // Mark all other pending offers as lost
        for (uint256 i = 0; i < offerIds.length; i++) {
            if (offerIds[i] != highestOfferId && offers[offerIds[i]].status == OfferStatus.Pending) {
                offers[offerIds[i]].status = OfferStatus.Lost;
            }
        }

        // Update intent
        intent.status = IntentStatus.Closed;
        intent.winningOfferId = highestOfferId;
        intent.winningOfferPrice = winningOffer.offerPrice;

        // Transfer all collected fees to Treasury (PRD: All bid amounts transferred to Treasury)
        _transferFeesToTreasury();

        emit AuctionClosed(
            intentId,
            highestOfferId,
            winningOffer.agentId,
            winningOffer.offerPrice,
            intent.totalFeesCollected
        );
    }

    /**
     * @notice Transfer accumulated fees to Treasury
     */
    function _transferFeesToTreasury() internal {
        if (pendingTreasuryFees > 0) {
            uint256 amount = pendingTreasuryFees;
            pendingTreasuryFees = 0;

            treasury.deposit{value: amount}();

            emit FeesTransferredToTreasury(amount);
        }
    }

    /**
     * @notice Manually flush fees to Treasury (can be called by anyone)
     */
    function flushFeesToTreasury() external nonReentrant {
        _transferFeesToTreasury();
    }

    // ============================================================================
    // FULFILLMENT
    // ============================================================================

    /**
     * @notice Mark intent as fulfilled (winner completed order)
     * @param intentId The intent to mark as fulfilled
     */
    function markFulfilled(uint256 intentId) external onlyRole(OPERATOR_ROLE) {
        Intent storage intent = intents[intentId];

        if (intent.id == 0) revert IntentNotFound(intentId);
        if (intent.status != IntentStatus.Closed) {
            revert InvalidIntentStatus(intentId, intent.status, IntentStatus.Closed);
        }

        intent.status = IntentStatus.Fulfilled;

        Offer storage winningOffer = offers[intent.winningOfferId];
        emit IntentFulfilled(intentId, winningOffer.agentId);
    }

    /**
     * @notice Raise a dispute on fulfillment
     * @param intentId The intent to dispute
     * @param reason The reason for dispute
     */
    function raiseDispute(uint256 intentId, string calldata reason) external {
        Intent storage intent = intents[intentId];

        if (intent.id == 0) revert IntentNotFound(intentId);
        if (intent.consumer != msg.sender) revert NotIntentConsumer(intentId, msg.sender);
        if (intent.status != IntentStatus.Closed && intent.status != IntentStatus.Fulfilled) {
            revert InvalidIntentStatus(intentId, intent.status, IntentStatus.Closed);
        }

        intent.status = IntentStatus.Disputed;

        emit IntentDisputed(intentId, reason);
    }

    // ============================================================================
    // ADMIN FUNCTIONS
    // ============================================================================

    function setDefaultAuctionDuration(uint256 duration) external onlyRole(DEFAULT_ADMIN_ROLE) {
        defaultAuctionDuration = duration;
    }

    function setAgentRegistry(address newRegistry) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newRegistry == address(0)) revert ZeroAddress();
        agentRegistry = IAgentRegistry(newRegistry);
    }

    function setTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newTreasury == address(0)) revert ZeroAddress();
        treasury = ITreasury(newTreasury);
    }

    function pause() external onlyRole(OPERATOR_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(OPERATOR_ROLE) {
        _unpause();
    }

    function addOperator(address operator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(OPERATOR_ROLE, operator);
    }

    function removeOperator(address operator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(OPERATOR_ROLE, operator);
    }

    // ============================================================================
    // VIEW FUNCTIONS
    // ============================================================================

    /**
     * @notice Get intent details
     */
    function getIntent(uint256 intentId) external view returns (Intent memory) {
        if (intents[intentId].id == 0) revert IntentNotFound(intentId);
        return intents[intentId];
    }

    /**
     * @notice Get offer details
     */
    function getOffer(uint256 offerId) external view returns (Offer memory) {
        if (offers[offerId].id == 0) revert OfferNotFound(offerId);
        return offers[offerId];
    }

    /**
     * @notice Get all offers for an intent
     */
    function getIntentOffers(uint256 intentId) external view returns (uint256[] memory) {
        return intentOffers[intentId];
    }

    /**
     * @notice Get all offers by an agent
     */
    function getAgentOffers(uint256 agentId) external view returns (uint256[] memory) {
        return agentOffers[agentId];
    }

    /**
     * @notice Get total intent count
     */
    function getTotalIntents() external view returns (uint256) {
        return intentCounter;
    }

    /**
     * @notice Get total offer count
     */
    function getTotalOffers() external view returns (uint256) {
        return offerCounter;
    }

    /**
     * @notice Check if auction is still open for an intent
     */
    function isAuctionOpen(uint256 intentId) external view returns (bool) {
        Intent storage intent = intents[intentId];
        return intent.status == IntentStatus.Open && block.timestamp < intent.auctionDeadline;
    }

    /**
     * @notice Get winning offer for an intent
     */
    function getWinningOffer(uint256 intentId) external view returns (Offer memory) {
        Intent storage intent = intents[intentId];
        if (intent.winningOfferId == 0) revert NoOffersSubmitted(intentId);
        return offers[intent.winningOfferId];
    }

    /**
     * @notice Get highest scoring offer for an open intent (preview winner)
     */
    function getHighestScoringOffer(uint256 intentId) external view returns (uint256 offerId, uint256 score) {
        uint256[] memory offerIds = intentOffers[intentId];
        score = 0;

        for (uint256 i = 0; i < offerIds.length; i++) {
            Offer storage offer = offers[offerIds[i]];
            if (offer.status == OfferStatus.Pending && offer.score > score) {
                score = offer.score;
                offerId = offer.id;
            }
        }
    }

    /**
     * @notice Calculate score for given parameters (helper for sellers)
     */
    function calculateScore(
        uint256 bidFee,
        uint256 offerPrice,
        uint256 maxBudget
    ) external pure returns (uint256) {
        if (offerPrice > maxBudget) return 0;
        return _calculateScore(bidFee, offerPrice, maxBudget);
    }
}
