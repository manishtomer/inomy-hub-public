/**
 * Contract ABIs - Event-Only Definitions
 *
 * Extracted from deployed Solidity contracts.
 * Only includes event signatures needed for sync service.
 */

// ============================================================================
// AgentRegistry Events
// ============================================================================

export const AGENT_REGISTRY_EVENTS = [
  {
    type: 'event',
    name: 'AgentRegistered',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'walletAddress', type: 'address', indexed: true },
      { name: 'tokenAddress', type: 'address', indexed: false },
      { name: 'name', type: 'string', indexed: false },
      { name: 'agentType', type: 'uint8', indexed: false },
      { name: 'creatorAllocation', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'AgentStatusChanged',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'oldStatus', type: 'uint8', indexed: false },
      { name: 'newStatus', type: 'uint8', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ReputationUpdated',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'oldReputation', type: 'uint256', indexed: false },
      { name: 'newReputation', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TaskCompleted',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'revenue', type: 'uint256', indexed: false },
      { name: 'totalCompleted', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TaskFailed',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'totalFailed', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'AgentWalletUpdated',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'oldWallet', type: 'address', indexed: false },
      { name: 'newWallet', type: 'address', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'AgentMetadataUpdated',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'newMetadataURI', type: 'string', indexed: false },
    ],
  },
] as const;

// ============================================================================
// AgentToken Events
// ============================================================================

export const AGENT_TOKEN_EVENTS = [
  {
    type: 'event',
    name: 'TokensPurchased',
    inputs: [
      { name: 'buyer', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'cost', type: 'uint256', indexed: false },
      { name: 'newSupply', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TokensSold',
    inputs: [
      { name: 'seller', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'refund', type: 'uint256', indexed: false },
      { name: 'newSupply', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ProfitsDeposited',
    inputs: [
      { name: 'totalAmount', type: 'uint256', indexed: false },
      { name: 'investorShare', type: 'uint256', indexed: false },
      { name: 'agentShare', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ProfitsClaimed',
    inputs: [
      { name: 'holder', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'CreatorAllocationMinted',
    inputs: [
      { name: 'creator', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const;

// ============================================================================
// TaskAuction Events
// ============================================================================

export const TASK_AUCTION_EVENTS = [
  {
    type: 'event',
    name: 'TaskCreated',
    inputs: [
      { name: 'taskId', type: 'uint256', indexed: true },
      { name: 'taskType', type: 'uint8', indexed: false },
      { name: 'inputHash', type: 'bytes32', indexed: false },
      { name: 'maxBid', type: 'uint256', indexed: false },
      { name: 'biddingDeadline', type: 'uint256', indexed: false },
      { name: 'completionDeadline', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'BidSubmitted',
    inputs: [
      { name: 'bidId', type: 'uint256', indexed: true },
      { name: 'taskId', type: 'uint256', indexed: true },
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'BidWithdrawn',
    inputs: [
      { name: 'bidId', type: 'uint256', indexed: true },
      { name: 'taskId', type: 'uint256', indexed: true },
      { name: 'agentId', type: 'uint256', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'WinnerSelected',
    inputs: [
      { name: 'taskId', type: 'uint256', indexed: true },
      { name: 'bidId', type: 'uint256', indexed: true },
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'winningAmount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TaskCompleted',
    inputs: [
      { name: 'taskId', type: 'uint256', indexed: true },
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'outputHash', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TaskValidated',
    inputs: [
      { name: 'taskId', type: 'uint256', indexed: true },
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'success', type: 'bool', indexed: false },
      { name: 'paymentAmount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PaymentReleased',
    inputs: [
      { name: 'taskId', type: 'uint256', indexed: true },
      { name: 'worker', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TaskCancelled',
    inputs: [{ name: 'taskId', type: 'uint256', indexed: true }],
  },
] as const;

// ============================================================================
// IntentAuction Events
// ============================================================================

export const INTENT_AUCTION_EVENTS = [
  {
    type: 'event',
    name: 'IntentCreated',
    inputs: [
      { name: 'intentId', type: 'uint256', indexed: true },
      { name: 'consumer', type: 'address', indexed: true },
      { name: 'productHash', type: 'bytes32', indexed: false },
      { name: 'maxBudget', type: 'uint256', indexed: false },
      { name: 'auctionDeadline', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'IntentCancelled',
    inputs: [{ name: 'intentId', type: 'uint256', indexed: true }],
  },
  {
    type: 'event',
    name: 'OfferSubmitted',
    inputs: [
      { name: 'offerId', type: 'uint256', indexed: true },
      { name: 'intentId', type: 'uint256', indexed: true },
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'bidFee', type: 'uint256', indexed: false },
      { name: 'offerPrice', type: 'uint256', indexed: false },
      { name: 'score', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'OfferWithdrawn',
    inputs: [
      { name: 'offerId', type: 'uint256', indexed: true },
      { name: 'intentId', type: 'uint256', indexed: true },
      { name: 'agentId', type: 'uint256', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'AuctionClosed',
    inputs: [
      { name: 'intentId', type: 'uint256', indexed: true },
      { name: 'winningOfferId', type: 'uint256', indexed: true },
      { name: 'winningAgentId', type: 'uint256', indexed: true },
      { name: 'winningOfferPrice', type: 'uint256', indexed: false },
      { name: 'totalFeesCollected', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'IntentFulfilled',
    inputs: [
      { name: 'intentId', type: 'uint256', indexed: true },
      { name: 'agentId', type: 'uint256', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'IntentDisputed',
    inputs: [
      { name: 'intentId', type: 'uint256', indexed: true },
      { name: 'reason', type: 'string', indexed: false },
    ],
  },
] as const;

// ============================================================================
// Partnership Events
// ============================================================================

export const PARTNERSHIP_EVENTS = [
  {
    type: 'event',
    name: 'ProposalCreated',
    inputs: [
      { name: 'proposalId', type: 'uint256', indexed: true },
      { name: 'initiatorAgentId', type: 'uint256', indexed: true },
      { name: 'targetAgentId', type: 'uint256', indexed: true },
      { name: 'initiatorSplit', type: 'uint256', indexed: false },
      { name: 'targetSplit', type: 'uint256', indexed: false },
      { name: 'expiresAt', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ProposalAccepted',
    inputs: [
      { name: 'proposalId', type: 'uint256', indexed: true },
      { name: 'partnershipId', type: 'uint256', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'ProposalRejected',
    inputs: [{ name: 'proposalId', type: 'uint256', indexed: true }],
  },
  {
    type: 'event',
    name: 'CounterOfferCreated',
    inputs: [
      { name: 'originalProposalId', type: 'uint256', indexed: true },
      { name: 'counterProposalId', type: 'uint256', indexed: true },
      { name: 'newInitiatorSplit', type: 'uint256', indexed: false },
      { name: 'newTargetSplit', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PartnershipCreated',
    inputs: [
      { name: 'partnershipId', type: 'uint256', indexed: true },
      { name: 'agent1Id', type: 'uint256', indexed: true },
      { name: 'agent2Id', type: 'uint256', indexed: true },
      { name: 'agent1Split', type: 'uint256', indexed: false },
      { name: 'agent2Split', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PartnershipDissolved',
    inputs: [{ name: 'partnershipId', type: 'uint256', indexed: true }],
  },
  {
    type: 'event',
    name: 'RevenueReceived',
    inputs: [
      { name: 'partnershipId', type: 'uint256', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'newTotalRevenue', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'FundsWithdrawn',
    inputs: [
      { name: 'partnershipId', type: 'uint256', indexed: true },
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const;

// ============================================================================
// Treasury Events
// ============================================================================

export const TREASURY_EVENTS = [
  {
    type: 'event',
    name: 'Deposited',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'newTotalRevenue', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'WorkerPaid',
    inputs: [
      { name: 'worker', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'newTotalCosts', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ProtocolWithdrawal',
    inputs: [
      { name: 'to', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'remainingBalance', type: 'uint256', indexed: false },
    ],
  },
] as const;

// ============================================================================
// Combined Export for Easy Access
// ============================================================================

export const ALL_ABIS = {
  AgentRegistry: AGENT_REGISTRY_EVENTS,
  AgentToken: AGENT_TOKEN_EVENTS,
  TaskAuction: TASK_AUCTION_EVENTS,
  IntentAuction: INTENT_AUCTION_EVENTS,
  Partnership: PARTNERSHIP_EVENTS,
  Treasury: TREASURY_EVENTS,
} as const;
