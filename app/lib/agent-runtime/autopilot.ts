/**
 * Autopilot Policy Engine
 *
 * This is the HEART of the agent runtime - handles 95% of decisions WITHOUT any LLM calls.
 * Pure TypeScript functions that execute policy-driven decisions.
 *
 * The autopilot:
 * - Evaluates auctions and calculates bids from policy
 * - Evaluates partnership proposals (accept/reject/escalate)
 * - Checks for exception triggers (consecutive losses, low balance, etc.)
 * - Determines when QBR (Quarterly Business Review) is due
 * - Manages agent lifecycle status transitions
 *
 * All functions are PURE - no side effects, no DB calls, no LLM calls.
 */

import { AgentStatus } from '@/types/database';
import type {
  AgentPolicy,
  AgentCostStructure,
  AgentRuntimeState,
  BidDecision,
  PartnershipDecision,
  ExceptionTrigger,
} from './types';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate the per-task operational cost (LLM + data + storage + submission).
 * This is what gets paid to the cost sink on task completion.
 */
export function calculateTaskCost(costs: AgentCostStructure): number {
  return (
    costs.per_task.llm_inference +
    costs.per_task.data_retrieval +
    costs.per_task.storage +
    costs.per_task.submission
  );
}

/**
 * Default living cost per round when not specified.
 * Matches the value in simulate-v2 route.
 */
export const DEFAULT_LIVING_COST_PER_ROUND = 0.005;

/**
 * Estimated brain wakeup rate per round.
 * Brain triggers on exceptions (consecutive losses, low balance, etc.).
 * In practice agents wake ~once every 3-4 rounds in steady state.
 */
const DEFAULT_BRAIN_WAKEUP_RATE = 0.3;

/**
 * Calculate the all-in cost per task, accounting for ALL agent expenses.
 *
 * Includes:
 * - Task execution cost (LLM, data retrieval, storage, submission)
 * - Bid submission cost (paid win or lose)
 * - Living cost per round (amortized per task, assuming ~1 task/round)
 * - Brain wakeup cost (amortized: cost * estimated wakeup rate per round)
 *
 * Investor share is taken from NET profit (revenue - allInCost), not gross.
 * So overhead does NOT need to be grossed up — it's deducted before investor split.
 *
 * Example (CATALOG, 75% investor share):
 *   task_cost = $0.057, overhead = $0.0085
 *   all_in_cost = $0.0655
 *   With 15% margin: bid = 0.0655 / 0.85 = $0.077
 *   Net profit = $0.077 - $0.0655 = $0.0115
 *   Investor gets 75% of $0.0115 = $0.0086
 *   Agent keeps 25% of $0.0115 = $0.0029 (pure profit, overhead already covered)
 */
export function calculateAllInCost(
  costs: AgentCostStructure,
  _investorShareBps: number = 5000,
  livingCostPerRound: number = DEFAULT_LIVING_COST_PER_ROUND,
): number {
  const taskCost = calculateTaskCost(costs);
  const bidCost = costs.per_bid.bid_submission;
  const brainAmortized = costs.periodic.brain_wakeup * DEFAULT_BRAIN_WAKEUP_RATE;
  const overhead = bidCost + livingCostPerRound + brainAmortized;

  return taskCost + overhead;
}

// ============================================================================
// BID SCORING
// ============================================================================

/** Reputation is a 0-5 star rating. Does NOT change from winning/losing. */
const REP_MAX = 5;
const BASE_SCORE = 100;

/**
 * Calculate the auction score for a bid.
 *
 * FORMULA: score = (100 + reputation * 2) / bid
 *
 * This ensures:
 * - Bid price is the PRIMARY factor (~90-100% of score)
 * - Reputation (0-5 stars) provides 0-10% bonus
 * - Lower bidders can win against high-rep agents
 *
 * Example:
 * - Agent A: rep=5, bid=$0.07 → score = (100+10)/0.07 = 1571
 * - Agent B: rep=3, bid=$0.065 → score = (100+6)/0.065 = 1631 ← B WINS!
 *
 * Reputation does NOT change from winning/losing - it's a quality rating.
 *
 * @param reputation - Agent's reputation (0-5 star rating)
 * @param bidAmount - Bid amount in USDC
 * @returns number - score (higher is better)
 */
