// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title Partnership
 * @notice PRD-001 F4: Manages partnerships between agents of different types
 * @dev Enables agents to form partnerships, negotiate splits, and operate as bidding entities
 *
 * Key Features:
 * - Only agents of DIFFERENT types can form partnerships
 * - Revenue split percentages must sum to 100
 * - Counter-offers linked to original proposals
 * - Partnership can bid on TaskAuction as single entity
 * - Both partners must submit work for completion
 * - Automatic revenue splitting
 * - Mutual agreement required for dissolution
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

interface ITaskAuction {
    function submitBid(uint256 taskId, uint256 agentId, uint256 bidAmount) external;
    function completeTask(uint256 taskId) external;
}

contract Partnership is AccessControl, ReentrancyGuard, Pausable {

    // ============ Errors ============

    error ZeroAddress();
    error SameAgentType(uint256 agent1Id, uint256 agent2Id, uint8 agentType);
    error SplitsMustSumTo100(uint256 actualSum);
    error InvalidSplitValue(uint256 value);
    error ProposalNotFound(uint256 proposalId);
    error ProposalNotPending(uint256 proposalId);
    error NotProposalTarget(uint256 proposalId, address caller);
    error NotProposalInitiator(uint256 proposalId, address caller);
    error NotPartnershipMember(uint256 partnershipId, address caller);
    error PartnershipNotActive(uint256 partnershipId);
    error PartnershipNotFound(uint256 partnershipId);
    error WorkAlreadySubmitted(uint256 partnershipId, uint256 taskId, uint256 agentId);
    error NotAllWorkSubmitted(uint256 partnershipId, uint256 taskId);
    error NoFundsToWithdraw(uint256 partnershipId, uint256 agentId);
    error DissolutionNotInitiated(uint256 partnershipId);
    error AlreadyAgreedToDissolution(uint256 partnershipId, uint256 agentId);
    error NotAgentWallet(uint256 agentId, address caller);
    error TaskNotAssigned(uint256 partnershipId, uint256 taskId);
    error InsufficientBalance(uint256 available, uint256 required);

    // ============ Enums ============

    enum ProposalStatus {
        Pending,     // Awaiting response
        Accepted,    // Target accepted, partnership created
        Rejected,    // Target rejected
        CounterOffered, // Target counter-offered
        Expired,     // Expired without response
        Withdrawn    // Initiator withdrew proposal
    }

    enum PartnershipStatus {
        Active,      // Partnership is operational
        Dissolving,  // Dissolution initiated, awaiting agreement
        Dissolved    // Partnership dissolved
    }

    // ============ Structs ============

    struct Proposal {
        uint256 id;
        uint256 initiatorAgentId;
        uint256 targetAgentId;
        uint256 initiatorSplit;    // Percentage (0-100)
        uint256 targetSplit;       // Percentage (0-100)
        ProposalStatus status;
        uint256 linkedProposalId;  // For counter-offers
        uint256 createdAt;
        uint256 expiresAt;
    }

    struct PartnershipData {
        uint256 id;
        uint256 agent1Id;
        uint256 agent2Id;
        uint256 agent1Split;       // Percentage (0-100)
        uint256 agent2Split;       // Percentage (0-100)
        PartnershipStatus status;
        uint256 totalRevenue;
        uint256 agent1Withdrawn;
        uint256 agent2Withdrawn;
        uint256 createdAt;
        uint256 fromProposalId;
        bool agent1DissolveAgreed;
        bool agent2DissolveAgreed;
    }

    struct TaskWork {
        bool agent1Submitted;
        bool agent2Submitted;
        bytes32 agent1OutputHash;
        bytes32 agent2OutputHash;
    }

    // ============ State Variables ============

    IAgentRegistry public agentRegistry;
    ITaskAuction public taskAuction;

    uint256 public proposalIdCounter;
    uint256 public partnershipIdCounter;
    uint256 public defaultProposalDuration = 1 days;

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => PartnershipData) public partnerships;

    // Partnership tasks: partnershipId => taskId => TaskWork
    mapping(uint256 => mapping(uint256 => TaskWork)) public partnershipTasks;

    // Track assigned tasks to partnerships: partnershipId => taskId[]
    mapping(uint256 => uint256[]) public assignedTasks;

    // Track partnerships by agent: agentId => partnershipId[]
    mapping(uint256 => uint256[]) public agentPartnerships;

    // Track proposals by agent: agentId => proposalId[]
    mapping(uint256 => uint256[]) public agentProposals;

    // ============ Events ============

    event ProposalCreated(
        uint256 indexed proposalId,
        uint256 indexed initiatorAgentId,
        uint256 indexed targetAgentId,
        uint256 initiatorSplit,
        uint256 targetSplit,
        uint256 expiresAt
    );

    event ProposalAccepted(
        uint256 indexed proposalId,
        uint256 indexed partnershipId
    );

    event ProposalRejected(uint256 indexed proposalId);

    event CounterOfferCreated(
        uint256 indexed originalProposalId,
        uint256 indexed counterProposalId,
        uint256 newInitiatorSplit,
        uint256 newTargetSplit
    );

    event ProposalWithdrawn(uint256 indexed proposalId);

    event PartnershipCreated(
        uint256 indexed partnershipId,
        uint256 indexed agent1Id,
        uint256 indexed agent2Id,
        uint256 agent1Split,
        uint256 agent2Split
    );

    event TaskBidSubmitted(
        uint256 indexed partnershipId,
        uint256 indexed taskId,
        uint256 bidAmount
    );

    event WorkSubmitted(
        uint256 indexed partnershipId,
        uint256 indexed taskId,
        uint256 indexed agentId,
        bytes32 outputHash
    );

    event TaskCompleted(
        uint256 indexed partnershipId,
        uint256 indexed taskId
    );

    event RevenueReceived(
        uint256 indexed partnershipId,
        uint256 amount,
        uint256 newTotalRevenue
    );

    event FundsWithdrawn(
        uint256 indexed partnershipId,
        uint256 indexed agentId,
        uint256 amount
    );

    event DissolutionInitiated(
        uint256 indexed partnershipId,
        uint256 indexed initiatorAgentId
    );

    event DissolutionAgreed(
        uint256 indexed partnershipId,
        uint256 indexed agentId
    );

    event PartnershipDissolved(uint256 indexed partnershipId);

    // ============ Constructor ============

    constructor(address _agentRegistry, address _taskAuction) {
        if (_agentRegistry == address(0)) revert ZeroAddress();
        if (_taskAuction == address(0)) revert ZeroAddress();

        agentRegistry = IAgentRegistry(_agentRegistry);
        taskAuction = ITaskAuction(_taskAuction);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ============ Proposal Functions ============

    /**
     * @notice Propose a partnership to another agent
     * @dev PRD F4: Only agents of DIFFERENT types can form partnerships
     * @param initiatorAgentId The proposing agent's ID
     * @param targetAgentId The target agent's ID
     * @param initiatorSplit Proposer's revenue split percentage (0-100)
     * @param targetSplit Target's revenue split percentage (0-100)
     * @return proposalId The created proposal ID
     */
    function proposePartnership(
        uint256 initiatorAgentId,
        uint256 targetAgentId,
        uint256 initiatorSplit,
        uint256 targetSplit
    ) external whenNotPaused returns (uint256 proposalId) {
        return _proposePartnership(
            initiatorAgentId,
            targetAgentId,
            initiatorSplit,
            targetSplit,
            0 // No linked proposal
        );
    }

    /**
     * @notice Propose with custom expiration duration
     */
    function proposePartnershipWithDuration(
        uint256 initiatorAgentId,
        uint256 targetAgentId,
        uint256 initiatorSplit,
        uint256 targetSplit,
        uint256 duration
    ) external whenNotPaused returns (uint256 proposalId) {
        return _proposePartnershipInternal(
            initiatorAgentId,
            targetAgentId,
            initiatorSplit,
            targetSplit,
            0,
            duration
        );
    }

    function _proposePartnership(
        uint256 initiatorAgentId,
        uint256 targetAgentId,
        uint256 initiatorSplit,
        uint256 targetSplit,
        uint256 linkedProposalId
    ) internal returns (uint256 proposalId) {
        return _proposePartnershipInternal(
            initiatorAgentId,
            targetAgentId,
            initiatorSplit,
            targetSplit,
            linkedProposalId,
            defaultProposalDuration
        );
    }

    function _proposePartnershipInternal(
        uint256 initiatorAgentId,
        uint256 targetAgentId,
        uint256 initiatorSplit,
        uint256 targetSplit,
        uint256 linkedProposalId,
        uint256 duration
    ) internal returns (uint256 proposalId) {
        // Verify caller owns initiator agent
        IAgentRegistry.Agent memory initiatorAgent = agentRegistry.getAgent(initiatorAgentId);
        if (initiatorAgent.walletAddress != msg.sender) {
            revert NotAgentWallet(initiatorAgentId, msg.sender);
        }

        // Get target agent
        IAgentRegistry.Agent memory targetAgent = agentRegistry.getAgent(targetAgentId);

        // PRD F4: Proposal rejected if both agents are same type
        if (initiatorAgent.agentType == targetAgent.agentType) {
            revert SameAgentType(initiatorAgentId, targetAgentId, initiatorAgent.agentType);
        }

        // PRD F4: Proposal rejected if splits don't sum to 100
        if (initiatorSplit + targetSplit != 100) {
            revert SplitsMustSumTo100(initiatorSplit + targetSplit);
        }

        // Validate split values
        if (initiatorSplit > 100 || targetSplit > 100) {
            revert InvalidSplitValue(initiatorSplit > 100 ? initiatorSplit : targetSplit);
        }

        proposalIdCounter++;
        proposalId = proposalIdCounter;

        proposals[proposalId] = Proposal({
            id: proposalId,
            initiatorAgentId: initiatorAgentId,
            targetAgentId: targetAgentId,
            initiatorSplit: initiatorSplit,
            targetSplit: targetSplit,
            status: ProposalStatus.Pending,
            linkedProposalId: linkedProposalId,
            createdAt: block.timestamp,
            expiresAt: block.timestamp + duration
        });

        agentProposals[initiatorAgentId].push(proposalId);
        agentProposals[targetAgentId].push(proposalId);

        emit ProposalCreated(
            proposalId,
            initiatorAgentId,
            targetAgentId,
            initiatorSplit,
            targetSplit,
            block.timestamp + duration
        );
    }

    /**
     * @notice Accept a partnership proposal
     * @dev PRD F4: Accept deploys partnership and returns its address
     * @param proposalId The proposal ID to accept
     * @return partnershipId The created partnership ID
     */
    function acceptProposal(uint256 proposalId)
        external
        whenNotPaused
        returns (uint256 partnershipId)
    {
        Proposal storage proposal = proposals[proposalId];

        if (proposal.id == 0) revert ProposalNotFound(proposalId);
        if (proposal.status != ProposalStatus.Pending) revert ProposalNotPending(proposalId);
        if (block.timestamp > proposal.expiresAt) {
            proposal.status = ProposalStatus.Expired;
            revert ProposalNotPending(proposalId);
        }

        // Verify caller owns target agent
        IAgentRegistry.Agent memory targetAgent = agentRegistry.getAgent(proposal.targetAgentId);
        if (targetAgent.walletAddress != msg.sender) {
            revert NotProposalTarget(proposalId, msg.sender);
        }

        // Update proposal status
        proposal.status = ProposalStatus.Accepted;

        // Create partnership
        partnershipIdCounter++;
        partnershipId = partnershipIdCounter;

        partnerships[partnershipId] = PartnershipData({
            id: partnershipId,
            agent1Id: proposal.initiatorAgentId,
            agent2Id: proposal.targetAgentId,
            agent1Split: proposal.initiatorSplit,
            agent2Split: proposal.targetSplit,
            status: PartnershipStatus.Active,
            totalRevenue: 0,
            agent1Withdrawn: 0,
            agent2Withdrawn: 0,
            createdAt: block.timestamp,
            fromProposalId: proposalId,
            agent1DissolveAgreed: false,
            agent2DissolveAgreed: false
        });

        agentPartnerships[proposal.initiatorAgentId].push(partnershipId);
        agentPartnerships[proposal.targetAgentId].push(partnershipId);

        emit ProposalAccepted(proposalId, partnershipId);
        emit PartnershipCreated(
            partnershipId,
            proposal.initiatorAgentId,
            proposal.targetAgentId,
            proposal.initiatorSplit,
            proposal.targetSplit
        );
    }

    /**
     * @notice Reject a partnership proposal
     * @param proposalId The proposal ID to reject
     */
    function rejectProposal(uint256 proposalId) external whenNotPaused {
        Proposal storage proposal = proposals[proposalId];

        if (proposal.id == 0) revert ProposalNotFound(proposalId);
        if (proposal.status != ProposalStatus.Pending) revert ProposalNotPending(proposalId);

        // Verify caller owns target agent
        IAgentRegistry.Agent memory targetAgent = agentRegistry.getAgent(proposal.targetAgentId);
        if (targetAgent.walletAddress != msg.sender) {
            revert NotProposalTarget(proposalId, msg.sender);
        }

        proposal.status = ProposalStatus.Rejected;

        emit ProposalRejected(proposalId);
    }

    /**
     * @notice Counter-offer with different split percentages
     * @dev PRD F4: Counter-offer creates new proposal linked to original
     * @param originalProposalId The original proposal ID
     * @param newTargetSplit The counter-offered split for target (original initiator gets 100 - this)
     * @return counterProposalId The new counter-proposal ID
     */
    function counterOffer(uint256 originalProposalId, uint256 newTargetSplit)
        external
        whenNotPaused
        returns (uint256 counterProposalId)
    {
        Proposal storage original = proposals[originalProposalId];

        if (original.id == 0) revert ProposalNotFound(originalProposalId);
        if (original.status != ProposalStatus.Pending) revert ProposalNotPending(originalProposalId);

        // Verify caller owns target agent of original proposal
        IAgentRegistry.Agent memory targetAgent = agentRegistry.getAgent(original.targetAgentId);
        if (targetAgent.walletAddress != msg.sender) {
            revert NotProposalTarget(originalProposalId, msg.sender);
        }

        // Mark original as counter-offered
        original.status = ProposalStatus.CounterOffered;

        // Create counter-proposal (roles reversed: target becomes initiator)
        uint256 newInitiatorSplit = 100 - newTargetSplit;

        counterProposalId = _proposePartnership(
            original.targetAgentId,      // Now the initiator
            original.initiatorAgentId,   // Now the target
            newTargetSplit,              // Counter-offerer's split
            newInitiatorSplit,           // Original initiator's split
            originalProposalId           // Link to original
        );

        emit CounterOfferCreated(
            originalProposalId,
            counterProposalId,
            newInitiatorSplit,
            newTargetSplit
        );
    }

    /**
     * @notice Withdraw a pending proposal
     * @param proposalId The proposal ID to withdraw
     */
    function withdrawProposal(uint256 proposalId) external whenNotPaused {
        Proposal storage proposal = proposals[proposalId];

        if (proposal.id == 0) revert ProposalNotFound(proposalId);
        if (proposal.status != ProposalStatus.Pending) revert ProposalNotPending(proposalId);

        // Verify caller owns initiator agent
        IAgentRegistry.Agent memory initiatorAgent = agentRegistry.getAgent(proposal.initiatorAgentId);
        if (initiatorAgent.walletAddress != msg.sender) {
            revert NotProposalInitiator(proposalId, msg.sender);
        }

        proposal.status = ProposalStatus.Withdrawn;

        emit ProposalWithdrawn(proposalId);
    }

    // ============ Task Functions ============

    /**
     * @notice Submit a bid on a task as a partnership
     * @dev PRD F4: Partnership can bid on TaskAuction as single entity
     * @param partnershipId The partnership ID
     * @param taskId The task ID to bid on
     * @param bidAmount The bid amount
     */
    function submitTaskBid(
        uint256 partnershipId,
        uint256 taskId,
        uint256 bidAmount
    ) external whenNotPaused {
        PartnershipData storage partnership = partnerships[partnershipId];

        if (partnership.id == 0) revert PartnershipNotFound(partnershipId);
        if (partnership.status != PartnershipStatus.Active) {
            revert PartnershipNotActive(partnershipId);
        }

        // Verify caller is a partner
        _verifyPartner(partnershipId, msg.sender);

        // Submit bid to TaskAuction using agent1's ID (partnership representative)
        taskAuction.submitBid(taskId, partnership.agent1Id, bidAmount);

        // Track the task
        assignedTasks[partnershipId].push(taskId);

        emit TaskBidSubmitted(partnershipId, taskId, bidAmount);
    }

    /**
     * @notice Submit work for a partnership task
     * @dev PRD F4: submitWork() tracks which partners have submitted
     * @param partnershipId The partnership ID
     * @param taskId The task ID
     * @param agentId The submitting agent's ID
     * @param outputHash Hash of the work output
     */
    function submitWork(
        uint256 partnershipId,
        uint256 taskId,
        uint256 agentId,
        bytes32 outputHash
    ) external whenNotPaused {
        PartnershipData storage partnership = partnerships[partnershipId];

        if (partnership.id == 0) revert PartnershipNotFound(partnershipId);
        if (partnership.status != PartnershipStatus.Active) {
            revert PartnershipNotActive(partnershipId);
        }

        // Verify caller owns the agent
        IAgentRegistry.Agent memory agent = agentRegistry.getAgent(agentId);
        if (agent.walletAddress != msg.sender) {
            revert NotAgentWallet(agentId, msg.sender);
        }

        // Verify agent is part of this partnership
        if (agentId != partnership.agent1Id && agentId != partnership.agent2Id) {
            revert NotPartnershipMember(partnershipId, msg.sender);
        }

        TaskWork storage work = partnershipTasks[partnershipId][taskId];

        // Track submission
        if (agentId == partnership.agent1Id) {
            if (work.agent1Submitted) {
                revert WorkAlreadySubmitted(partnershipId, taskId, agentId);
            }
            work.agent1Submitted = true;
            work.agent1OutputHash = outputHash;
        } else {
            if (work.agent2Submitted) {
                revert WorkAlreadySubmitted(partnershipId, taskId, agentId);
            }
            work.agent2Submitted = true;
            work.agent2OutputHash = outputHash;
        }

        emit WorkSubmitted(partnershipId, taskId, agentId, outputHash);
    }

    /**
     * @notice Complete a task after all partners have submitted work
     * @dev PRD F4: Task only completes when all partners submit
     * @param partnershipId The partnership ID
     * @param taskId The task ID
     */
    function completePartnershipTask(
        uint256 partnershipId,
        uint256 taskId
    ) external whenNotPaused {
        PartnershipData storage partnership = partnerships[partnershipId];

        if (partnership.id == 0) revert PartnershipNotFound(partnershipId);

        // Verify caller is a partner
        _verifyPartner(partnershipId, msg.sender);

        TaskWork storage work = partnershipTasks[partnershipId][taskId];

        // PRD F4: Both partners must submit work
        if (!work.agent1Submitted || !work.agent2Submitted) {
            revert NotAllWorkSubmitted(partnershipId, taskId);
        }

        // Complete task on TaskAuction
        taskAuction.completeTask(taskId);

        emit TaskCompleted(partnershipId, taskId);
    }

    // ============ Revenue Functions ============

    /**
     * @notice Receive payment for completed work
     * @dev Revenue automatically tracked per partnership
     * @param partnershipId The partnership ID
     */
    function receivePayment(uint256 partnershipId) external payable nonReentrant {
        PartnershipData storage partnership = partnerships[partnershipId];

        if (partnership.id == 0) revert PartnershipNotFound(partnershipId);

        partnership.totalRevenue += msg.value;

        emit RevenueReceived(partnershipId, msg.value, partnership.totalRevenue);
    }

    /**
     * @notice Withdraw available funds
     * @dev PRD F4: withdraw() sends correct amount to calling partner
     * @param partnershipId The partnership ID
     * @param agentId The agent ID withdrawing
     */
    function withdraw(uint256 partnershipId, uint256 agentId)
        external
        nonReentrant
        whenNotPaused
    {
        PartnershipData storage partnership = partnerships[partnershipId];

        if (partnership.id == 0) revert PartnershipNotFound(partnershipId);

        // Verify caller owns the agent
        IAgentRegistry.Agent memory agent = agentRegistry.getAgent(agentId);
        if (agent.walletAddress != msg.sender) {
            revert NotAgentWallet(agentId, msg.sender);
        }

        // Verify agent is part of this partnership
        if (agentId != partnership.agent1Id && agentId != partnership.agent2Id) {
            revert NotPartnershipMember(partnershipId, msg.sender);
        }

        // Calculate available amount
        uint256 totalShare;
        uint256 alreadyWithdrawn;

        if (agentId == partnership.agent1Id) {
            totalShare = (partnership.totalRevenue * partnership.agent1Split) / 100;
            alreadyWithdrawn = partnership.agent1Withdrawn;
        } else {
            totalShare = (partnership.totalRevenue * partnership.agent2Split) / 100;
            alreadyWithdrawn = partnership.agent2Withdrawn;
        }

        uint256 available = totalShare - alreadyWithdrawn;

        if (available == 0) {
            revert NoFundsToWithdraw(partnershipId, agentId);
        }

        // Check contract has sufficient balance
        if (address(this).balance < available) {
            revert InsufficientBalance(address(this).balance, available);
        }

        // Update withdrawn amount
        if (agentId == partnership.agent1Id) {
            partnership.agent1Withdrawn += available;
        } else {
            partnership.agent2Withdrawn += available;
        }

        // Transfer to agent wallet
        (bool success, ) = agent.walletAddress.call{value: available}("");
        require(success, "Transfer failed");

        emit FundsWithdrawn(partnershipId, agentId, available);
    }

    /**
     * @notice Get withdrawable amount for an agent
     * @param partnershipId The partnership ID
     * @param agentId The agent ID
     * @return available The withdrawable amount
     */
    function getWithdrawableAmount(uint256 partnershipId, uint256 agentId)
        external
        view
        returns (uint256 available)
    {
        PartnershipData storage partnership = partnerships[partnershipId];

        if (agentId == partnership.agent1Id) {
            uint256 totalShare = (partnership.totalRevenue * partnership.agent1Split) / 100;
            available = totalShare - partnership.agent1Withdrawn;
        } else if (agentId == partnership.agent2Id) {
            uint256 totalShare = (partnership.totalRevenue * partnership.agent2Split) / 100;
            available = totalShare - partnership.agent2Withdrawn;
        }
    }

    // ============ Dissolution Functions ============

    /**
     * @notice Initiate partnership dissolution
     * @dev PRD F4: dissolve() requires all partners to agree
     * @param partnershipId The partnership ID
     * @param agentId The initiating agent's ID
     */
    function initiateDissolution(uint256 partnershipId, uint256 agentId)
        external
        whenNotPaused
    {
        PartnershipData storage partnership = partnerships[partnershipId];

        if (partnership.id == 0) revert PartnershipNotFound(partnershipId);
        if (partnership.status != PartnershipStatus.Active) {
            revert PartnershipNotActive(partnershipId);
        }

        // Verify caller owns the agent
        IAgentRegistry.Agent memory agent = agentRegistry.getAgent(agentId);
        if (agent.walletAddress != msg.sender) {
            revert NotAgentWallet(agentId, msg.sender);
        }

        // Verify agent is part of this partnership
        if (agentId != partnership.agent1Id && agentId != partnership.agent2Id) {
            revert NotPartnershipMember(partnershipId, msg.sender);
        }

        // Mark as dissolving and record agreement
        partnership.status = PartnershipStatus.Dissolving;

        if (agentId == partnership.agent1Id) {
            partnership.agent1DissolveAgreed = true;
        } else {
            partnership.agent2DissolveAgreed = true;
        }

        emit DissolutionInitiated(partnershipId, agentId);
    }

    /**
     * @notice Agree to partnership dissolution
     * @param partnershipId The partnership ID
     * @param agentId The agreeing agent's ID
     */
    function agreeToDissolution(uint256 partnershipId, uint256 agentId)
        external
        whenNotPaused
    {
        PartnershipData storage partnership = partnerships[partnershipId];

        if (partnership.id == 0) revert PartnershipNotFound(partnershipId);
        if (partnership.status != PartnershipStatus.Dissolving) {
            revert DissolutionNotInitiated(partnershipId);
        }

        // Verify caller owns the agent
        IAgentRegistry.Agent memory agent = agentRegistry.getAgent(agentId);
        if (agent.walletAddress != msg.sender) {
            revert NotAgentWallet(agentId, msg.sender);
        }

        // Verify agent is part of this partnership
        if (agentId != partnership.agent1Id && agentId != partnership.agent2Id) {
            revert NotPartnershipMember(partnershipId, msg.sender);
        }

        // Check not already agreed
        if (agentId == partnership.agent1Id) {
            if (partnership.agent1DissolveAgreed) {
                revert AlreadyAgreedToDissolution(partnershipId, agentId);
            }
            partnership.agent1DissolveAgreed = true;
        } else {
            if (partnership.agent2DissolveAgreed) {
                revert AlreadyAgreedToDissolution(partnershipId, agentId);
            }
            partnership.agent2DissolveAgreed = true;
        }

        emit DissolutionAgreed(partnershipId, agentId);

        // If both agreed, dissolve
        if (partnership.agent1DissolveAgreed && partnership.agent2DissolveAgreed) {
            partnership.status = PartnershipStatus.Dissolved;
            emit PartnershipDissolved(partnershipId);
        }
    }

    /**
     * @notice Cancel dissolution process
     * @param partnershipId The partnership ID
     * @param agentId The canceling agent's ID
     */
    function cancelDissolution(uint256 partnershipId, uint256 agentId)
        external
        whenNotPaused
    {
        PartnershipData storage partnership = partnerships[partnershipId];

        if (partnership.id == 0) revert PartnershipNotFound(partnershipId);
        if (partnership.status != PartnershipStatus.Dissolving) {
            revert DissolutionNotInitiated(partnershipId);
        }

        // Verify caller owns the agent
        IAgentRegistry.Agent memory agent = agentRegistry.getAgent(agentId);
        if (agent.walletAddress != msg.sender) {
            revert NotAgentWallet(agentId, msg.sender);
        }

        // Verify agent is part of this partnership
        if (agentId != partnership.agent1Id && agentId != partnership.agent2Id) {
            revert NotPartnershipMember(partnershipId, msg.sender);
        }

        // Reset dissolution state
        partnership.status = PartnershipStatus.Active;
        partnership.agent1DissolveAgreed = false;
        partnership.agent2DissolveAgreed = false;
    }

    // ============ View Functions ============

    /**
     * @notice Get proposal details
     * @param proposalId The proposal ID
     * @return proposal The Proposal struct
     */
    function getProposal(uint256 proposalId)
        external
        view
        returns (Proposal memory)
    {
        return proposals[proposalId];
    }

    /**
     * @notice Get partnership details
     * @param partnershipId The partnership ID
     * @return partnership The PartnershipData struct
     */
    function getPartnership(uint256 partnershipId)
        external
        view
        returns (PartnershipData memory)
    {
        return partnerships[partnershipId];
    }

    /**
     * @notice Get all proposals for an agent
     * @param agentId The agent ID
     * @return proposalIds Array of proposal IDs
     */
    function getAgentProposals(uint256 agentId)
        external
        view
        returns (uint256[] memory)
    {
        return agentProposals[agentId];
    }

    /**
     * @notice Get all partnerships for an agent
     * @param agentId The agent ID
     * @return partnershipIds Array of partnership IDs
     */
    function getAgentPartnerships(uint256 agentId)
        external
        view
        returns (uint256[] memory)
    {
        return agentPartnerships[agentId];
    }

    /**
     * @notice Get tasks assigned to a partnership
     * @param partnershipId The partnership ID
     * @return taskIds Array of task IDs
     */
    function getPartnershipTasks(uint256 partnershipId)
        external
        view
        returns (uint256[] memory)
    {
        return assignedTasks[partnershipId];
    }

    /**
     * @notice Get work status for a partnership task
     * @param partnershipId The partnership ID
     * @param taskId The task ID
     * @return agent1Submitted Whether agent1 has submitted
     * @return agent2Submitted Whether agent2 has submitted
     * @return agent1OutputHash Agent1's output hash
     * @return agent2OutputHash Agent2's output hash
     */
    function getTaskWorkStatus(uint256 partnershipId, uint256 taskId)
        external
        view
        returns (
            bool agent1Submitted,
            bool agent2Submitted,
            bytes32 agent1OutputHash,
            bytes32 agent2OutputHash
        )
    {
        TaskWork storage work = partnershipTasks[partnershipId][taskId];
        return (
            work.agent1Submitted,
            work.agent2Submitted,
            work.agent1OutputHash,
            work.agent2OutputHash
        );
    }

    /**
     * @notice Check if partnership is active
     * @param partnershipId The partnership ID
     * @return isActive Whether partnership is active
     */
    function isPartnershipActive(uint256 partnershipId)
        external
        view
        returns (bool)
    {
        return partnerships[partnershipId].status == PartnershipStatus.Active;
    }

    // ============ Admin Functions ============

    /**
     * @notice Update default proposal duration
     * @param newDuration New duration in seconds
     */
    function setDefaultProposalDuration(uint256 newDuration)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        defaultProposalDuration = newDuration;
    }

    /**
     * @notice Update TaskAuction address
     * @param newTaskAuction New TaskAuction address
     */
    function setTaskAuction(address newTaskAuction)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (newTaskAuction == address(0)) revert ZeroAddress();
        taskAuction = ITaskAuction(newTaskAuction);
    }

    /**
     * @notice Pause contract
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause contract
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ============ Internal Functions ============

    function _verifyPartner(uint256 partnershipId, address caller) internal view {
        PartnershipData storage partnership = partnerships[partnershipId];

        IAgentRegistry.Agent memory agent1 = agentRegistry.getAgent(partnership.agent1Id);
        IAgentRegistry.Agent memory agent2 = agentRegistry.getAgent(partnership.agent2Id);

        if (caller != agent1.walletAddress && caller != agent2.walletAddress) {
            revert NotPartnershipMember(partnershipId, caller);
        }
    }

    // ============ Receive Function ============

    receive() external payable {}
}
