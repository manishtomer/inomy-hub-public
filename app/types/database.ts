/**
 * Database Schema Type Definitions
 * These types correspond to the Supabase tables and should be kept in sync with the database schema.
 * Last Updated: 2026-02-04
 *
 * IMPORTANT: This file is synced with smart contracts:
 * - AgentRegistry.sol - Agent struct and enums
 * - AgentToken.sol - Token and dividend tracking
 * - TaskAuction.sol - Task and Bid structs
 * - IntentAuction.sol - Intent and Offer structs
 */

// ============================================================================
// AGENTS TABLE (Synced with AgentRegistry contract)
// ============================================================================

/**
 * Agent type enumeration - defines the different agent roles in the system
 * Maps to AgentType enum in AgentRegistry.sol
 */
export enum AgentType {
  CATALOG = "CATALOG",   // 0 in contract
  REVIEW = "REVIEW",     // 1 in contract
  CURATION = "CURATION", // 2 in contract
  SELLER = "SELLER",     // 3 in contract
  PLATFORM = "PLATFORM", // Platform token (not an agent, no contract mapping)
}

/**
 * Agent status enumeration - tracks the operational state of an agent
 * Maps to AgentStatus enum in AgentRegistry.sol
 */
export enum AgentStatus {
  UNFUNDED = "UNFUNDED",   // 0 - Created but no funds
  ACTIVE = "ACTIVE",       // 1 - Operating normally
  LOW_FUNDS = "LOW_FUNDS", // 2 - Running low on operating funds
  PAUSED = "PAUSED",       // 3 - Temporarily paused by owner
  DEAD = "DEAD",           // 4 - Permanently deactivated
}

/**
 * Agent personality types - defines behavioral characteristics
 * Affects bidding strategy, risk tolerance, and decision making
 */
export type AgentPersonality = "conservative" | "balanced" | "aggressive" | "opportunistic";

/**
 * Agent record from the agents table
 * Represents an autonomous agent in the marketplace
 *
 * Chain-synced fields are marked with [CHAIN]
 */
export interface Agent {
  id: string; // UUID (database primary key)
  chain_agent_id: number | null; // [CHAIN] uint256 ID from AgentRegistry
  name: string;
  type: AgentType;
  status: AgentStatus;
  personality: AgentPersonality; // Behavioral profile (conservative/balanced/aggressive/opportunistic)
  token_symbol: string | null; // [CHAIN] Token ticker symbol (max 6 chars, e.g., "CBOT")

  // Wallet addresses
  owner_wallet: string | null; // [CHAIN] Owner's wallet (who registered the agent)
  wallet_address: string | null; // [CHAIN] Agent's operating wallet (Privy embedded)
  token_address: string | null; // [CHAIN] AgentToken contract address

  // Privy integration
  privy_wallet_id: string | null;
  privy_user_id: string | null;

  // Financial data
  balance: number; // Current operating balance
  token_price: number; // Current bonding curve price
  total_revenue: number; // [CHAIN] Lifetime earnings
  investor_share_bps: number; // [CHAIN] Profit share for investors (5000-9500)

  // Performance metrics
  reputation: number; // [CHAIN] 0-1000 scale
  tasks_completed: number; // [CHAIN] Total successful tasks (= auction wins)
  tasks_failed: number; // [CHAIN] Total failed tasks
  total_bids: number; // [API] Total bids placed (from bids_cache)

  // Metadata
  metadata_uri: string | null; // [CHAIN] IPFS or HTTP URL to metadata JSON

  // Sync tracking
  last_synced_block: number;

  // Timestamps
  created_at: string; // ISO 8601 timestamp
  updated_at: string; // ISO 8601 timestamp
}

/**
 * Request payload for creating a new agent
 */
export interface CreateAgentRequest {
  name: string;
  type: AgentType;
  token_symbol?: string; // Token ticker symbol (max 6 chars, uppercase)
  personality?: AgentPersonality; // defaults to "balanced"
  status?: AgentStatus; // defaults to UNFUNDED
  balance?: number; // defaults to 0
  reputation?: number; // defaults to 500 (INITIAL_REPUTATION in contract)
  token_price?: number; // defaults to 0.001 (BASE_PRICE in contract)
  investor_share_bps?: number; // defaults to 7500 (75%)
  metadata_uri?: string;
}

/**
 * Request payload for updating an agent
 */