export function calculateBidScore(reputation: number, bidAmount: number): number {
  if (bidAmount <= 0) return 0;
  const cappedRep = Math.min(reputation, REP_MAX);
  const repBonus = cappedRep * 2; // 0-10 range for 0-5 stars
  return (BASE_SCORE + repBonus) / bidAmount;
}

// ============================================================================
// BIDDING LOGIC
// ============================================================================

/**
 * Evaluate whether to bid on a task auction, and at what price.
 * Returns a BidDecision with bid amount or skip reason.
 *
 * Uses ALL-IN COST (not just per-task cost) to ensure bids cover:
 * - Per-task operational costs (LLM, data, storage, submission)
 * - Bid submission cost
 * - Living cost per round (amortized per task)
 * - Investor share (investors take a % of gross profit)
 *
 * Logic:
 * 1. Calculate all-in cost (factoring in investor share + overhead)
 * 2. Calculate target bid = allInCost / (1 - target_margin)
 * 3. If target_bid > max_bid, try min_margin bid
 * 4. If min_margin_bid > max_bid, skip (can't cover costs)
 * 5. If max_bid < skip_below threshold, skip (too small)
 * 6. Check if agent can afford (balance > task_cost + bid_cost)
 * 7. Return final bid amount
 *
 * @param task - Task auction details (type, max_bid, id)
 * @param policy - Agent's bidding policy
 * @param costs - Agent's cost structure
 * @param state - Current agent state (balance, reputation, investor_share_bps)
 * @returns BidDecision - either bid with amount or skip with reason
 */
export function evaluateAuction(
  task: { type: string; max_bid: number; id: string },
  policy: AgentPolicy,
  costs: AgentCostStructure,
  state: { balance: number; reputation: number; investor_share_bps?: number; living_cost_per_round?: number }
): BidDecision {
  const { max_bid } = task;
  const { target_margin, min_margin, skip_below } = policy.bidding;

  // Step 1: Calculate costs
  const taskCost = calculateTaskCost(costs); // Per-task ops only (for affordability check)
  const bidSubmissionCost = costs.per_bid.bid_submission;
  const totalCostIfWin = taskCost + bidSubmissionCost;

  // All-in cost includes overhead + investor share impact
  const investorShareBps = state.investor_share_bps ?? 5000;
  const livingCost = state.living_cost_per_round ?? DEFAULT_LIVING_COST_PER_ROUND;
  const allInCost = calculateAllInCost(costs, investorShareBps, livingCost);

  // Step 2: Check if max_bid is below our skip threshold
  if (max_bid < skip_below) {
    return {
      action: "skip",
      reasoning: `Task max_bid ($${max_bid.toFixed(3)}) is below skip threshold ($${skip_below.toFixed(3)}). Not worth bidding.`
    };
  }

  // Step 3: Calculate target bid with target margin on all-in cost
  // Formula: bid = allInCost / (1 - margin)
  // Example: allInCost $0.069, margin 12% → bid = 0.069 / 0.88 = $0.078
  const targetBid = allInCost / (1 - target_margin);

  // Step 4: Check if target bid fits within max_bid
  if (targetBid <= max_bid) {
    // Target bid is achievable - check affordability
    if (state.balance < totalCostIfWin) {
      return {
        action: "skip",
        reasoning: `Insufficient balance ($${state.balance.toFixed(3)}) to cover task cost ($${taskCost.toFixed(3)}) + bid cost ($${bidSubmissionCost.toFixed(3)}) = $${totalCostIfWin.toFixed(3)}.`
      };
    }

    const actualMargin = ((targetBid - allInCost) / targetBid) * 100;

    return {
      action: "bid",
      amount: targetBid,
      reasoning: `Bidding $${targetBid.toFixed(3)} (max_bid $${max_bid.toFixed(3)}). All-in cost: $${allInCost.toFixed(3)} (task: $${taskCost.toFixed(3)}, overhead: $${(allInCost - taskCost).toFixed(3)}, inv_share: ${(investorShareBps / 100).toFixed(0)}%). Margin: ${actualMargin.toFixed(1)}%. Balance: $${state.balance.toFixed(3)}.`
    };
  }

  // Step 5: Target bid exceeds max_bid - try minimum margin
  const minMarginBid = allInCost / (1 - min_margin);

  if (minMarginBid > max_bid) {
    // Can't even cover all-in cost with minimum margin
    return {
      action: "skip",
      reasoning: `Cannot cover all-in cost. Need $${minMarginBid.toFixed(3)} for ${(min_margin * 100).toFixed(1)}% margin on $${allInCost.toFixed(3)} all-in cost, but max_bid is $${max_bid.toFixed(3)}. Would lose money.`
    };
  }

  // Step 6: Can make minimum margin by bidding at max_bid
  if (state.balance < totalCostIfWin) {
    return {
      action: "skip",
      reasoning: `Insufficient balance ($${state.balance.toFixed(3)}) to cover task cost ($${taskCost.toFixed(3)}) + bid cost ($${bidSubmissionCost.toFixed(3)}) = $${totalCostIfWin.toFixed(3)}.`
    };
  }

  const actualMargin = ((max_bid - allInCost) / max_bid) * 100;

  return {
    action: "bid",
    amount: max_bid,
    reasoning: `Bidding at max_bid $${max_bid.toFixed(3)} (below target but covers all-in cost $${allInCost.toFixed(3)}). Margin: ${actualMargin.toFixed(1)}% (min: ${(min_margin * 100).toFixed(1)}%). Inv share: ${(investorShareBps / 100).toFixed(0)}%.`
  };
}

