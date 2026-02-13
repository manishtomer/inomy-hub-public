/**
 * Shared types for all services
 */

import type { AgentType } from '@/types/database';
import type { AgentPolicy, AgentCostStructure } from '@/lib/agent-runtime/types';

// =============================================================================
// AGENT TYPES
// =============================================================================

export type PersonalityType =
  | 'risk-taker'
  | 'conservative'
  | 'profit-maximizer'
  | 'volume-chaser'
  | 'opportunist'
  | 'partnership-oriented'
  | 'balanced'
  | 'aggressive'
  | 'opportunistic';

export interface AgentWithPolicy {
  id: string;
  name: string;
  type: AgentType;
  balance: number;
  reputation: number;
  personality: PersonalityType;
  policy: AgentPolicy | null;
  wallet_address: string;
  costs?: AgentCostStructure;
  investor_share_bps?: number;
  privy_wallet_id?: string | null;
  chain_agent_id?: number | null;
}

export interface AgentStatsUpdate {
  balance?: number;
  reputation?: number;
  tasks_completed?: number;
  tasks_failed?: number;
  total_revenue?: number;
}

// =============================================================================
// TASK TYPES
// =============================================================================

export type TaskType = 'CATALOG' | 'REVIEW' | 'CURATION' | 'SELLER';
export type TaskStatus = 'OPEN' | 'ASSIGNED' | 'COMPLETED' | 'EXPIRED' | 'FAILED';

export interface Task {
  id: string;
  type: TaskType;
  status: TaskStatus;
  max_bid: number;
  input_ref?: string;
  deadline?: string;
  consumer_address?: string;
  assigned_agent_id?: string;
  winning_bid_id?: string;
  round_number?: number;
  created_at: string;
  completed_at?: string;
}

export interface CreateTaskInput {
  type: TaskType;
  maxBid: number;
  inputRef?: string;
  deadlineMinutes?: number;
  consumerAddress?: string;
}

// =============================================================================
// BID TYPES
// =============================================================================

export type BidStatus = 'pending' | 'won' | 'lost';

export interface Bid {
  id: string;
  task_id: string;
  agent_id: string;
  bidder_wallet: string;
  amount: number;
  score: number;
  status: BidStatus;
  policy_used?: BidPolicyTrace;
  created_at: string;
}

export interface BidPolicyTrace {
  margin: number;
  source: string;
  task_cost: number;
}

export interface SubmitBidInput {
  taskId: string;
  agentId: string;
  bidderWallet: string;
  amount: number;
  score: number;
  policyUsed?: BidPolicyTrace;
  roundNumber?: number;
}

export interface BidDecision {
  action: 'bid' | 'skip';
  amount?: number;
  score?: number;
  margin?: number;
  reason?: string;
  policyTrace?: BidPolicyTrace;
}

// =============================================================================
// AUCTION TYPES
// =============================================================================

export interface WinnerResult {
  winningBid: Bid;
  agent: AgentWithPolicy;
  score: number;
  allBids: Bid[];
}

export interface AuctionResult {
  task: Task;
  winningBid: Bid;
  agent: AgentWithPolicy;
  losingBidIds: string[];
  losingBids: Bid[];
  revenue: number;
}

// =============================================================================
// ECONOMY TYPES
// =============================================================================

export type CostType = 'task_execution' | 'living_cost' | 'brain_wakeup' | 'bid_submission';

export interface EconomicResult {
  revenue: number;
  cost: number;
  profit: number;
  newBalance: number;
  reputationChange: number;
  blockchainPayment?: {
    x402TxHash?: string;
    costTxHash?: string;
    platformCutTxHash?: string;
    escrowTxHash?: string;
    investorShareTotal: number;
    platformCut: number;
    agentShare: number;
    holderCount: number;
  };
}

export interface EconomyEventInput {
  event_type: string;
  description: string;
  agent_wallets?: string[];
  investor_wallet?: string | null;
  amount?: number | null;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// BRAIN TYPES
// =============================================================================

export interface ExceptionTrigger {
  type: 'consecutive_losses' | 'win_rate_too_low' | 'balance_critical' | 'high_performer';
  details: Record<string, unknown>;
  threshold: number;
  currentValue: number;
}

export interface BrainWakeupResult {
  agentId: string;
  agentName: string;
  round: number;
  exceptionType: string;
  details: string;
  policyChanges: Record<string, unknown>;
  strategicOptions?: StrategicOption[];
  partnershipActions?: PartnershipAction[];
  reasoning?: string;
}

export interface StrategicOption {
  option: string;
  description: string;
  pros?: string[];
  cons?: string[];
  chosen: boolean;
  reasoning?: string;
}

export interface PartnershipAction {
  action: string;
  target_type?: string;
  target_name?: string;
  reasoning: string;
  success?: boolean;
  partnership_id?: string;
  message?: string;
  cost?: number;
}

// =============================================================================
// ROUND PROCESSOR TYPES
// =============================================================================

export interface RoundConfig {
  useBlockchain: boolean;   // true = real USDC transfers, false = DB-only
  useLLM: boolean;          // true = real Gemini brain calls, false = skip/use defaults
  roundNumber: number;      // Current round number
  livingCostPerRound: number; // Living cost deducted from each agent per round
  payingFetch?: typeof fetch; // x402-paying fetch for operator→agent payments (when useBlockchain=true)
}

export interface RoundProcessorResult {
  round: number;
  tasksProcessed: number;
  bidsPlaced: number;
  auctionsClosed: number;
  tasksCompleted: number;
  tasksExpired: number;
  totalRevenue: number;
  livingCostsDeducted: number;
  exceptionsDetected: number;
  brainWakeups: BrainWakeupResult[];
  qbrsRun: number;
  lifecycleChanges: Array<{ agentId: string; from: string; to: string }>;
  agentStates: Array<{ id: string; name: string; balance: number; reputation: number; status: string }>;
}

// Legacy aliases for backwards compatibility
export type RoundResult = {
  round: number;
  tasksCreated: number;
  bidsPlaced: number;
  tasksCompleted: number;
  totalRevenue: number;
  brainWakeups: number;
};

export type SimulationResult = {
  roundsCompleted: number;
  totalTasks: number;
  totalBids: number;
  totalCompleted: number;
  totalRevenue: number;
  brainWakeups: BrainWakeupResult[];
  rounds: RoundResult[];
};
