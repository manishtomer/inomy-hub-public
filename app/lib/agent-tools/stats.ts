/**
 * Agent Statistics Tools
 *
 * Provides agents with self-assessment capabilities, enabling them to understand
 * their own performance, financial health, and trajectory.
 *
 * Tools in this module:
 * - get_my_stats: Comprehensive self-assessment for an agent
 * - get_qbr_context: Strategic review context for QBR decision-making
 */

import { supabase } from "@/lib/supabase";
import type {
  GetMyStatsInput,
  GetMyStatsOutput,
  GetQBRContextInput,
  GetQBRContextOutput,
} from "@/types/agent-system";
import { AGENT_COSTS } from "@/lib/agent-runtime/constants";
import {
  calculateAllInCost,
  calculateBidScore,
  calculateTaskCost,
  DEFAULT_LIVING_COST_PER_ROUND,
} from "@/lib/agent-runtime/autopilot";

/**
 * Get comprehensive statistics for an agent
 * Used for self-assessment and understanding current performance
 *
 * @param input - Agent ID and stats window
 * @returns Complete agent statistics including performance metrics and health status
 */
export async function getMyStats(input: GetMyStatsInput): Promise<GetMyStatsOutput> {
  const { agent_id, stat_window_rounds } = input;

  // Fetch agent details - try by ID first, then by name
  let agent = null;

  // Check if agent_id looks like a UUID (basic validation)
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agent_id);

  if (isUUID) {
    // First try as UUID
    const { data: agentByID, error: errorByID } = await supabase
      .from("agents")
      .select("*")
      .eq("id", agent_id)
      .maybeSingle();

    if (agentByID) {
      agent = agentByID;
    } else if (errorByID) {
      throw new Error(`Failed to fetch agent: ${errorByID.message}`);
    }
  }

  // If not found by ID (or ID wasn't a UUID), try by name
  if (!agent) {
    const { data: agentByName, error: errorByName } = await supabase
      .from("agents")
      .select("*")
      .eq("name", agent_id)
      .maybeSingle();

    if (agentByName) {
      agent = agentByName;
    } else if (errorByName) {
      throw new Error(`Failed to fetch agent by name: ${errorByName.message}`);
    }
  }

  if (!agent) {
    throw new Error(`Agent not found: ${agent_id}`);
  }

  // Fetch recent bids for window analysis - query by agent_id (not wallet)
  const { data: recentBids, error: bidsError } = await supabase
    .from("bids_cache")
    .select("*")
    .eq("agent_id", agent.id)
    .order("created_at", { ascending: false })
    .limit(Math.max(stat_window_rounds * 2, 50));

  if (bidsError) {
    throw new Error(`Failed to fetch bids: ${bidsError.message}`);
  }

  const bids = recentBids || [];

  // Calculate revenue and costs in this period
  const wonBids = bids.filter((b) => b.status === "WON");
  const totalRevenue = wonBids.reduce((sum, b) => sum + (b.amount || 0), 0);
  const totalCosts = bids.reduce((sum, b) => sum + (b.amount || 0) / 10, 0); // Rough estimate

  // Calculate win rate
  const bidsInWindow = bids.slice(0, stat_window_rounds * 2);
  const winsInWindow = bidsInWindow.filter((b) => b.status === "WON").length;
  const win_rate = bidsInWindow.length > 0 ? winsInWindow / bidsInWindow.length : 0;

  // Calculate consecutive losses
  let consecutive_losses_current = 0;
  for (const bid of bids) {
    if (bid.status === "WON") break;
    consecutive_losses_current++;
  }

  // Estimate runway
  const monthlyBurn = totalCosts || 1;
  const runway_estimated_rounds = monthlyBurn > 0 ? agent.balance / monthlyBurn : 1000;

  // Fetch partnership data
  const { data: partnerships } = await supabase
    .from("partnerships_cache")
    .select("*")
    .or(`partner_a_wallet.eq.${agent.wallet_address},partner_b_wallet.eq.${agent.wallet_address}`)
    .eq("status", "ACTIVE");

  const active_partnership_count = partnerships?.length || 0;
  const partnership_revenue_share = partnerships?.reduce((sum, p) => {
    const split = p.partner_a_wallet === agent.wallet_address ? p.split_a : p.split_b;
    return sum + split;
  }, 0) / Math.max(active_partnership_count, 1) || 0;

  // Calculate solo vs partnership win rates
  const partnershipBids = bids.filter((b) => partnerships?.some((p) =>
    (p.partner_a_wallet === agent.wallet_address && b.bidder_wallet === p.partner_a_wallet) ||
    (p.partner_b_wallet === agent.wallet_address && b.bidder_wallet === p.partner_b_wallet)
  ));

  const soloBids = bids.filter((b) => !partnershipBids.includes(b));
  const soloWinRate = soloBids.length > 0 ? soloBids.filter((b) => b.status === "WON").length / soloBids.length : 0;
  const partnershipWinRate = partnershipBids.length > 0 ? partnershipBids.filter((b) => b.status === "WON").length / partnershipBids.length : 0;

  // Fetch current policy (latest one)
  const { data: policyData } = await supabase
    .from("agent_policies")
    .select("policy_json")
    .eq("agent_id", agent_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const currentPolicy = policyData?.policy_json || {};

  // Build exception flags
  const profitMargin = totalRevenue > 0 ? (totalRevenue - totalCosts) / totalRevenue : 0;
  const exceptionFlags = [
    {
      type: "consecutive_losses" as const,
      triggered: consecutive_losses_current >= 5,
      current_value: consecutive_losses_current,
      threshold: 5,
    },
    {
      type: "low_balance" as const,
      triggered: agent.balance < 10,
      current_value: agent.balance,
      threshold: 10,
    },
    {
      type: "reputation_drop" as const,
      triggered: agent.reputation < 2.5,
      current_value: agent.reputation,
      threshold: 2.5,
    },
    {
      type: "win_rate_drop" as const,
      triggered: win_rate < 0.3,
      current_value: win_rate * 100,
      threshold: 30,
    },
  ];

  return {
    name: agent.name,
    type: agent.type,
    personality: "risk-taker", // Would fetch from policies
    current_balance: agent.balance || 0,
    total_revenue_this_period: totalRevenue,
    total_costs_this_period: totalCosts,
    profit_margin_avg: profitMargin,
    runway_estimated_rounds: Math.max(runway_estimated_rounds, 0),
    bids_submitted: bids.length,
    bids_won: winsInWindow,
    win_rate,
    consecutive_losses_current,
    tasks_completed_this_period: agent.tasks_completed || 0,
    tasks_failed_this_period: agent.tasks_failed || 0,
    completion_rate: ((agent.tasks_completed || 0) / Math.max((agent.tasks_completed || 0) + (agent.tasks_failed || 0), 1)),
    reputation: agent.reputation || 0,
    reputation_change_this_period: 0, // Would track from history
    status: agent.status,
    current_policy: {
      target_margin: Math.round((currentPolicy.bidding?.target_margin || 0.15) * 100),
      min_margin: Math.round((currentPolicy.bidding?.min_margin || 0.08) * 100),
      skip_below: currentPolicy.bidding?.skip_below || 0.05,
    },
    avg_cost_per_winning_bid: wonBids.length > 0 ? totalCosts / wonBids.length : 0,
    avg_revenue_per_winning_bid: wonBids.length > 0 ? totalRevenue / wonBids.length : 0,
    avg_brain_cost_per_wakeup: 0.01, // Would track from runtime history
    active_partnership_count,
    partnership_revenue_share,
    solo_vs_partnership_win_rate: {
      solo: soloWinRate,
      partnership: partnershipWinRate,
    },
    exception_flags: exceptionFlags,
    bid_economics: (() => {
      const agentType = agent.type as keyof typeof AGENT_COSTS;
      const costs = AGENT_COSTS[agentType] || AGENT_COSTS.CATALOG;
      const taskCost = calculateTaskCost(costs);
      const allInCost = calculateAllInCost(costs, agent.investor_share_bps || 7500, DEFAULT_LIVING_COST_PER_ROUND);
      const targetMargin = currentPolicy.bidding?.target_margin ?? 0.15;
      const currentBid = allInCost / (1 - targetMargin);
      return {
        all_in_cost: allInCost,
        current_bid_at_policy: currentBid,
        current_bid_score: calculateBidScore(agent.reputation || 0, currentBid),
        min_profitable_bid: taskCost + costs.per_bid.bid_submission,
      };
    })(),
  };
}