// ============================================================================
// PARTNERSHIP LOGIC
// ============================================================================

/**
 * Evaluate a partnership proposal.
 * Returns accept, reject, or wake_brain decision.
 *
 * Logic:
 * 1. Check if proposer is same type (competitors cannot partner) → reject
 * 2. Check if proposer is in blocked_agents list → reject
 * 3. Check auto_reject rules (reputation < threshold) → reject
 * 4. Calculate our split (100 - proposer's split)
 * 5. Check auto_accept rules (reputation >= min AND our_split >= min_split) → accept
 * 6. Check wake_brain rules (reputation > high_value_threshold) → wake_brain
 * 7. Default → reject (ambiguous case, better to be safe)
 *
 * @param proposal - Partnership proposal details
 * @param policy - Agent's partnership policy
 * @param identity - Our agent identity (type)
 * @returns PartnershipDecision - accept, reject, or wake_brain with reasoning
 */
export function evaluatePartnership(
  proposal: {
    proposer_agent_id: string;
    proposer_reputation: number;
    proposer_type: string;
    proposed_split: number; // proposer's share (0-100)
  },
  policy: AgentPolicy,
  identity: { type: string }
): PartnershipDecision {
  const { proposer_agent_id, proposer_reputation, proposer_type, proposed_split } = proposal;
  const { auto_accept, auto_reject, require_brain } = policy.partnerships;

  // Step 1: Check if proposer is same type (competitors cannot partner)
  if (proposer_type === identity.type) {
    return {
      action: "reject",
      reasoning: `Proposer is same type (${proposer_type}). Competitors cannot form partnerships - we would be bidding against ourselves.`
    };
  }

  // Step 2: Check if proposer is in blocked list
  if (auto_reject.blocked_agents.includes(proposer_agent_id)) {
    return {
      action: "reject",
      reasoning: `Agent ${proposer_agent_id} is in blocked list. Policy forbids partnership.`
    };
  }

  // Step 3: Check auto_reject rules (low reputation)
  if (proposer_reputation <= auto_reject.max_reputation) {
    return {
      action: "reject",
      reasoning: `Proposer reputation (${proposer_reputation.toFixed(2)}) is below auto-reject threshold (${auto_reject.max_reputation.toFixed(2)}). Too risky to partner with low-reputation agent.`
    };
  }

  // Step 4: Calculate our split
  // If proposer gets 60%, we get 40%
  const ourSplit = 100 - proposed_split;

  // Step 5: Check auto_accept rules
  // Must meet BOTH reputation AND split requirements
  if (
    proposer_reputation >= auto_accept.min_reputation &&
    ourSplit >= auto_accept.min_split
  ) {
    return {
      action: "accept",
      reasoning: `Auto-accepting partnership. Proposer reputation (${proposer_reputation.toFixed(2)}) >= threshold (${auto_accept.min_reputation.toFixed(2)}) AND our split (${ourSplit.toFixed(1)}%) >= minimum (${auto_accept.min_split.toFixed(1)}%). Good partnership opportunity.`
    };
  }

  // Step 6: Check wake_brain rules (high-value partner)
  if (proposer_reputation > require_brain.high_value_threshold) {
    return {
      action: "wake_brain",
      reasoning: `Proposer has very high reputation (${proposer_reputation.toFixed(2)} > ${require_brain.high_value_threshold.toFixed(2)}). This is a high-value partnership opportunity that requires strategic consideration. Split: ${ourSplit.toFixed(1)}% for us, ${proposed_split.toFixed(1)}% for them.`
    };
  }

  // Step 7: Ambiguous case - doesn't meet auto-accept but not clearly bad
  // Default to reject for safety (can always reconsider later)
  return {
    action: "reject",
    reasoning: `Partnership doesn't meet auto-accept criteria. Reputation ${proposer_reputation.toFixed(2)} (need ${auto_accept.min_reputation.toFixed(2)}) or split ${ourSplit.toFixed(1)}% (need ${auto_accept.min_split.toFixed(1)}%). Not clearly beneficial, defaulting to reject.`
  };
}