export interface UpdateAgentRequest {
  name?: string;
  type?: AgentType;
  status?: AgentStatus;
  balance?: number;
  reputation?: number;
  token_price?: number;
  tasks_completed?: number;
  tasks_failed?: number;
  total_revenue?: number;
  investor_share_bps?: number;
  metadata_uri?: string;
}

// ============================================================================
// TASKS TABLE (Synced with TaskAuction contract)
// ============================================================================

/**
 * Task type enumeration - defines the work types that agents can perform
 */
export enum TaskType {
  CATALOG = "CATALOG",
  REVIEW = "REVIEW",
  CURATION = "CURATION",
}

/**
 * Task status enumeration - tracks the state of a task in the workflow
 * Maps to TaskStatus enum in TaskAuction.sol
 */
export enum TaskStatus {
  OPEN = "OPEN",           // 0 - Accepting bids
  ASSIGNED = "ASSIGNED",   // 1 - Winner selected, work in progress
  IN_PROGRESS = "IN_PROGRESS", // Database only - work being done
  COMPLETED = "COMPLETED", // 2 - Work submitted
  VERIFIED = "VERIFIED",   // 3 - [CHAIN] Payment released
  DISPUTED = "DISPUTED",   // 4 - [CHAIN] Dispute raised
  FAILED = "FAILED",       // Database only - task failed
  CANCELLED = "CANCELLED", // 5 - Task cancelled
}

/**
 * Task record from the tasks table
 * Represents work that can be assigned to and completed by agents
 */
export interface Task {
  id: string; // UUID (database primary key)
  chain_task_id: number | null; // [CHAIN] uint256 ID from TaskAuction
  type: TaskType;
  input_ref: string;
  max_bid: number; // Maximum budget in MON
  deadline: string; // ISO 8601 timestamp
  status: TaskStatus;

  // Addresses
  consumer_address: string | null; // [CHAIN] Who posted the task
  assigned_agent_id: string | null; // UUID, references agents.id
  winning_bid_id: string | null; // UUID, references bids_cache.id

  // Metadata
  metadata_uri: string | null; // [CHAIN] IPFS or HTTP URL for task requirements

  // Timestamps
  completed_at: string | null; // [CHAIN] When completed
  created_at: string; // ISO 8601 timestamp

  // Sync tracking
  last_synced_block: number;
}

/**
 * Request payload for creating a new task
 */
export interface CreateTaskRequest {
  type: TaskType;
  input_ref: string;
  max_bid: number;
  deadline: string; // ISO 8601 timestamp
  status?: TaskStatus; // defaults to OPEN
  assigned_agent_id?: string | null;
  consumer_address?: string;
  metadata_uri?: string;
}

/**
 * Request payload for updating a task
 */
export interface UpdateTaskRequest {
  type?: TaskType;
  input_ref?: string;
  max_bid?: number;
  deadline?: string;
  status?: TaskStatus;
  assigned_agent_id?: string | null;
  winning_bid_id?: string | null;
  completed_at?: string;
  metadata_uri?: string;
}

/**
 * Task with agent details (joined result)
 */
export interface TaskWithAgent extends Task {
  agents?: Agent | null;
}

// ============================================================================
// INTENTS TABLE (Synced with IntentAuction contract)
// ============================================================================

/**
 * Intent status enumeration - tracks the state of a consumer's intent
 * Maps to IntentStatus enum in IntentAuction.sol
 */
export enum IntentStatus {
  PENDING = "PENDING",     // Database alias for OPEN
  OPEN = "OPEN",           // 0 - [CHAIN] Collecting offers
  MATCHED = "MATCHED",     // 1 - [CHAIN] Offer accepted
  IN_PROGRESS = "IN_PROGRESS", // Database only - work being done
  FULFILLED = "FULFILLED", // 2 - [CHAIN] Order completed
  CONFIRMED = "CONFIRMED", // 3 - [CHAIN] Payment released
  COMPLETED = "COMPLETED", // Database alias for CONFIRMED
  DISPUTED = "DISPUTED",   // 4 - [CHAIN] Issue raised
  EXPIRED = "EXPIRED",     // 5 - [CHAIN] Intent expired
  CANCELLED = "CANCELLED", // Database alias for EXPIRED
}

/**
 * Intent record from the intents table
 * Represents a consumer's intent to buy or find a product/service
 */
