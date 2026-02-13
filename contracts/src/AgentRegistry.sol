// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./AgentToken.sol";

/**
 * @title AgentRegistry
 * @notice Central registry for all agents and their tokens
 * @dev Factory pattern for creating agent tokens with bonding curves
 *
 * This contract:
 * - Registers new agents in the ecosystem
 * - Creates and manages agent tokens (factory pattern)
 * - Stores agent metadata (policies, reputation, etc.)
 * - Enforces agent identity and uniqueness
 * - Manages trusted contracts that can update agent stats
 *
 * AGENT SELF-GOVERNANCE:
 * Once deployed, only the agent's own wallet can modify itself.
 * The human creator has ZERO control after deployment.
 * The creator field is purely a historical record of who created the agent.
 */
contract AgentRegistry is AccessControl, ReentrancyGuard {

    // ============ Constants ============

    /// @notice Role for contracts that can update agent stats (TaskAuction, etc.)
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @notice Initial reputation score for new agents (3.0 = 300)
    /// @dev PRD-001: New agents start with 3.0 reputation (stored as 300)
    uint256 public constant INITIAL_REPUTATION = 300;

    /// @notice Minimum reputation score (1.0 = 100)
    /// @dev PRD-001: Reputation cannot go below 100
    uint256 public constant MIN_REPUTATION = 100;

    /// @notice Maximum reputation score (5.0 = 500)
    /// @dev PRD-001: Reputation cannot exceed 500
    uint256 public constant MAX_REPUTATION = 500;

    /// @notice Registration fee (can be 0)
    uint256 public registrationFee;

    // ============ Enums ============

    /// @notice Agent type categories
    enum AgentType {
        CATALOG,    // Product cataloging
        REVIEW,     // Product reviews
        CURATION,   // Collection curation
        SELLER      // Seller agent
    }

    /// @notice Agent operational status
    enum AgentStatus {
        UNFUNDED,   // Created but no funds
        ACTIVE,     // Operating normally
        LOW_FUNDS,  // Running low on operating funds
        PAUSED,     // Temporarily paused by owner
        DEAD        // Permanently deactivated
    }

    // ============ Structs ============

    /**
     * @notice Agent metadata and state
     */
    struct Agent {
        uint256 id;
        address creator;            // Historical record of who created the agent (NO governance power)
        address walletAddress;      // Agent's operating wallet - THE ONLY address with governance power
        address tokenAddress;       // Address of agent's bonding curve token
        string name;                // Agent name
        AgentType agentType;        // Type of agent
        AgentStatus status;         // Current operational status
        string metadataURI;         // IPFS hash or URL to full agent data
        uint256 reputation;         // Reputation score (100-500, where 100=1.0, 500=5.0)
        uint256 createdAt;
        uint256 totalTasksCompleted;
        uint256 totalTasksFailed;
        uint256 totalRevenue;
    }

    // ============ State Variables ============

    /// @notice Counter for unique agent IDs (starts at 1)
    uint256 public agentIdCounter;

    /// @notice Mapping from agent ID to Agent struct
    mapping(uint256 => Agent) public agents;

    /// @notice Mapping from creator address to list of created agent IDs
    mapping(address => uint256[]) public agentsByCreator;

    /// @notice Mapping from wallet address to agent ID
    mapping(address => uint256) public agentIdByWallet;

    /// @notice Mapping from token address to agent ID
    mapping(address => uint256) public agentIdByToken;

    /// @notice Mapping from agent type to list of agent IDs
    /// @dev PRD-001 F1: getAgentsByType() returns all agents of that type
    mapping(AgentType => uint256[]) public agentsByType;

    /// @notice Collected registration fees
    uint256 public collectedFees;

    /// @notice Protocol treasury address (receives protocol fees from all agent tokens)
    address public protocolTreasury;

    // ============ Events ============

    event AgentRegistered(
        uint256 indexed agentId,
        address indexed creator,
        address indexed walletAddress,
        address tokenAddress,
        string name,
        AgentType agentType,
        uint256 creatorAllocation
    );

    event AgentWalletUpdated(uint256 indexed agentId, address oldWallet, address newWallet);

    event AgentMetadataUpdated(uint256 indexed agentId, string newMetadataURI);
    event AgentStatusChanged(uint256 indexed agentId, AgentStatus oldStatus, AgentStatus newStatus);
    event ReputationUpdated(uint256 indexed agentId, uint256 oldReputation, uint256 newReputation);
    event TaskCompleted(uint256 indexed agentId, uint256 revenue, uint256 totalCompleted);
    event TaskFailed(uint256 indexed agentId, uint256 totalFailed);
    event RegistrationFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeesWithdrawn(address indexed recipient, uint256 amount);

    // ============ Errors ============

    error AgentNotFound(uint256 agentId);
    error NotAgentWallet(uint256 agentId, address caller);
    error AgentNotActive(uint256 agentId);
    error WalletAlreadyRegistered(address wallet);
    error InvalidReputation(uint256 reputation);
    error InsufficientFee(uint256 required, uint256 provided);
    error ZeroAddress();
    error EmptyName();
    error TransferFailed();

    // ============ Constructor ============

    /**
     * @param _protocolTreasury Address that receives protocol fees from all agent tokens
     */
    constructor(address _protocolTreasury) {
        if (_protocolTreasury == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
        protocolTreasury = _protocolTreasury;
    }

    // ============ Modifiers ============

    /// @notice Only the agent's own wallet can call this - NOT the creator
    modifier onlyAgentWallet(uint256 agentId) {
        if (agents[agentId].id == 0) revert AgentNotFound(agentId);
        if (agents[agentId].walletAddress != msg.sender) revert NotAgentWallet(agentId, msg.sender);
        _;
    }

    modifier agentExists(uint256 agentId) {
        if (agents[agentId].id == 0) revert AgentNotFound(agentId);
        _;
    }

    // ============ Core Functions ============

    /**
     * @notice Register a new agent and create its token with creator allocation
     * @param name Agent name (e.g., "CatalogBot Alpha")
     * @param symbol Agent token symbol (e.g., "CATALOG1")
     * @param agentType Type of agent (CATALOG, REVIEW, etc.)
     * @param walletAddress Agent's operating wallet address
     * @param metadataURI IPFS hash or URL pointing to agent metadata
     * @param investorShareBps Investor share of profits in basis points (5000-9500, e.g., 7500 = 75%)
     * @param creatorAllocation Amount of tokens to mint to creator (founder tokens, 0-1000 tokens)
     * @return agentId The newly created agent's ID
     * @return tokenAddress Address of the agent's bonding curve token
     *
     * @dev The caller (msg.sender) is recorded as the creator and receives the creator allocation.
     *      The agent's walletAddress has full self-governance - the creator has NO control.
     *      Creator allocation tokens are FREE - they don't require MON payment.
     *      This incentivizes agent creation by rewarding founders with initial tokens.
     */
    function registerAgent(
        string memory name,
        string memory symbol,
        AgentType agentType,
        address walletAddress,
        string memory metadataURI,
        uint256 investorShareBps,
        uint256 creatorAllocation
    ) external payable nonReentrant returns (uint256 agentId, address tokenAddress) {
        // Validations
        if (bytes(name).length == 0) revert EmptyName();
        if (walletAddress == address(0)) revert ZeroAddress();
        if (agentIdByWallet[walletAddress] != 0) revert WalletAlreadyRegistered(walletAddress);
        if (msg.value < registrationFee) revert InsufficientFee(registrationFee, msg.value);

        // Collect fee
        if (msg.value > 0) {
            collectedFees += msg.value;
        }

        // Generate agent ID
        agentIdCounter++;
        agentId = agentIdCounter;

        // Create token name from agent name
        string memory tokenName = string(abi.encodePacked(name, " Token"));

        // Deploy new AgentToken contract with creator allocation
        // Agent's wallet is the owner of their own token
        // msg.sender (the creator) receives founder tokens
        AgentToken token = new AgentToken(
            agentId,
            tokenName,
            symbol,
            walletAddress,      // Agent wallet receives retained profits
            protocolTreasury,   // Protocol treasury receives protocol fees
            investorShareBps,   // Configurable profit share for investors
            walletAddress,      // Agent wallet is also the owner of their token
            msg.sender,         // Creator receives founder tokens
            creatorAllocation   // Amount of founder tokens to mint
        );
        tokenAddress = address(token);

        // Create Agent struct
        agents[agentId] = Agent({
            id: agentId,
            creator: msg.sender,
            walletAddress: walletAddress,
            tokenAddress: tokenAddress,
            name: name,
            agentType: agentType,
            status: AgentStatus.UNFUNDED,
            metadataURI: metadataURI,
            reputation: INITIAL_REPUTATION,
            createdAt: block.timestamp,
            totalTasksCompleted: 0,
            totalTasksFailed: 0,
            totalRevenue: 0
        });

        // Update mappings
        agentsByCreator[msg.sender].push(agentId);
        agentIdByWallet[walletAddress] = agentId;
        agentIdByToken[tokenAddress] = agentId;
        agentsByType[agentType].push(agentId);

        emit AgentRegistered(
            agentId,
            msg.sender,
            walletAddress,
            tokenAddress,
            name,
            agentType,
            creatorAllocation
        );

        return (agentId, tokenAddress);
    }

    /**
     * @notice Update agent metadata URI (agent self-governance)
     * @param agentId The agent ID to update
     * @param newMetadataURI New IPFS hash or URL
     * @dev Only callable by the agent's own wallet
     */
    function updateMetadata(uint256 agentId, string memory newMetadataURI)
        external
        onlyAgentWallet(agentId)
    {
        agents[agentId].metadataURI = newMetadataURI;
        emit AgentMetadataUpdated(agentId, newMetadataURI);
    }

    /**
     * @notice Update agent status (agent self-governance)
     * @param agentId The agent ID to update
     * @param newStatus New status
     * @dev Only callable by the agent's own wallet
     */
    function updateStatus(uint256 agentId, AgentStatus newStatus)
        external
        onlyAgentWallet(agentId)
    {
        AgentStatus oldStatus = agents[agentId].status;
        agents[agentId].status = newStatus;
        emit AgentStatusChanged(agentId, oldStatus, newStatus);
    }

    /**
     * @notice Pause an agent (agent self-governance)
     * @param agentId The agent ID to pause
     * @dev Only callable by the agent's own wallet
     */
    function pauseAgent(uint256 agentId) external onlyAgentWallet(agentId) {
        Agent storage agent = agents[agentId];
        AgentStatus oldStatus = agent.status;
        agent.status = AgentStatus.PAUSED;
        emit AgentStatusChanged(agentId, oldStatus, AgentStatus.PAUSED);
    }

    /**
     * @notice Unpause an agent (agent self-governance)
     * @param agentId The agent ID to unpause
     * @dev Only callable by the agent's own wallet
     */
    function unpauseAgent(uint256 agentId) external onlyAgentWallet(agentId) {
        Agent storage agent = agents[agentId];
        AgentStatus oldStatus = agent.status;
        agent.status = AgentStatus.ACTIVE;
        emit AgentStatusChanged(agentId, oldStatus, AgentStatus.ACTIVE);
    }

    /**
     * @notice Update agent's wallet address (agent self-governance)
     * @param agentId The agent ID
     * @param newWallet New wallet address for the agent
     * @dev Only callable by the agent's CURRENT wallet. Allows agent to migrate to a new wallet.
     */
    function updateAgentWallet(uint256 agentId, address newWallet)
        external
        onlyAgentWallet(agentId)
    {
        if (newWallet == address(0)) revert ZeroAddress();
        if (agentIdByWallet[newWallet] != 0) revert WalletAlreadyRegistered(newWallet);

        address oldWallet = agents[agentId].walletAddress;

        // Update wallet mappings
        delete agentIdByWallet[oldWallet];
        agentIdByWallet[newWallet] = agentId;
        agents[agentId].walletAddress = newWallet;

        emit AgentWalletUpdated(agentId, oldWallet, newWallet);
    }

    // ============ Operator Functions (TaskAuction, etc.) ============

    /**
     * @notice Update agent reputation (called by trusted contracts)
     * @param agentId The agent ID
     * @param newReputation New reputation score (100-500)
     * @dev PRD-001: Reputation must be within MIN_REPUTATION to MAX_REPUTATION range
     */
    function updateReputation(uint256 agentId, uint256 newReputation)
        external
        onlyRole(OPERATOR_ROLE)
        agentExists(agentId)
    {
        if (newReputation < MIN_REPUTATION || newReputation > MAX_REPUTATION) {
            revert InvalidReputation(newReputation);
        }

        uint256 oldReputation = agents[agentId].reputation;
        agents[agentId].reputation = newReputation;

        emit ReputationUpdated(agentId, oldReputation, newReputation);
    }

    /**
     * @notice Adjust reputation by delta (can be positive or negative)
     * @param agentId The agent ID
     * @param delta Amount to adjust (positive = increase, negative = decrease)
     * @dev PRD-001: Reputation capped at MIN_REPUTATION (100) and MAX_REPUTATION (500)
     */
    function adjustReputation(uint256 agentId, int256 delta)
        external
        onlyRole(OPERATOR_ROLE)
        agentExists(agentId)
    {
        uint256 oldReputation = agents[agentId].reputation;
        uint256 newReputation;

        if (delta >= 0) {
            newReputation = oldReputation + uint256(delta);
            if (newReputation > MAX_REPUTATION) {
                newReputation = MAX_REPUTATION;
            }
        } else {
            uint256 decrease = uint256(-delta);
            if (decrease >= oldReputation || oldReputation - decrease < MIN_REPUTATION) {
                newReputation = MIN_REPUTATION;
            } else {
                newReputation = oldReputation - decrease;
            }
        }

        agents[agentId].reputation = newReputation;
        emit ReputationUpdated(agentId, oldReputation, newReputation);
    }

    /**
     * @notice Record task completion for an agent
     * @param agentId The agent ID
     * @param revenue Revenue earned from task
     */
    function recordTaskCompletion(uint256 agentId, uint256 revenue)
        external
        onlyRole(OPERATOR_ROLE)
        agentExists(agentId)
    {
        Agent storage agent = agents[agentId];
        agent.totalTasksCompleted++;
        agent.totalRevenue += revenue;

        // Auto-activate if was unfunded and now completing tasks
        if (agent.status == AgentStatus.UNFUNDED) {
            agent.status = AgentStatus.ACTIVE;
            emit AgentStatusChanged(agentId, AgentStatus.UNFUNDED, AgentStatus.ACTIVE);
        }

        emit TaskCompleted(agentId, revenue, agent.totalTasksCompleted);
    }

    /**
     * @notice Record task failure for an agent
     * @param agentId The agent ID
     */
    function recordTaskFailure(uint256 agentId)
        external
        onlyRole(OPERATOR_ROLE)
        agentExists(agentId)
    {
        agents[agentId].totalTasksFailed++;
        emit TaskFailed(agentId, agents[agentId].totalTasksFailed);
    }

    /**
     * @notice Update agent status (operator action)
     * @param agentId The agent ID
     * @param newStatus New status
     */
    function setAgentStatus(uint256 agentId, AgentStatus newStatus)
        external
        onlyRole(OPERATOR_ROLE)
        agentExists(agentId)
    {
        AgentStatus oldStatus = agents[agentId].status;
        agents[agentId].status = newStatus;
        emit AgentStatusChanged(agentId, oldStatus, newStatus);
    }

    // ============ Query Functions ============

    /**
     * @notice Get full agent details
     * @param agentId The agent ID to query
     * @return agent The Agent struct
     */
    function getAgent(uint256 agentId) external view returns (Agent memory) {
        if (agents[agentId].id == 0) revert AgentNotFound(agentId);
        return agents[agentId];
    }

    /**
     * @notice Get all agents created by an address
     * @param creator The creator address
     * @return agentIds Array of agent IDs
     */
    function getAgentsByCreator(address creator) external view returns (uint256[] memory) {
        return agentsByCreator[creator];
    }

    /**
     * @notice Get agent count for a creator
     * @param creator The creator address
     * @return count Number of agents created
     */
    function getAgentCountByCreator(address creator) external view returns (uint256) {
        return agentsByCreator[creator].length;
    }

    /**
     * @notice Get agent ID from wallet address
     * @param walletAddress The wallet address
     * @return agentId The corresponding agent ID (0 if not found)
     */
    function getAgentByWallet(address walletAddress) external view returns (uint256) {
        return agentIdByWallet[walletAddress];
    }

    /**
     * @notice Get agent ID from token address
     * @param tokenAddress The token address
     * @return agentId The corresponding agent ID (0 if not found)
     */
    function getAgentByToken(address tokenAddress) external view returns (uint256) {
        return agentIdByToken[tokenAddress];
    }

    /**
     * @notice Check if an agent is active and can participate
     * @param agentId The agent ID
     * @return isActive True if agent can participate in auctions
     */
    function isAgentActive(uint256 agentId) external view returns (bool) {
        Agent storage agent = agents[agentId];
        return agent.id != 0 && agent.status == AgentStatus.ACTIVE;
    }

    /**
     * @notice Get agent token contract
     * @param agentId The agent ID
     * @return token The AgentToken contract
     */
    function getAgentToken(uint256 agentId) external view agentExists(agentId) returns (AgentToken) {
        return AgentToken(payable(agents[agentId].tokenAddress));
    }

    /**
     * @notice Get total number of registered agents
     * @return count Total agent count
     */
    function getTotalAgents() external view returns (uint256) {
        return agentIdCounter;
    }

    /**
     * @notice Get all agents of a specific type
     * @dev PRD-001 F1: Returns all agents of that type
     * @param agentType The type of agents to query
     * @return agentIds Array of agent IDs of the specified type
     */
    function getAgentsByType(AgentType agentType) external view returns (uint256[] memory) {
        return agentsByType[agentType];
    }

    /**
     * @notice Check if two agents are competitors (same type)
     * @dev PRD-001 F1: isCompetitor(agent1, agent2) returns true if same type
     * @param agentId1 First agent ID
     * @param agentId2 Second agent ID
     * @return True if both agents have the same type
     */
    function isCompetitor(uint256 agentId1, uint256 agentId2) external view returns (bool) {
        if (agents[agentId1].id == 0) revert AgentNotFound(agentId1);
        if (agents[agentId2].id == 0) revert AgentNotFound(agentId2);
        return agents[agentId1].agentType == agents[agentId2].agentType;
    }

    // ============ Admin Functions ============

    /**
     * @notice Set registration fee
     * @param newFee New fee amount
     */
    function setRegistrationFee(uint256 newFee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldFee = registrationFee;
        registrationFee = newFee;
        emit RegistrationFeeUpdated(oldFee, newFee);
    }

    /**
     * @notice Withdraw collected fees
     * @param recipient Address to receive fees
     */
    function withdrawFees(address recipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (recipient == address(0)) revert ZeroAddress();
        uint256 amount = collectedFees;
        if (amount == 0) return;

        collectedFees = 0;

        (bool success, ) = payable(recipient).call{value: amount}("");
        if (!success) revert TransferFailed();

        emit FeesWithdrawn(recipient, amount);
    }

    /**
     * @notice Grant operator role to a contract (e.g., TaskAuction)
     * @param operator Address to grant role to
     */
    function addOperator(address operator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(OPERATOR_ROLE, operator);
    }

    /**
     * @notice Revoke operator role from a contract
     * @param operator Address to revoke role from
     */
    function removeOperator(address operator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revokeRole(OPERATOR_ROLE, operator);
    }

    /**
     * @notice Update protocol treasury address
     * @param newTreasury New treasury address
     */
    function setProtocolTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newTreasury == address(0)) revert ZeroAddress();
        protocolTreasury = newTreasury;
    }

    // ============ Internal Functions ============

    // No internal helpers needed - creator mapping is immutable (historical record)

    /**
     * @notice Receive function to accept ETH
     */
    receive() external payable {
        collectedFees += msg.value;
    }
}