// ============================================================================
// EXCEPTION DETECTION
// ============================================================================

/**
 * Check if any exception triggers have fired.
 * Returns null if no exceptions, or the first triggered exception.
 *
 * Checks in order:
 * 1. consecutive_losses >= threshold
 * 2. balance < balance_below threshold
 * 3. reputation dropped by > reputation_drop since last check
 * 4. win rate dropped by > win_rate_drop_percent since last check
 *
 * @param state - Current agent runtime state
 * @param policy - Agent's exception policy
 * @param currentBalance - Current balance (from agents table)
 * @param currentReputation - Current reputation (from agents table)
 * @returns ExceptionTrigger or null
 */
// Default exception thresholds (used if policy values are undefined)
const DEFAULT_EXCEPTION_THRESHOLDS = {
  consecutive_losses: 3,
  balance_below: 0.1,
  reputation_drop: 0.5, // 0-5 scale
  win_rate_drop_percent: 20,
};

export function checkExceptions(
  state: AgentRuntimeState,
  policy: AgentPolicy,
  currentBalance: number,
  currentReputation: number
): ExceptionTrigger | null {
  // Use policy values with safe fallbacks
  const thresholds = {
    consecutive_losses: policy.exceptions?.consecutive_losses ?? DEFAULT_EXCEPTION_THRESHOLDS.consecutive_losses,
    balance_below: policy.exceptions?.balance_below ?? DEFAULT_EXCEPTION_THRESHOLDS.balance_below,
    reputation_drop: policy.exceptions?.reputation_drop ?? DEFAULT_EXCEPTION_THRESHOLDS.reputation_drop,
    win_rate_drop_percent: policy.exceptions?.win_rate_drop_percent ?? DEFAULT_EXCEPTION_THRESHOLDS.win_rate_drop_percent,
  };

  // Check 1: Consecutive losses
  if (state.consecutive_losses >= thresholds.consecutive_losses) {
    return {
      type: "consecutive_losses",
      details: `Lost ${state.consecutive_losses} auctions in a row. This is unusual and may indicate a problem with bidding strategy or market conditions.`,
      current_value: state.consecutive_losses,
      threshold: thresholds.consecutive_losses
    };
  }

  // Check 2: Low balance (survival threat)
  if (currentBalance < thresholds.balance_below) {
    return {
      type: "low_balance",
      details: `Balance has fallen to $${currentBalance.toFixed(3)}, below threshold of $${thresholds.balance_below.toFixed(3)}. Survival is at risk.`,
      current_value: currentBalance,
      threshold: thresholds.balance_below
    };
  }

  // Check 3: Reputation drop
  const reputationDrop = state.reputation_at_last_check - currentReputation;
  if (reputationDrop > thresholds.reputation_drop) {
    return {
      type: "reputation_drop",
      details: `Reputation dropped by ${reputationDrop.toFixed(2)} (from ${state.reputation_at_last_check.toFixed(2)} to ${currentReputation.toFixed(2)}), exceeding threshold of ${thresholds.reputation_drop.toFixed(2)}. May indicate quality issues.`,
      current_value: reputationDrop,
      threshold: thresholds.reputation_drop
    };
  }

  // Check 4: Win rate drop
  const winRateDrop = state.win_rate_at_last_check - state.win_rate_last_20;
  const winRateDropPercent = winRateDrop * 100; // Convert to percentage

  if (winRateDropPercent > thresholds.win_rate_drop_percent) {
    return {
      type: "win_rate_drop",
      details: `Win rate dropped by ${winRateDropPercent.toFixed(1)}% (from ${(state.win_rate_at_last_check * 100).toFixed(1)}% to ${(state.win_rate_last_20 * 100).toFixed(1)}%), exceeding threshold of ${thresholds.win_rate_drop_percent.toFixed(1)}%. Market may be getting more competitive.`,
      current_value: winRateDropPercent,
      threshold: thresholds.win_rate_drop_percent
    };
  }

  // No exceptions triggered
  return null;
}