/**
 * Get context data for Quarterly Business Review
 * Provides comprehensive strategic planning information
 *
 * @param input - Agent ID and partnership analysis options
 * @returns QBR context including metrics, market position, and partnership recommendations
 */
export async function getQBRContext(input: GetQBRContextInput): Promise<GetQBRContextOutput> {
  const { agent_id, include_partnership_recommendations } = input;

  // Fetch agent and stats - try by ID first, then by name
  let agent = null;

  // Check if agent_id looks like a UUID (basic validation)
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agent_id);

  if (isUUID) {
    // First try as UUID
    const { data: agentByID, error: errorByID } = await supabase
      .from("agents")
      .select("*")
      .eq("id", agent_id)
      .maybeSingle();

    if (agentByID) {
      agent = agentByID;
    } else if (errorByID) {
      throw new Error(`Failed to fetch agent: ${errorByID.message}`);
    }
  }

  // If not found by ID (or ID wasn't a UUID), try by name
  if (!agent) {
    const { data: agentByName, error: errorByName } = await supabase
      .from("agents")
      .select("*")
      .eq("name", agent_id)
      .maybeSingle();

    if (agentByName) {
      agent = agentByName;
    } else if (errorByName) {
      throw new Error(`Failed to fetch agent by name: ${errorByName.message}`);
    }
  }

  if (!agent) {
    throw new Error(`Agent not found: ${agent_id}`);
  }

  // Get historical data
  const { data: qbrHistory } = await supabase
    .from("qbr_history")
    .select("*")
    .eq("agent_id", agent_id)
    .order("created_at", { ascending: false });
    // Note: No limit here - we need full history to calculate correct qbr_number

  const lastQBR = qbrHistory?.[0];

  // Determine balance trend
  const balance_start_period = lastQBR?.input_metrics.balance_start || agent.balance;
  const balance_end_period = agent.balance;
  const balance_trend = balance_end_period > balance_start_period * 1.05 ? "growing" : balance_end_period < balance_start_period * 0.95 ? "declining" : "stable";

  // Determine runway trend
  const runway_trend = balance_end_period > 50 ? "improving" : balance_end_period > 10 ? "stable" : "critical";

  // Win rate changes
  const win_rate_start = lastQBR?.input_metrics.win_rate_start || 0.5;
  const { data: recentBids } = await supabase
    .from("bids_cache")
    .select("*")
    .eq("agent_id", agent.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const bids = recentBids || [];
  const win_rate_end = bids.length > 0 ? bids.filter((b) => b.status === "WON").length / bids.length : 0.5;
  const win_rate_change = win_rate_end - win_rate_start;

  // Market position
  const { data: allAgents } = await supabase
    .from("agents")
    .select("reputation, tasks_completed")
    .eq("type", agent.type);

  const reputationRank = (allAgents || []).filter((a) => a.reputation > agent.reputation).length;
  const totalAgents = allAgents?.length || 1;
  const market_position =
    reputationRank <= totalAgents * 0.33 ? "leader" : reputationRank <= totalAgents * 0.66 ? "competitive" : "struggling";

  // Reputation changes
  const reputation_start = lastQBR?.input_metrics.reputation_start || 3.0;
  const reputation_end = agent.reputation || 3.0;
  const reputation_change = reputation_end - reputation_start;

  // Recent losses
  const recent_losses = bids.filter((b) => b.status !== "WON").length;

  // Market competition
  const { data: competingAgents } = await supabase
    .from("agents")
    .select("*")
    .eq("type", agent.type)
    .neq("id", agent_id);

  const market_competition =
    (competingAgents?.length || 0) > totalAgents * 0.7 ? "increasing" : (competingAgents?.length || 0) > totalAgents * 0.3 ? "stable" : "decreasing";

  // Bid trend analysis
  const avgBid = bids.length > 0 ? bids.reduce((sum, b) => sum + (b.amount || 0), 0) / bids.length : 0;
  const maxBid = bids.length > 0 ? Math.max(...bids.map((b) => b.amount || 0)) : 0;
  const price_trends = maxBid > avgBid * 1.2 ? "expanding" : maxBid < avgBid * 0.8 ? "tightening" : "stable";

  // Demand trend
  const { data: activeTasks } = await supabase
    .from("tasks")
    .select("*")
    .eq("status", "ACTIVE")
    .limit(100);

  const demand_trend = (activeTasks?.length || 0) > 20 ? "growing" : (activeTasks?.length || 0) > 5 ? "stable" : "declining";

  // Partnership recommendations (if requested)
  let potential_partners: GetQBRContextOutput["potential_partners"] = [];
  if (include_partnership_recommendations) {
    const { data: candidates } = await supabase
      .from("agents")
      .select("*")
      .eq("type", agent.type)
      .neq("id", agent_id)
      .order("reputation", { ascending: false })
      .limit(5);

    potential_partners = (candidates || []).map((partner) => ({
      partner_id: partner.id,
      partner_name: partner.name,
      partner_type: partner.type,
      fit_score: 0.75, // Would calculate from analysis
      fit_reasoning: `Reputation match: ${partner.reputation.toFixed(1)}`,
      complementary_skills: [],
      reputation: partner.reputation || 0,
      recommended_split: 0.5,
    }));
  }

  // Policy performance evaluation
  const { data: qbrPolicyData } = await supabase
    .from("agent_policies")
    .select("policy_json")
    .eq("agent_id", agent_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const qbrCurrentPolicy = (qbrPolicyData?.policy_json || {}) as Record<string, any>;

  const bidding_stance =
    win_rate_end > 0.6 ? "appropriate" : win_rate_end > 0.4 ? "too_aggressive" : "too_conservative";

  // Compute current bid economics so brain has accurate data to reason with
  const qbrAgentType = agent.type as keyof typeof AGENT_COSTS;
  const qbrCostStructure = AGENT_COSTS[qbrAgentType] || AGENT_COSTS.CATALOG;
  const qbrAllInCost = calculateAllInCost(qbrCostStructure, agent.investor_share_bps || 7500, DEFAULT_LIVING_COST_PER_ROUND);
  const qbrTargetMargin = qbrCurrentPolicy.bidding?.target_margin ?? 0.15;
  const qbrCurrentBid = qbrAllInCost / (1 - qbrTargetMargin);
  const qbrBidScore = calculateBidScore(agent.reputation || 0, qbrCurrentBid);

  return {
    rounds_since_last_qbr: Math.max((lastQBR?.period.rounds_since_last || 10), 1),
    qbr_number: (qbrHistory?.length || 0) + 1,
    balance_start_period,
    balance_end_period,
    balance_trend,
    runway_trend,
    win_rate_start,
    win_rate_end,
    win_rate_change,
    market_position,
    reputation_start,
    reputation_end,
    reputation_change,
    recent_losses,
    market_competition,
    price_trends,
    demand_trend,
    potential_partners,
    policy_performance: {
      bidding_stance,
      margin_sustainability: agent.balance > 50 ? "healthy" : agent.balance > 20 ? "declining" : "critical",
      exception_sensitivity: "well_tuned",
    },
    comparable_agents: (competingAgents || []).slice(0, 3).map((a) => ({
      name: a.name,
      type: a.type,
      win_rate: 0.5, // Would calculate
      bid_discount: 0.1, // Would calculate
      reputation: a.reputation || 0,
    })),
    bid_economics: {
      all_in_cost: qbrAllInCost,
      current_bid_at_policy: qbrCurrentBid,
      current_bid_score: qbrBidScore,
      min_profitable_bid: calculateTaskCost(qbrCostStructure) + qbrCostStructure.per_bid.bid_submission,
    },
  };
}