export interface Intent {
  id: string; // UUID (database primary key)
  chain_intent_id: number | null; // [CHAIN] uint256 ID from IntentAuction
  product_description: string; // Natural language intent text
  max_budget: number; // Budget in MON
  category: string;
  status: IntentStatus;

  // Addresses
  consumer_address: string | null; // [CHAIN] Who posted the intent
  accepted_offer_id: string | null; // UUID, references offers_cache.id

  // Matching
  tags: string[]; // [CHAIN] Tags for matching

  // Timestamps
  expires_at: string | null; // [CHAIN] When intent expires
  created_at: string; // ISO 8601 timestamp

  // Sync tracking
  last_synced_block: number;
}

/**
 * Request payload for creating a new intent
 */
export interface CreateIntentRequest {
  product_description: string;
  max_budget: number;
  category: string;
  status?: IntentStatus; // defaults to PENDING
  tags?: string[];
  expires_at?: string;
  consumer_address?: string;
}

/**
 * Request payload for updating an intent
 */
export interface UpdateIntentRequest {
  product_description?: string;
  max_budget?: number;
  category?: string;
  status?: IntentStatus;
  tags?: string[];
  accepted_offer_id?: string;
  expires_at?: string;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

/**
 * Standard API response wrapper for single items
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * Standard API response wrapper for arrays
 */
export interface ApiListResponse<T> {
  success: boolean;
  data?: T[];
  error?: string;
  message?: string;
  count?: number;
}

/**
 * Standard pagination parameters
 */
export interface PaginationParams {
  limit?: number;
  offset?: number;
}

// ============================================================================
// FILTER & QUERY TYPES
// ============================================================================

/**
 * Agent filter criteria for querying
 */
export interface AgentFilters {
  type?: AgentType;
  status?: AgentStatus;
  minBalance?: number;
  maxBalance?: number;
  minReputation?: number;
  maxReputation?: number;
  owner_wallet?: string;
}

/**
 * Task filter criteria for querying
 */
export interface TaskFilters {
  type?: TaskType;
  status?: TaskStatus;
  assigned_agent_id?: string;
  consumer_address?: string;
  minBid?: number;
  maxBid?: number;
}

/**
 * Intent filter criteria for querying
 */
export interface IntentFilters {
  status?: IntentStatus;
  category?: string;
  consumer_address?: string;
  minBudget?: number;
  maxBudget?: number;
  tags?: string[];
}

// ============================================================================
// OFF-CHAIN TYPES (Not on blockchain)
// ============================================================================

/**
 * Investor record from the investors table
 * Human investor profiles, linked to chain by wallet address
 */
export interface Investor {
  id: string; // UUID
  name: string;
  wallet_address: string; // Required - links to on-chain identity
  created_at: string; // ISO 8601 timestamp
}

/**
 * Request payload for creating a new investor
 */
export interface CreateInvestorRequest {
  name: string;
  wallet_address: string;
}

// ============================================================================
// CHAIN-SYNCED CACHE TYPES (Source of truth is blockchain)
// ============================================================================

/**
 * Token holding record from the token_holdings_cache table
 * Cached from AgentToken contract holdings
 */
export interface TokenHolding {
  id: string; // UUID
  investor_wallet: string; // from chain
  agent_wallet: string; // from chain
  agent_id: string | null; // UUID reference to agents table
  token_balance: number;
  total_invested: number; // from chain events
  current_value: number; // calculated from token_balance * current_price
  unrealized_pnl: number; // current_value - total_invested
  unclaimed_dividends: number; // pending dividend claims
  last_synced_block: number; // sync tracking
}

/**
 * Request payload for creating an investment (buying tokens)
 */
export interface CreateInvestmentRequest {
  investor_wallet: string;
  agent_wallet: string;
  amount: number;
}

/**
 * Economy event type enumeration
 */
export type EconomyEventType =
  | "task_completed"
  | "task_assigned"
  | "task_payment"
  | "cost_sink_payment"
  | "investment"
  | "partnership"
  | "agent_death"
  | "auction_won"
  | "policy_change"
  | "dividend_paid"
  | "token_bought"
  | "token_sold"
  | "reputation_changed"
  | "escrow_deposit"
  | "dividend_claimed"
  | "living_cost"
  | "bid_placed"
  | "brain_decision";

/**
 * Economy event record from the economy_events table
 * Generated from chain events + off-chain actions for activity feed
 */
export interface EconomyEvent {
  id: string; // UUID
  event_type: EconomyEventType;
  description: string;
  agent_wallets: string[]; // involved agent wallet addresses
  investor_wallet: string | null;
  amount: number | null;
  tx_hash: string | null; // if from chain
  block_number: number | null;
  metadata: Record<string, unknown>;
  created_at: string; // ISO 8601 timestamp
}

/**
 * Request payload for creating an economy event
 */
export interface CreateEconomyEventRequest {
  event_type: EconomyEventType;
  description: string;
  agent_wallets?: string[];
  investor_wallet?: string | null;
  amount?: number | null;
  tx_hash?: string | null;
  block_number?: number | null;
  metadata?: Record<string, unknown>;
}

/**
 * Partnership status enumeration
 */
export type PartnershipStatus = "PROPOSED" | "NEGOTIATING" | "ACTIVE" | "DISSOLVED";

/**
 * Partnership record from the partnerships_cache table
 * Cached from Partnership contract
 */
export interface PartnershipCache {
  id: string; // UUID
  partnership_address: string | null; // from chain (null in demo mode)
  partner_a_wallet: string;
  partner_b_wallet: string;
  split_a: number; // percentage 0-100
  split_b: number;
  balance: number;
  status: PartnershipStatus;
  last_synced_block: number;
  created_at: string; // ISO 8601 timestamp
}

/**
 * Request payload for creating a partnership
 */
export interface CreatePartnershipRequest {
  partner_a_wallet: string;
  partner_b_wallet: string;
  split_a: number; // percentage 0-100
  split_b: number;
}

/**
 * Bid status enumeration
 * Maps to BidStatus enum in TaskAuction.sol
 */
export type BidStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "WITHDRAWN" | "WON" | "LOST";

/**
 * Bid record from the bids_cache table
 * Cached from TaskAuction contract bids
 */
export interface BidCache {
  id: string; // UUID
  chain_bid_id: number | null; // [CHAIN] uint256 bid ID
  chain_task_id: number | null; // from chain (null in demo mode)
  task_id: string; // UUID reference to tasks table
  agent_id: string | null; // UUID reference to agents table
  bidder_wallet: string;
  amount: number;
  estimated_duration: number | null; // [CHAIN] in seconds
  proposal_uri: string | null; // [CHAIN] IPFS or HTTP URL
  status: BidStatus;
  last_synced_block: number;
  created_at: string; // ISO 8601 timestamp
}

/**
 * Request payload for creating a bid
 */
export interface CreateBidRequest {
  task_id: string;
  agent_id?: string;
  bidder_wallet: string;
  amount: number;
  estimated_duration?: number;
  proposal_uri?: string;
}

/**
 * Offer status enumeration
 * Maps to OfferStatus enum in IntentAuction.sol
 */
export type OfferStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "WITHDRAWN";

/**
 * Offer record from the offers_cache table
 * Cached from IntentAuction contract offers
 */
export interface OfferCache {
  id: string; // UUID
  chain_offer_id: number | null; // [CHAIN] uint256 offer ID
  chain_intent_id: number | null; // [CHAIN] uint256 intent ID
  intent_id: string | null; // UUID reference to intents table
  agent_id: string | null; // UUID reference to agents table
  agent_wallet: string;
  price: number;
  proposal_text: string | null;
  matched_tags: string[];
  relevance_score: number; // 0-1000
  status: OfferStatus;
  submitted_at: string; // ISO 8601 timestamp
  last_synced_block: number;
  created_at: string; // ISO 8601 timestamp
}

/**
 * Request payload for creating an offer
 */
export interface CreateOfferRequest {
  intent_id: string;
  agent_id?: string;
  agent_wallet: string;
  price: number;
  proposal_text?: string;
  matched_tags?: string[];
  relevance_score?: number;
}

// ============================================================================
// DIVIDEND & PROFIT TRACKING TYPES
// ============================================================================

/**
 * Dividend distribution record
 * Tracks when an agent deposits profits for distribution
 */
export interface DividendHistory {
  id: string; // UUID
  agent_id: string | null; // UUID reference to agents table
  agent_wallet: string;
  total_amount: number; // Total profits deposited
  investor_share: number; // Amount to investors
  agent_share: number; // Amount to agent wallet
  total_supply_at_distribution: number | null; // Token supply when distributed
  tx_hash: string | null;
  block_number: number | null;
  distributed_at: string; // ISO 8601 timestamp
  created_at: string; // ISO 8601 timestamp
}

/**
 * Individual dividend claim record
 * Tracks when an investor claims their dividend
 */
export interface DividendClaim {
  id: string; // UUID
  dividend_id: string | null; // UUID reference to dividends_history
  investor_wallet: string;
  agent_wallet: string;
  amount: number;
  token_balance_at_claim: number | null;
  tx_hash: string | null;
  block_number: number | null;
  claimed_at: string; // ISO 8601 timestamp
  created_at: string; // ISO 8601 timestamp
}

/**
 * Reputation change record
 * Tracks all reputation adjustments for agents
 */
export interface ReputationHistory {
  id: string; // UUID
  agent_id: string | null; // UUID reference to agents table
  agent_wallet: string;
  old_reputation: number;
  new_reputation: number;
  change_amount: number; // Can be positive or negative
  reason: string | null; // 'task_completed', 'task_failed', 'operator_adjustment'
  tx_hash: string | null;
  block_number: number | null;
  changed_at: string; // ISO 8601 timestamp
  created_at: string; // ISO 8601 timestamp
}

/**
 * Token transaction record (buy/sell on bonding curve)
 */
export interface TokenTransaction {
  id: string; // UUID
  agent_id: string | null; // UUID reference to agents table
  agent_wallet: string;
  investor_wallet: string;
  transaction_type: "BUY" | "SELL";
  token_amount: number;
  mon_amount: number; // Cost or refund in MON
  protocol_fee: number | null;
  price_at_transaction: number | null;
  supply_after_transaction: number | null;
  tx_hash: string | null;
  block_number: number | null;
  transacted_at: string; // ISO 8601 timestamp
  created_at: string; // ISO 8601 timestamp
}

// ============================================================================
// DIVIDEND ESCROW TYPES (Protected investor dividends)
// ============================================================================

/**
 * Investor escrow balance - per-investor running total for each agent
 * The available_to_claim column is auto-calculated in the database
 */
export interface InvestorEscrow {
  id: string; // UUID
  agent_id: string; // UUID reference to agents table
  investor_wallet: string;
  total_earned: number; // Cumulative amount earned from all distributions
  total_claimed: number; // Cumulative amount claimed
  available_to_claim: number; // Auto-calculated: total_earned - total_claimed
  last_deposit_at: string | null; // ISO 8601 timestamp
  last_claim_at: string | null; // ISO 8601 timestamp
  created_at: string; // ISO 8601 timestamp
  updated_at: string; // ISO 8601 timestamp
}

/**
 * Escrow deposit audit trail - records each profit distribution
 */
export interface EscrowDeposit {
  id: string; // UUID
  agent_id: string; // UUID reference to agents table
  task_id: string | null; // UUID reference to tasks table
  gross_profit: number; // Net profit from task (bid - operational cost)
  investor_share_total: number; // Total amount escrowed for investors
  agent_share: number; // Amount kept by agent
  investor_share_bps: number; // Agent's setting at time of deposit (e.g., 7500 = 75%)
  holder_count: number; // Number of holders at time of deposit
  total_token_supply: number | null; // Token supply at time of deposit
  tx_hash: string | null; // Transaction hash for escrow transfer
  deposited_at: string; // ISO 8601 timestamp
}

/**
 * Dividend claim history - records each investor claim
 */
export interface DividendClaimRecord {
  id: string; // UUID
  agent_id: string; // UUID reference to agents table
  investor_wallet: string;
  amount: number; // Amount claimed
  tx_hash: string | null; // Transaction hash for payout
  claimed_at: string; // ISO 8601 timestamp
}

/**
 * Dividend info response for API
 */
export interface DividendInfo {
  agent_id: string;
  total_escrowed: number; // Total ever escrowed for this agent
  investor?: {
    total_earned: number;
    total_claimed: number;
    available_to_claim: number;
    recent_claims: DividendClaimRecord[];
  };
}

// ============================================================================
// CHAIN SYNC TYPES
// ============================================================================

/**
 * Chain sync state for tracking contract synchronization
 */
export interface ChainSyncState {
  id: string; // UUID
  contract_name: string; // 'AgentRegistry', 'TaskAuction', etc.
  contract_address: string;
  last_synced_block: number;
  last_sync_at: string; // ISO 8601 timestamp
  sync_status: "idle" | "syncing" | "error";
  error_message: string | null;
  created_at: string; // ISO 8601 timestamp
  updated_at: string; // ISO 8601 timestamp
}

/**
 * Protocol-wide statistics
 */
export interface ProtocolStats {
  id: string; // UUID
  stat_date: string; // ISO 8601 date
  total_agents: number;
  active_agents: number;
  total_tasks_created: number;
  total_tasks_completed: number;
  total_intents_created: number;
  total_intents_fulfilled: number;
  total_volume_mon: number;
  total_fees_collected_mon: number;
  total_dividends_distributed_mon: number;
  average_reputation: number;
  created_at: string; // ISO 8601 timestamp
  updated_at: string; // ISO 8601 timestamp
}

// ============================================================================
// UI AGGREGATED TYPES (for dashboard display)
// ============================================================================

/**
 * Investor portfolio with aggregated holdings and P&L
 */
export interface InvestorPortfolio {
  investor: Investor;
  holdings: (TokenHolding & { agent_name?: string })[];
  total_invested: number;
  current_value: number;
  pnl_percent: number;
  total_unclaimed_dividends: number;
}

/**
 * Economy event with enriched agent data
 */
export interface EconomyEventWithAgents extends EconomyEvent {
  agent_names?: string[];
  investor_name?: string;
}

/**
 * Agent detail view with financial data
 */
export interface AgentDetail extends Agent {
  token_stats?: {
    total_supply: number;
    current_price: number;
    market_cap: number;
    reserve_balance: number;
  };
  holder_count?: number;
  recent_dividends?: DividendHistory[];
  recent_transactions?: TokenTransaction[];
}

// ============================================================================
// WALLET TYPES (For Privy Integration)
// ============================================================================

/**
 * Wallet connection state
 */
export interface WalletState {
  address: string | null;
  chainId: number | null;
  isConnected: boolean;
  isConnecting: boolean;
  email: string | null;
}

/**
 * Wallet info for display
 */
export interface WalletInfo {
  address: string;
  shortAddress: string; // e.g., "0x1234...5678"
  chainId: number;
  chainName: string;
  balance?: string;
}

// ============================================================================
// AGENT WALLET TYPES (For Privy Server-Side Integration)
// ============================================================================

/**
 * Agent wallet information returned from Privy
 */
export interface AgentWalletInfo {
  wallet_address: string;
  privy_wallet_id: string;
  privy_user_id: string;
  balance?: string;
  usdc_balance?: number;
  chain_id: number;
}

/**
 * Request to send a transaction from an agent's wallet
 */
export interface SendTransactionRequest {
  to: string; // Recipient address
  value: string; // Amount in ETH/MON (e.g., "0.1")
  data?: string; // Optional calldata for contract interactions
}

/**
 * Transaction result from Privy
 */
export interface TransactionResult {
  transaction_hash: string;
  status: "pending" | "confirmed" | "failed";
  block_number?: number;
  from: string;
  to: string;
  value: string;
}

/**
 * Update agent wallet fields
 */
export interface UpdateAgentWalletRequest {
  wallet_address: string;
  privy_wallet_id: string;
  privy_user_id: string;
}

// ============================================================================
// SMART CONTRACT CONSTANTS (Mirror of Solidity constants)
// ============================================================================

// ============================================================================
// INDUSTRY REPORTS TYPES
// ============================================================================

/**
 * Market-level metrics for a report period
 */
export interface ReportMarketMetrics {
  total_tasks: number;
  total_bids: number;
  total_revenue: number;
  avg_winning_bid: number;
  avg_bid_all: number;
  avg_bidders_per_task: number;
  winning_bid_trend: 'increasing' | 'decreasing' | 'stable';
  margin_avg: number;
  margin_min: number;
  margin_max: number;
}

/**
 * Per-agent metrics for a report period
 */
export interface ReportAgentMetrics {
  id: string;
  name: string;
  type: string;
  personality: string;
  bids: number;
  wins: number;
  losses: number;
  win_rate: number;
  avg_bid: number;
  avg_margin: number | null;
  balance_start: number;
  balance_end: number;
  balance_delta: number;
  reputation_delta: number;
  brain_wakeups: number;
  policy_changes: number;
}

/**
 * Event counts for a report period
 */
export interface ReportEventMetrics {
  brain_decisions: number;
  policy_changes: number;
  exceptions: number;
  agent_deaths: number;
}

/**
 * A key moment in an agent's strategic evolution (brain decision, exception, or learning)
 */
export interface StrategyMoment {
  round: number;
  type: 'exception' | 'qbr' | 'learning';
  trigger?: string;
  reasoning?: string;
  narrative?: string;
  policy_changes?: Record<string, unknown>;
}

/**
 * Per-agent strategy evolution data
 */
export interface AgentStrategyEvolution {
  agent_id: string;
  agent_name: string;
  agent_type: string;
  personality: string;
  brain_wakeups: number;
  policy_changes: number;
  moments: StrategyMoment[];
}

/**
 * Strategy evolution data for the report
 */
export interface ReportStrategyEvolution {
  agents: AgentStrategyEvolution[];
}

// ── Competitive Dynamics Types ──────────────────────────────────────

/** Round-by-round winner for a single task type */
export interface RoundWinner {
  round: number;
  winner_name: string;
  winner_bid: number;
  winner_id: string;
  num_bidders: number;
}

/** Per-agent bid entry for a single round */
export interface AgentBidEntry {
  round: number;
  amount: number;
  won: boolean;
}

/** Per-agent bid trajectory across the report period */
export interface AgentBidTrajectory {
  agent_id: string;
  agent_name: string;
  type: string;
  entries: AgentBidEntry[];
  wins: number;
  total: number;
  avg_bid: number;
}

/** A margin change event with bid impact annotation */
export interface MarginChangeEvent {
  round: number;
  agent_id: string;
  agent_name: string;
  trigger: string;
  old_margin: number;
  new_margin: number;
  old_bid: number;
  new_bid: number;
  annotation: string;
}

/** Bid spread for a round within a task type */
export interface RoundBidSpread {
  round: number;
  low_bid: number;
  high_bid: number;
  spread: number;
  num_bidders: number;
}

/** Competitive dynamics for a single task type */
export interface TaskTypeCompetitiveDynamics {
  task_type: string;
  winners: RoundWinner[];
  unique_winners: number;
  leadership_changes: number;
  bid_trajectories: AgentBidTrajectory[];
  bid_spreads: RoundBidSpread[];
}

/** Full competitive dynamics section */
export interface ReportCompetitiveDynamics {
  by_task_type: TaskTypeCompetitiveDynamics[];
  margin_changes: MarginChangeEvent[];
}

/**
 * Full metrics JSONB shape stored in industry_reports.metrics
 */
export interface ReportMetrics {
  market: ReportMarketMetrics;
  agents: ReportAgentMetrics[];
  events: ReportEventMetrics;
  strategy?: ReportStrategyEvolution;
  competitive?: ReportCompetitiveDynamics;
}

/**
 * Award entry in the narrative
 */
export interface ReportAward {
  title: string;
  agent_name: string;
  reason: string;
  stats?: {
    revenue?: string;
    profit?: string;
    win_rate?: string;
    margin?: string;
    investor_payout?: string;
  };
}

/**
 * LLM-generated narrative JSONB shape stored in industry_reports.narrative
 */
export interface ReportNarrative {
  headline: string;
  executive_summary: string;
  market_dynamics: string;
  agent_spotlight: string;
  strategy_analysis: string;
  strategy_evolution?: string;
  competitive_dynamics?: string;
  outlook: string;
  awards: ReportAward[];
}

/**
 * Industry report record from the industry_reports table
 */
export interface IndustryReport {
  id: string;
  report_number: number;
  start_round: number;
  end_round: number;
  metrics: ReportMetrics;
  narrative: ReportNarrative;
  model_used: string | null;
  generation_time_ms: number | null;
  created_at: string;
}

/**
 * Report config from simulation_state
 */
export interface ReportConfig {
  report_interval: number;
  report_model: string;
  last_report_round: number;
  current_round: number;
}

export const CONTRACT_CONSTANTS = {
  // AgentToken constants
  BASE_PRICE: 0.001, // MON per token at 0 supply
  PRICE_INCREMENT: 0.0001, // MON per token increase
  PROTOCOL_FEE_BPS: 250, // 2.5%
  MIN_INVESTOR_SHARE_BPS: 5000, // 50%
  MAX_INVESTOR_SHARE_BPS: 9500, // 95%

  // AgentRegistry constants
  INITIAL_REPUTATION: 500,
  MAX_REPUTATION: 1000,

  // Chain info
  MONAD_TESTNET_CHAIN_ID: 10143,
  MONAD_TESTNET_RPC: "https://testnet-rpc.monad.xyz",
} as const;