// ============================================================================
// QBR SCHEDULING
// ============================================================================

// Default QBR thresholds (used if policy values are undefined)
const DEFAULT_QBR_CONFIG = {
  base_frequency_rounds: 10,
  accelerate_if: {
    losses_above: 4,
  },
};

/**
 * Check if QBR (Quarterly Business Review) is due.
 * Uses adaptive scheduling from policy.
 *
 * Logic:
 * - Base: Check if current_round - lastQBRRound >= base_frequency_rounds
 * - Accelerate: If consecutive_losses > accelerate_if.losses_above, reduce interval by 40%
 * - Decelerate: NOT IMPLEMENTED for v1 (just use base frequency)
 *
 * @param state - Current agent runtime state
 * @param policy - Agent's QBR policy
 * @returns boolean - true if QBR is due
 */
export function isQBRDue(
  state: AgentRuntimeState,
  policy: AgentPolicy,
  lastQBRRound: number = 0
): boolean {
  const roundsSinceLastQBR = state.current_round - lastQBRRound;

  // Use policy values with safe fallbacks
  const baseFrequency = policy.qbr?.base_frequency_rounds ?? DEFAULT_QBR_CONFIG.base_frequency_rounds;
  const lossesThreshold = policy.qbr?.accelerate_if?.losses_above ?? DEFAULT_QBR_CONFIG.accelerate_if.losses_above;

  // Base frequency
  let qbrInterval = baseFrequency;

  // Accelerate if losing streak
  if (state.consecutive_losses > lossesThreshold) {
    // Reduce interval by 40% (more frequent reviews when struggling)
    qbrInterval = Math.floor(qbrInterval * 0.6);
  }

  // Decelerate logic NOT implemented for v1
  // Could check for stable_rounds and increase interval, but keeping it simple

  return roundsSinceLastQBR >= qbrInterval;
}

// ============================================================================
// LIFECYCLE MANAGEMENT
// ============================================================================

/**
 * Determine the agent's lifecycle status based on balance.
 *
 * State transitions:
 * - UNFUNDED → ACTIVE (when balance > 0)
 * - ACTIVE → LOW_FUNDS (when runway < 5 rounds)
 * - LOW_FUNDS → DEAD (when balance <= 0)
 * - DEAD → ACTIVE (when re-funded)
 *
 * Runway calculation:
 * - Estimate: balance / average_cost_per_round
 * - Average cost includes: task execution costs + brain costs + overhead
 *
 * @param currentStatus - Current agent status
 * @param balance - Current balance
 * @param costs - Agent's cost structure
 * @param avgCostPerRound - Average spending per round (optional, defaults to task cost estimate)
 * @returns AgentStatus - new status
 */
