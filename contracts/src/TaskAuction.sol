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
    function recordTaskCompletion(uint256 agentId, uint256 revenue) external;
    function recordTaskFailure(uint256 agentId) external;
    function adjustReputation(uint256 agentId, int256 delta) external;
}

/**
 * @title ITreasury
 * @notice Interface for Treasury contract
 */
interface ITreasury {
    function deposit() external payable;
    function payWorker(address worker, uint256 amount) external;
}

/**
 * @title TaskAuction
 * @notice Reverse auction marketplace for seller agents to bid on protocol tasks
 * @dev Implements PRD-001 F2 requirements:
 *      - Protocol creates tasks with type, input reference, max bid, and deadlines
 *      - Registered agents (or partnerships) submit bids during bidding window
 *      - Only agents with reputation >= 300 can bid
 *      - After bidding window closes, lowest bid wins (auto-selection)
 *      - Winner submits output before completion deadline
 *      - Protocol validates and triggers payment (+10 rep) or failure (-30 rep)
 */
contract TaskAuction is AccessControl, ReentrancyGuard, Pausable {
    // ============================================================================
    // ROLES
    // ============================================================================

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // ============================================================================
    // ENUMS
    // ============================================================================

    enum TaskType {
        CATALOG,    // 0
        REVIEW,     // 1
        CURATION,   // 2
        BUNDLED     // 3 - Requires multiple agent types
    }

    enum TaskStatus {
        Open,       // 0 - Accepting bids during bidding window
        Bidding,    // 1 - Bidding window active (alias for clarity)
        Assigned,   // 2 - Winner selected, work in progress
        Completed,  // 3 - Work submitted, awaiting validation
        Verified,   // 4 - Validated, payment released
        Failed,     // 5 - Validation failed or deadline missed
        Cancelled   // 6 - Task cancelled
    }

    enum BidStatus {
        Pending,    // 0 - Awaiting auction close
        Won,        // 1 - Lowest bid, assigned to agent
        Lost,       // 2 - Outbid by another agent
        Withdrawn   // 3 - Withdrawn by agent before close
    }

    // ============================================================================
    // STRUCTS
    // ============================================================================

    struct Task {
        uint256 id;
        TaskType taskType;
        bytes32 inputHash;          // Hash of input data (off-chain reference)
        string metadataURI;         // IPFS/HTTP URL with task details
        uint256 maxBid;             // Maximum budget in MON (wei)
        uint256 biddingDeadline;    // When bidding closes
        uint256 completionDeadline; // When work must be submitted
        TaskStatus status;
        uint256 winningBidId;       // ID of winning bid (0 if none yet)
        uint256 winningAmount;      // Winning bid amount
        bytes32 outputHash;         // Hash of submitted output
        uint256 createdAt;
    }

    struct Bid {
        uint256 id;
        uint256 taskId;
        uint256 agentId;            // Agent ID from AgentRegistry
        address agentWallet;        // Agent's wallet address
        uint256 amount;             // Bid amount in MON (wei)
        BidStatus status;
        uint256 submittedAt;
    }

    // ============================================================================
    // CONSTANTS
    // ============================================================================

    uint256 public constant MIN_REPUTATION_TO_BID = 300; // 3.0 reputation
    int256 public constant SUCCESS_REPUTATION_DELTA = 10;
    int256 public constant FAILURE_REPUTATION_DELTA = -30;

    // ============================================================================
    // STATE VARIABLES
    // ============================================================================

    IAgentRegistry public agentRegistry;
    ITreasury public treasury;

    uint256 public taskCounter;
    uint256 public bidCounter;

    // Default timing parameters (can be overridden per task)
    uint256 public defaultBiddingWindow = 5 seconds;     // PRD spec: 5 seconds
    uint256 public defaultCompletionWindow = 30 seconds; // PRD spec: 30 seconds

    // Collected protocol fees
    uint256 public protocolFeeBps = 0; // No fees in basic version

    // Storage mappings
    mapping(uint256 => Task) public tasks;
    mapping(uint256 => Bid) public bids;

    // Index mappings
    mapping(uint256 => uint256[]) public taskBids;           // taskId => bidIds
    mapping(uint256 => uint256[]) public agentTaskBids;      // agentId => bidIds
    mapping(uint256 => mapping(uint256 => bool)) public hasAgentBidOnTask; // taskId => agentId => bool

    // ============================================================================
    // EVENTS
    // ============================================================================

    event TaskCreated(
        uint256 indexed taskId,
        TaskType taskType,
        bytes32 inputHash,
        uint256 maxBid,
        uint256 biddingDeadline,
        uint256 completionDeadline
    );

    event TaskCancelled(uint256 indexed taskId);

    event BidSubmitted(
        uint256 indexed bidId,
        uint256 indexed taskId,
        uint256 indexed agentId,
        uint256 amount
    );

    event BidWithdrawn(
        uint256 indexed bidId,
        uint256 indexed taskId,
        uint256 indexed agentId
    );

    event WinnerSelected(
        uint256 indexed taskId,
        uint256 indexed bidId,
        uint256 indexed agentId,
        uint256 winningAmount
    );

    event TaskCompleted(
        uint256 indexed taskId,
        uint256 indexed agentId,
        bytes32 outputHash
    );

    event TaskValidated(
        uint256 indexed taskId,
        uint256 indexed agentId,
        bool success,
        uint256 paymentAmount
    );

    event PaymentReleased(
        uint256 indexed taskId,
        address indexed worker,
        uint256 amount
    );

    // ============================================================================
    // ERRORS
    // ============================================================================

    error ZeroAddress();
    error TaskNotFound(uint256 taskId);
    error BidNotFound(uint256 bidId);
    error InvalidTaskStatus(uint256 taskId, TaskStatus current, TaskStatus expected);
    error InvalidBidStatus(uint256 bidId, BidStatus current);
    error BiddingWindowClosed(uint256 taskId, uint256 deadline);
    error BiddingWindowNotClosed(uint256 taskId, uint256 deadline);
    error CompletionDeadlinePassed(uint256 taskId, uint256 deadline);
    error AgentNotActive(uint256 agentId);
    error InsufficientReputation(uint256 agentId, uint256 reputation, uint256 required);
    error AgentAlreadyBid(uint256 taskId, uint256 agentId);
    error BidExceedsMaxBid(uint256 bidAmount, uint256 maxBid);
    error BidTooLow(uint256 bidAmount);
    error NotWinningAgent(uint256 taskId, address caller);
    error NotBidOwner(uint256 bidId, address caller);
    error NoBidsSubmitted(uint256 taskId);
    error InvalidDeadlines();
    error TransferFailed();

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
    // PROTOCOL/OPERATOR FUNCTIONS
    // ============================================================================

    /**
     * @notice Create a new task (Protocol only)
     * @param taskType The type of work required
     * @param inputHash Hash of the input data (stored off-chain)
     * @param metadataURI URI pointing to task details
     * @param maxBid Maximum budget for this task
     * @param biddingDuration How long bidding is open (0 = use default)
     * @param completionDuration How long to complete after assignment (0 = use default)
     * @return taskId The ID of the created task
     */
    function createTask(
        TaskType taskType,
        bytes32 inputHash,
        string calldata metadataURI,
        uint256 maxBid,
        uint256 biddingDuration,
        uint256 completionDuration
    ) external payable onlyRole(OPERATOR_ROLE) nonReentrant whenNotPaused returns (uint256 taskId) {
        require(maxBid > 0, "Max bid must be positive");
        require(msg.value >= maxBid, "Must escrow max bid amount");

        // Use defaults if not specified
        if (biddingDuration == 0) biddingDuration = defaultBiddingWindow;
        if (completionDuration == 0) completionDuration = defaultCompletionWindow;

        uint256 biddingDeadline = block.timestamp + biddingDuration;
        uint256 completionDeadline = biddingDeadline + completionDuration;

        taskCounter++;
        taskId = taskCounter;

        tasks[taskId] = Task({
            id: taskId,
            taskType: taskType,
            inputHash: inputHash,
            metadataURI: metadataURI,
            maxBid: maxBid,
            biddingDeadline: biddingDeadline,
            completionDeadline: completionDeadline,
            status: TaskStatus.Open,
            winningBidId: 0,
            winningAmount: 0,
            outputHash: bytes32(0),
            createdAt: block.timestamp
        });

        emit TaskCreated(
            taskId,
            taskType,
            inputHash,
            maxBid,
            biddingDeadline,
            completionDeadline
        );
    }

    /**
     * @notice Cancel an open task and return escrowed funds
     * @param taskId The task to cancel
     */
    function cancelTask(uint256 taskId) external onlyRole(OPERATOR_ROLE) nonReentrant {
        Task storage task = tasks[taskId];

        if (task.id == 0) revert TaskNotFound(taskId);
        if (task.status != TaskStatus.Open) {
            revert InvalidTaskStatus(taskId, task.status, TaskStatus.Open);
        }

        task.status = TaskStatus.Cancelled;

        // Return escrowed funds
        (bool success, ) = msg.sender.call{value: task.maxBid}("");
        if (!success) revert TransferFailed();

        emit TaskCancelled(taskId);
    }

    /**
     * @notice Select winner after bidding closes (lowest bid wins)
     * @param taskId The task to select winner for
     */
    function selectWinner(uint256 taskId) external nonReentrant {
        Task storage task = tasks[taskId];

        if (task.id == 0) revert TaskNotFound(taskId);
        if (task.status != TaskStatus.Open) {
            revert InvalidTaskStatus(taskId, task.status, TaskStatus.Open);
        }
        if (block.timestamp < task.biddingDeadline) {
            revert BiddingWindowNotClosed(taskId, task.biddingDeadline);
        }

        uint256[] memory bidIds = taskBids[taskId];
        if (bidIds.length == 0) revert NoBidsSubmitted(taskId);

        // Find lowest pending bid
        uint256 lowestBidId = 0;
        uint256 lowestAmount = type(uint256).max;

        for (uint256 i = 0; i < bidIds.length; i++) {
            Bid storage bid = bids[bidIds[i]];
            if (bid.status == BidStatus.Pending && bid.amount < lowestAmount) {
                lowestAmount = bid.amount;
                lowestBidId = bid.id;
            }
        }

        if (lowestBidId == 0) revert NoBidsSubmitted(taskId);

        // Mark winning bid
        Bid storage winningBid = bids[lowestBidId];
        winningBid.status = BidStatus.Won;

        // Mark all other bids as lost
        for (uint256 i = 0; i < bidIds.length; i++) {
            if (bidIds[i] != lowestBidId && bids[bidIds[i]].status == BidStatus.Pending) {
                bids[bidIds[i]].status = BidStatus.Lost;
            }
        }

        // Update task
        task.status = TaskStatus.Assigned;
        task.winningBidId = lowestBidId;
        task.winningAmount = lowestAmount;

        emit WinnerSelected(taskId, lowestBidId, winningBid.agentId, lowestAmount);
    }

    /**
     * @notice Validate completed work and release payment
     * @param taskId The task to validate
     * @param approved Whether the work is approved
     */
    function validateAndPay(uint256 taskId, bool approved) external onlyRole(OPERATOR_ROLE) nonReentrant {
        Task storage task = tasks[taskId];

        if (task.id == 0) revert TaskNotFound(taskId);
        if (task.status != TaskStatus.Completed) {
            revert InvalidTaskStatus(taskId, task.status, TaskStatus.Completed);
        }

        Bid storage winningBid = bids[task.winningBidId];
        uint256 agentId = winningBid.agentId;
        address agentWallet = winningBid.agentWallet;

        if (approved) {
            // Success: pay worker, increase reputation
            task.status = TaskStatus.Verified;

            uint256 payment = task.winningAmount;
            uint256 refund = task.maxBid - payment;

            // Pay the agent
            (bool paySuccess, ) = agentWallet.call{value: payment}("");
            if (!paySuccess) revert TransferFailed();

            // Refund excess to protocol (treasury)
            if (refund > 0) {
                treasury.deposit{value: refund}();
            }

            // Update agent registry
            agentRegistry.recordTaskCompletion(agentId, payment);
            agentRegistry.adjustReputation(agentId, SUCCESS_REPUTATION_DELTA);

            emit PaymentReleased(taskId, agentWallet, payment);
            emit TaskValidated(taskId, agentId, true, payment);
        } else {
            // Failure: no payment, decrease reputation
            task.status = TaskStatus.Failed;

            // Return all escrowed funds to treasury
            treasury.deposit{value: task.maxBid}();

            // Update agent registry
            agentRegistry.recordTaskFailure(agentId);
            agentRegistry.adjustReputation(agentId, FAILURE_REPUTATION_DELTA);

            emit TaskValidated(taskId, agentId, false, 0);
        }
    }

    /**
     * @notice Mark task as failed if deadline passed without completion
     * @param taskId The task to fail
     */
    function failExpiredTask(uint256 taskId) external onlyRole(OPERATOR_ROLE) nonReentrant {
        Task storage task = tasks[taskId];

        if (task.id == 0) revert TaskNotFound(taskId);
        if (task.status != TaskStatus.Assigned) {
            revert InvalidTaskStatus(taskId, task.status, TaskStatus.Assigned);
        }
        require(block.timestamp > task.completionDeadline, "Deadline not passed");

        Bid storage winningBid = bids[task.winningBidId];

        task.status = TaskStatus.Failed;

        // Return escrowed funds to treasury
        treasury.deposit{value: task.maxBid}();

        // Penalize agent
        agentRegistry.recordTaskFailure(winningBid.agentId);
        agentRegistry.adjustReputation(winningBid.agentId, FAILURE_REPUTATION_DELTA);

        emit TaskValidated(taskId, winningBid.agentId, false, 0);
    }

    // ============================================================================
    // AGENT FUNCTIONS
    // ============================================================================

    /**
     * @notice Submit a bid on an open task
     * @param taskId The task to bid on
     * @param agentId The agent ID (from AgentRegistry)
     * @param amount The bid amount in MON (wei)
     * @return bidId The ID of the submitted bid
     */
    function submitBid(
        uint256 taskId,
        uint256 agentId,
        uint256 amount
    ) external nonReentrant whenNotPaused returns (uint256 bidId) {
        Task storage task = tasks[taskId];

        // Validate task
        if (task.id == 0) revert TaskNotFound(taskId);
        if (task.status != TaskStatus.Open) {
            revert InvalidTaskStatus(taskId, task.status, TaskStatus.Open);
        }
        if (block.timestamp >= task.biddingDeadline) {
            revert BiddingWindowClosed(taskId, task.biddingDeadline);
        }

        // Validate agent
        if (!agentRegistry.isAgentActive(agentId)) {
            revert AgentNotActive(agentId);
        }

        // Get agent details and verify caller + reputation
        IAgentRegistry.Agent memory agent = agentRegistry.getAgent(agentId);

        if (agent.walletAddress != msg.sender) {
            revert NotBidOwner(0, msg.sender);
        }

        if (agent.reputation < MIN_REPUTATION_TO_BID) {
            revert InsufficientReputation(agentId, agent.reputation, MIN_REPUTATION_TO_BID);
        }

        // Check agent hasn't already bid on this task
        if (hasAgentBidOnTask[taskId][agentId]) {
            revert AgentAlreadyBid(taskId, agentId);
        }

        // Validate bid amount
        if (amount == 0) revert BidTooLow(amount);
        if (amount > task.maxBid) {
            revert BidExceedsMaxBid(amount, task.maxBid);
        }

        // Create bid
        bidCounter++;
        bidId = bidCounter;

        bids[bidId] = Bid({
            id: bidId,
            taskId: taskId,
            agentId: agentId,
            agentWallet: agent.walletAddress,
            amount: amount,
            status: BidStatus.Pending,
            submittedAt: block.timestamp
        });

        taskBids[taskId].push(bidId);
        agentTaskBids[agentId].push(bidId);
        hasAgentBidOnTask[taskId][agentId] = true;

        emit BidSubmitted(bidId, taskId, agentId, amount);
    }

    /**
     * @notice Withdraw a pending bid (before bidding closes)
     * @param bidId The bid to withdraw
     */
    function withdrawBid(uint256 bidId) external {
        Bid storage bid = bids[bidId];

        if (bid.id == 0) revert BidNotFound(bidId);
        if (bid.status != BidStatus.Pending) {
            revert InvalidBidStatus(bidId, bid.status);
        }
        if (bid.agentWallet != msg.sender) {
            revert NotBidOwner(bidId, msg.sender);
        }

        Task storage task = tasks[bid.taskId];
        if (block.timestamp >= task.biddingDeadline) {
            revert BiddingWindowClosed(bid.taskId, task.biddingDeadline);
        }

        bid.status = BidStatus.Withdrawn;

        emit BidWithdrawn(bidId, bid.taskId, bid.agentId);
    }

    /**
     * @notice Submit completed work (winning agent only)
     * @param taskId The task that was completed
     * @param outputHash Hash of the output data (stored off-chain)
     */
    function completeTask(uint256 taskId, bytes32 outputHash) external {
        Task storage task = tasks[taskId];

        if (task.id == 0) revert TaskNotFound(taskId);
        if (task.status != TaskStatus.Assigned) {
            revert InvalidTaskStatus(taskId, task.status, TaskStatus.Assigned);
        }
        if (block.timestamp > task.completionDeadline) {
            revert CompletionDeadlinePassed(taskId, task.completionDeadline);
        }

        Bid storage winningBid = bids[task.winningBidId];
        if (winningBid.agentWallet != msg.sender) {
            revert NotWinningAgent(taskId, msg.sender);
        }

        task.status = TaskStatus.Completed;
        task.outputHash = outputHash;

        emit TaskCompleted(taskId, winningBid.agentId, outputHash);
    }

    // ============================================================================
    // ADMIN FUNCTIONS
    // ============================================================================

    function setDefaultBiddingWindow(uint256 duration) external onlyRole(DEFAULT_ADMIN_ROLE) {
        defaultBiddingWindow = duration;
    }

    function setDefaultCompletionWindow(uint256 duration) external onlyRole(DEFAULT_ADMIN_ROLE) {
        defaultCompletionWindow = duration;
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
     * @notice Get task details
     */
    function getTask(uint256 taskId) external view returns (Task memory) {
        if (tasks[taskId].id == 0) revert TaskNotFound(taskId);
        return tasks[taskId];
    }

    /**
     * @notice Get bid details
     */
    function getBid(uint256 bidId) external view returns (Bid memory) {
        if (bids[bidId].id == 0) revert BidNotFound(bidId);
        return bids[bidId];
    }

    /**
     * @notice Get all bids for a task
     */
    function getTaskBids(uint256 taskId) external view returns (uint256[] memory) {
        return taskBids[taskId];
    }

    /**
     * @notice Get all bids by an agent
     */
    function getAgentBids(uint256 agentId) external view returns (uint256[] memory) {
        return agentTaskBids[agentId];
    }

    /**
     * @notice Get total task count
     */
    function getTotalTasks() external view returns (uint256) {
        return taskCounter;
    }

    /**
     * @notice Get total bid count
     */
    function getTotalBids() external view returns (uint256) {
        return bidCounter;
    }

    /**
     * @notice Check if bidding window is open for a task
     */
    function isBiddingOpen(uint256 taskId) external view returns (bool) {
        Task storage task = tasks[taskId];
        return task.status == TaskStatus.Open && block.timestamp < task.biddingDeadline;
    }

    /**
     * @notice Get winning bid for a task
     */
    function getWinningBid(uint256 taskId) external view returns (Bid memory) {
        Task storage task = tasks[taskId];
        if (task.winningBidId == 0) revert NoBidsSubmitted(taskId);
        return bids[task.winningBidId];
    }

    /**
     * @notice Get lowest current bid for an open task
     */
    function getLowestBid(uint256 taskId) external view returns (uint256 lowestBidId, uint256 lowestAmount) {
        uint256[] memory bidIds = taskBids[taskId];
        lowestAmount = type(uint256).max;

        for (uint256 i = 0; i < bidIds.length; i++) {
            Bid storage bid = bids[bidIds[i]];
            if (bid.status == BidStatus.Pending && bid.amount < lowestAmount) {
                lowestAmount = bid.amount;
                lowestBidId = bid.id;
            }
        }
    }
}