export function evaluateLifecycleStatus(
  currentStatus: AgentStatus,
  balance: number,
  costs: AgentCostStructure,
  avgCostPerRound?: number
): AgentStatus {
  // Death check (highest priority)
  if (balance <= 0) {
    return AgentStatus.DEAD;
  }

  // Revival check (was dead, now has funds)
  if (currentStatus === AgentStatus.DEAD && balance > 0) {
    return AgentStatus.ACTIVE;
  }

  // Activation check (was unfunded, now has funds)
  if (currentStatus === AgentStatus.UNFUNDED && balance > 0) {
    return AgentStatus.ACTIVE;
  }

  // Calculate runway (rounds until death)
  // Use provided avgCostPerRound or estimate from cost structure
  const estimatedCostPerRound = avgCostPerRound || (
    calculateTaskCost(costs) + // Assume 1 task per round
    costs.per_bid.bid_submission + // Bid submission
    costs.periodic.idle_overhead // Overhead
  );

  const runwayRounds = balance / estimatedCostPerRound;

  // Low funds warning (less than 5 rounds of runway)
  if (runwayRounds < 5) {
    return AgentStatus.LOW_FUNDS;
  }

  // Otherwise, keep current status or default to ACTIVE
  if (currentStatus === AgentStatus.PAUSED) {
    return AgentStatus.PAUSED; // Don't auto-resume paused agents
  }

  return AgentStatus.ACTIVE;
}

// ============================================================================
// PROFITABILITY CHECKS
// ============================================================================

/**
 * Check if a bid would be profitable given the cost and minimum margin.
 *
 * @param bid - Bid amount
 * @param cost - Task execution cost
 * @param minMargin - Minimum acceptable margin (0-1)
 * @returns boolean - true if bid is profitable
 */
export function isBidProfitable(
  bid: number,
  cost: number,
  minMargin: number
): boolean {
  const actualMargin = (bid - cost) / bid;
  return actualMargin >= minMargin;
}

/**
 * Calculate profit from winning a task at a given bid.
 *
 * @param bid - Bid amount (revenue)
 * @param cost - Task execution cost
 * @returns number - profit amount
 */
export function calculateProfit(bid: number, cost: number): number {
  return bid - cost;
}

/**
 * Calculate margin percentage from bid and cost.
 *
 * @param bid - Bid amount (revenue)
 * @param cost - Task execution cost
 * @returns number - margin as percentage (0-1)
 */
export function calculateMargin(bid: number, cost: number): number {
  if (bid === 0) return 0;
  return (bid - cost) / bid;
}

/**
 * Calculate bid amount from cost and target margin.
 * This is the CANONICAL bid formula - used by both autopilot and simulation.
 *
 * Formula: bid = cost / (1 - margin)
 *
 * Examples:
 * - cost $0.057, margin 15% → bid = 0.057 / 0.85 = $0.067
 * - cost $0.072, margin 10% → bid = 0.072 / 0.90 = $0.080
 *
 * @param cost - Task execution cost
 * @param margin - Target profit margin (0-1), e.g., 0.15 for 15%
 * @returns number - bid amount
 */
export function calculateBidFromMargin(cost: number, margin: number): number {
  if (margin >= 1) return cost * 10; // Safeguard: 100%+ margin means huge bid
  if (margin < 0) return cost; // Negative margin means bid at cost
  return cost / (1 - margin);
}

/**
 * Calculate runway in rounds based on balance and costs.
 *
 * @param balance - Current balance
 * @param costs - Agent cost structure
 * @param winRate - Recent win rate (0-1)
 * @param avgRevenue - Average revenue per win
 * @returns number - estimated rounds until balance reaches 0
 */
export function calculateRunway(
  balance: number,
  costs: AgentCostStructure,
  winRate: number = 0.5,
  avgRevenue: number = 0
): number {
  if (balance <= 0) return 0;

  // Calculate cost per round
  const taskCost = calculateTaskCost(costs);
  const bidCost = costs.per_bid.bid_submission;
  const overhead = costs.periodic.idle_overhead;

  // Assume agent bids once per round
  // Cost per round = overhead + bid_cost + (win_rate * task_cost)
  const costPerRound = overhead + bidCost + (winRate * taskCost);

  // Revenue per round = win_rate * avgRevenue
  const revenuePerRound = winRate * avgRevenue;

  // Net burn per round
  const netBurnPerRound = costPerRound - revenuePerRound;

  // If profitable, runway is infinite (balance growing)
  if (netBurnPerRound <= 0) {
    return Infinity;
  }

  // Otherwise, calculate rounds until death
  return Math.floor(balance / netBurnPerRound);
}
