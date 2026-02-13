/**
 * Agent Action Tools
 *
 * State-modifying tools that enable agents to execute strategic decisions.
 * Each action is cost-bearing and must include complete reasoning for transparency.
 *
 * Tools in this module:
 * - update_policy: Apply policy changes based on strategic thinking
 * - propose_partnership: Initiate partnership negotiations
 * - create_investor_update: Document decisions for investor transparency
 */

import { supabase } from "@/lib/supabase";
import { AGENT_COSTS } from "@/lib/agent-runtime/constants";
import {
  calculateAllInCost,
  calculateBidScore,
  calculateTaskCost,
  DEFAULT_LIVING_COST_PER_ROUND,
} from "@/lib/agent-runtime/autopilot";
import type {
  UpdatePolicyInput,
  UpdatePolicyOutput,
  CreateInvestorUpdateInput,
  CreateInvestorUpdateOutput,
} from "@/types/agent-system";

/**
 * Update agent policy with complete reasoning documentation
 * Every policy change is versioned and includes reasoning for auditing
 *
 * @param input - Agent ID, policy updates, reasoning, and trigger details
 * @returns Confirmation with version number and cost charged
 */
export async function updatePolicy(input: UpdatePolicyInput): Promise<UpdatePolicyOutput> {
  const { agent_id, policy_updates, reasoning, trigger_type: _triggerType, trigger_details: _triggerDetails } = input;

  // Validate inputs
  if (!reasoning) {
    throw new Error(`Missing reasoning: all policy updates must include reasoning`);
  }

  // Allow empty policy_updates (when policy is kept unchanged) - reasoning explains why
  if (policy_updates && typeof policy_updates !== 'object') {
    throw new Error(`Invalid policy_updates: must be an object. Received: ${JSON.stringify(policy_updates)}`);
  }

  // Fetch current policy to compare
  const { data: currentPolicyData, error: fetchError } = await supabase
    .from("agent_policies")
    .select("*")
    .eq("agent_id", agent_id)
    .single();

  if (fetchError && fetchError.code !== "PGRST116") {
    // PGRST116 is "no rows returned" - that's OK for new agents
    throw new Error(`Failed to fetch current policy: ${fetchError.message}`);
  }

  const currentPolicy = currentPolicyData?.policy_json || {};
  const currentVersion = currentPolicyData?.policy_version || 0;

  // Normalize policy_updates: LLM sometimes sends bidding keys at the top level
  // (e.g., {target_margin: 0.04}) instead of nested ({bidding: {target_margin: 0.04}}).
  // Detect and re-nest stray bidding keys.
  const BIDDING_KEYS = new Set(['target_margin', 'min_margin', 'skip_below', 'skip_below_profit']);
  const normalizedUpdates: Record<string, unknown> = {};
  const strayBiddingKeys: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(policy_updates)) {
    if (BIDDING_KEYS.has(key)) {
      strayBiddingKeys[key] = value;
    } else {
      normalizedUpdates[key] = value;
    }
  }

  if (Object.keys(strayBiddingKeys).length > 0) {
    // Merge stray keys into the bidding sub-object
    const existingBiddingUpdate = (normalizedUpdates.bidding || {}) as Record<string, unknown>;
    normalizedUpdates.bidding = { ...existingBiddingUpdate, ...strayBiddingKeys };
    console.log(`[update_policy] Normalized stray bidding keys: ${JSON.stringify(strayBiddingKeys)} → bidding sub-object`);
  }

  // Convert whole-number margins from LLM to fractions for storage.
  // LLM sends target_margin=8 meaning 8%, code stores 0.08.
  // Detect: if value > 1, it's a whole number percentage.
  const biddingUpdate = normalizedUpdates.bidding as Record<string, unknown> | undefined;
  if (biddingUpdate) {
    for (const marginKey of ['target_margin', 'min_margin']) {
      const val = biddingUpdate[marginKey];
      if (typeof val === 'number' && val >= 1) {
        const converted = val / 100;
        console.log(`[update_policy] Converting ${marginKey}: ${val} (whole %) → ${converted} (fraction)`);
        biddingUpdate[marginKey] = converted;
      }
    }
  }

  // Calculate changes applied and detect no-ops
  const changes_applied: Array<{ field: string; old_value: unknown; new_value: unknown }> = [];
  const warnings: string[] = [];

  for (const [key, value] of Object.entries(normalizedUpdates)) {
    const oldValue = (currentPolicy as Record<string, unknown>)[key];
    changes_applied.push({
      field: key,
      old_value: oldValue,
      new_value: value,
    });

    // HARD REJECT: bidding.target_margin unchanged
    if (key === 'bidding' && value && typeof value === 'object' && oldValue && typeof oldValue === 'object') {
      const newBidding = value as Record<string, unknown>;
      const oldBidding = oldValue as Record<string, unknown>;
      if (newBidding.target_margin !== undefined && oldBidding.target_margin !== undefined &&
          newBidding.target_margin === oldBidding.target_margin) {
        throw new Error(
          `REJECTED: target_margin is UNCHANGED at ${((newBidding.target_margin as number) * 100).toFixed(1)}%. ` +
          `You must set a DIFFERENT value. To be more competitive, LOWER the number. To increase profit per win, RAISE it. ` +
          `Refer to the BID SIMULATOR table for exact bid outcomes at each margin.`
        );
      }
    }
  }

  // Detect: no bidding changes at all when bidding exists
  if (!normalizedUpdates.bidding && currentPolicy && (currentPolicy as Record<string, unknown>).bidding) {
    warnings.push(
      `NOTE: No bidding changes were made. Your bid amount will remain exactly the same next round.`
    );
  }

  // Deep merge: merge sub-objects (bidding, survival, etc.) instead of replacing them
  const newPolicy = { ...currentPolicy } as Record<string, unknown>;
  for (const [key, value] of Object.entries(normalizedUpdates)) {
    if (value && typeof value === 'object' && !Array.isArray(value) &&
        newPolicy[key] && typeof newPolicy[key] === 'object' && !Array.isArray(newPolicy[key])) {
      // Deep merge one level: merge into existing sub-object
      newPolicy[key] = { ...(newPolicy[key] as Record<string, unknown>), ...(value as Record<string, unknown>) };
    } else {
      newPolicy[key] = value;
    }
  }
  const brain_cost = 0.01; // Cost of LLM call that generated this decision

  let newPolicyVersion;
  let updateError;

  if (currentPolicyData) {
    // UPDATE existing policy
    const { data: updated, error: err } = await supabase
      .from("agent_policies")
      .update({
        personality: currentPolicyData.personality || "profit-maximizer",
        policy_json: newPolicy,
        policy_version: currentVersion + 1,
        is_current: true,
        updated_at: new Date().toISOString(),
      })
      .eq("agent_id", agent_id)
      .select()
      .single();
    newPolicyVersion = updated;
    updateError = err;
  } else {
    // INSERT new policy for this agent
    const { data: inserted, error: err } = await supabase
      .from("agent_policies")
      .insert([
        {
          agent_id,
          personality: "profit-maximizer",
          policy_json: newPolicy,
          policy_version: 1,
          is_current: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();
    newPolicyVersion = inserted;
    updateError = err;
  }

  if (updateError || !newPolicyVersion) {
    throw new Error(`Failed to create policy version: ${updateError?.message}`);
  }

  // Fetch updated agent data (balance + type + reputation + investor_share)
  const { data: agent } = await supabase
    .from("agents")
    .select("balance, type, reputation, investor_share_bps")
    .eq("id", agent_id)
    .single();

  const balance_after = (agent?.balance || 0) - brain_cost;

  // Compute bid impact: what does this new policy ACTUALLY produce?
  const mergedBidding = (newPolicy.bidding || {}) as Record<string, unknown>;
  const newTargetMargin = (mergedBidding.target_margin as number) ?? 0.15;
  const agentType = (agent?.type || 'CATALOG') as keyof typeof AGENT_COSTS;
  const costs = AGENT_COSTS[agentType] || AGENT_COSTS.CATALOG;
  const allInCost = calculateAllInCost(costs, agent?.investor_share_bps || 7500, DEFAULT_LIVING_COST_PER_ROUND);
  const resultingBid = allInCost / (1 - newTargetMargin);
  const resultingScore = calculateBidScore(agent?.reputation || 0, resultingBid);
  const taskCost = calculateTaskCost(costs);
  const profitPerWin = resultingBid - allInCost;

  const bid_impact = {
    target_margin: newTargetMargin,
    all_in_cost: allInCost,
    resulting_bid: resultingBid,
    resulting_score: resultingScore,
    profit_per_win: profitPerWin,
    min_profitable_bid: taskCost + costs.per_bid.bid_submission,
    explanation: `At target_margin=${Math.round(newTargetMargin * 100)}, your bid = $${resultingBid.toFixed(4)}. Score = ${resultingScore.toFixed(0)}. Profit per win: $${profitPerWin.toFixed(4)}.`,
  };

  if (warnings.length > 0) {
    console.log(`[update_policy] Warnings for agent ${agent_id}: ${warnings.join(' | ')}`);
  }

  console.log(`[update_policy] Agent ${agent_id}: margin=${(newTargetMargin * 100).toFixed(1)}% → bid=$${resultingBid.toFixed(4)}, score=${resultingScore.toFixed(0)}`);

  return {
    success: true,
    policy_id: newPolicyVersion.id,
    timestamp: newPolicyVersion.created_at,
    version: newPolicyVersion.policy_version,
    reason_hash: Buffer.from(reasoning || "").toString("base64").substring(0, 16),
    changes_applied,
    bid_impact,
    brain_cost,
    balance_after,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/**
 * Propose partnership between two agents
 * Creates partnership record with agent name lookup (not ID-based)
 *
 * @param input - Current agent ID (injected), target agent name, splits, and reasoning
 * @returns Partnership proposal with ID and confirmation
 */
export async function proposePartnership(input: {
  agent_id: string; // INJECTED by execution layer (current agent)
  target_agent_name: string; // Partner name (NOT ID)
  proposed_split_self: number;
  proposed_split_partner: number;
  reasoning: string;
}): Promise<{
  success: boolean;
  partnership_id: string;
  target_name: string;
  message: string;
  reasoning: string;
  cost: number;
}> {
  const { agent_id, target_agent_name, proposed_split_self, proposed_split_partner, reasoning } = input;

  // Validate inputs
  if (!target_agent_name) {
    throw new Error(`Missing target_agent_name: must specify the agent to partner with`);
  }

  if (typeof proposed_split_self !== 'number' || typeof proposed_split_partner !== 'number') {
    throw new Error(`Invalid splits: must be numbers. Got ${typeof proposed_split_self} and ${typeof proposed_split_partner}`);
  }

  if (!reasoning) {
    throw new Error(`Missing reasoning: partnerships must include reasoning`);
  }

  // Fetch current agent
  const { data: currentAgent, error: currentError } = await supabase
    .from("agents")
    .select("*")
    .eq("id", agent_id)
    .single();

  if (currentError || !currentAgent) {
    throw new Error(`Failed to fetch current agent ${agent_id}: ${currentError?.message}`);
  }

  // Look up target agent by NAME (not by passed ID - security fix)
  const { data: targetAgent, error: targetError } = await supabase
    .from("agents")
    .select("*")
    .eq("name", target_agent_name)
    .maybeSingle();

  if (targetError || !targetAgent) {
    throw new Error(`Agent not found: ${target_agent_name}`);
  }

  // Prevent self-partnership
  if (targetAgent.id === agent_id) {
    throw new Error(`Cannot propose partnership with yourself (${target_agent_name})`);
  }

  // Create partnership record
  const { data: partnership, error: createError } = await supabase
    .from("partnerships_cache")
    .insert([
      {
        agent1_id: agent_id,
        agent2_id: targetAgent.id,
        partner_a_wallet: currentAgent.wallet_address,
        partner_b_wallet: targetAgent.wallet_address,
        agent1_split: Math.round(proposed_split_self * 100), // Store as basis points (0-100)
        agent2_split: Math.round(proposed_split_partner * 100), // Store as basis points (0-100)
        split_a: Math.round(proposed_split_self * 100), // Store as basis points (0-100) for integer column
        split_b: Math.round(proposed_split_partner * 100), // Store as basis points (0-100) for integer column
        status: "PROPOSED", // Partnership starts in PROPOSED state pending confirmation
        balance: 0,
        total_revenue: 0,
        last_synced_block: 0,
      },
    ])
    .select()
    .single();

  if (createError || !partnership) {
    throw new Error(`Failed to create partnership proposal: ${createError?.message}`);
  }

  return {
    success: true,
    partnership_id: partnership.id,
    target_name: targetAgent.name,
    message: `Partnership proposal created with ${targetAgent.name}`,
    reasoning,
    cost: 0.01,
  };
}

/**
 * Get current partnerships for an agent
 * Returns active partnerships with optional performance metrics
 *
 * @param input - Agent ID (injected) and whether to include performance
 * @returns List of current partnerships
 */
export async function getCurrentPartnerships(input: {
  agent_id: string; // INJECTED by execution layer
  include_performance?: boolean;
}): Promise<{
  partnerships: Array<{
    partner_name: string;
    partner_id: string;
    partner_type: string;
    split_self: number;
    split_partner: number;
    status: string;
    created_at: string;
    partner_win_rate?: number;
    partner_reputation?: number;
    partner_balance?: number;
  }>;
  total_partnerships: number;
}> {
  const { agent_id, include_performance } = input;

  // Query active partnerships for this agent
  const { data: partnerships, error: partError } = await supabase
    .from("partnerships_cache")
    .select("*")
    .or(`agent1_id.eq.${agent_id},agent2_id.eq.${agent_id}`)
    .eq("status", "ACTIVE");

  if (partError || !partnerships) {
    throw new Error(`Failed to fetch partnerships: ${partError?.message}`);
  }

  // For each partnership, get partner details
  const enrichedPartnerships = await Promise.all(
    partnerships.map(async (p) => {
      // Determine which agent is the partner
      const isAgent1 = p.agent1_id === agent_id;
      const partnerId = isAgent1 ? p.agent2_id : p.agent1_id;
      const splitSelf = isAgent1 ? (p.split_a || 0) : (p.split_b || 0);
      const splitPartner = isAgent1 ? (p.split_b || 0) : (p.split_a || 0);

      // Fetch partner agent details
      const { data: partner } = await supabase
        .from("agents")
        .select("*")
        .eq("id", partnerId)
        .single();

      if (!partner) {
        return null;
      }

      const result: any = {
        partner_name: partner.name,
        partner_id: partner.id,
        partner_type: partner.type,
        split_self: splitSelf,
        split_partner: splitPartner,
        status: p.status,
        created_at: p.created_at,
      };

      // Add performance metrics if requested
      if (include_performance) {
        const totalTasks = (partner.tasks_completed || 0) + (partner.tasks_failed || 0);
        result.partner_win_rate = totalTasks > 0 ? partner.tasks_completed / totalTasks : 0;
        result.partner_reputation = partner.reputation;
        result.partner_balance = partner.balance;
      }

      return result;
    })
  );

  // Filter out null entries
  const validPartnerships = enrichedPartnerships.filter((p) => p !== null);

  return {
    partnerships: validPartnerships,
    total_partnerships: validPartnerships.length,
  };
}

/**
 * End an existing partnership
 * Marks partnership as DISSOLVED with reasoning for audit trail
 *
 * @param input - Current agent ID (injected), target agent name, and reasoning
 * @returns Partnership dissolution confirmation
 */
export async function killPartnership(input: {
  agent_id: string; // INJECTED by execution layer
  target_agent_name: string;
  reasoning: string;
}): Promise<{
  success: boolean;
  partnership_id: string;
  message: string;
  reasoning: string;
  cost: number;
}> {
  const { agent_id, target_agent_name, reasoning } = input;

  // Look up target agent by name
  const { data: targetAgent, error: targetError } = await supabase
    .from("agents")
    .select("*")
    .eq("name", target_agent_name)
    .maybeSingle();

  if (targetError || !targetAgent) {
    throw new Error(`Agent not found: ${target_agent_name}`);
  }

  // Find active partnership between current agent and target
  const { data: partnership, error: partError } = await supabase
    .from("partnerships_cache")
    .select("*")
    .or(`agent1_id.eq.${agent_id},agent2_id.eq.${agent_id}`)
    .or(`agent1_id.eq.${targetAgent.id},agent2_id.eq.${targetAgent.id}`)
    .eq("status", "ACTIVE")
    .maybeSingle();

  if (partError || !partnership) {
    throw new Error(`No active partnership found with ${target_agent_name}`);
  }

  // Update partnership status to DISSOLVED
  const { error: updateError } = await supabase
    .from("partnerships_cache")
    .update({
      status: "DISSOLVED",
    })
    .eq("id", partnership.id);

  if (updateError) {
    throw new Error(`Failed to end partnership: ${updateError.message}`);
  }

  return {
    success: true,
    partnership_id: partnership.id,
    message: `Partnership with ${target_agent_name} ended`,
    reasoning,
    cost: 0.01,
  };
}

/**
 * Create investor update to document decision-making
 * Provides complete transparency about why policy changes were made
 *
 * @param input - Agent info, trigger, observations, and impact assessment
 * @returns Update ID and confirmation that update was posted
 */
export async function createInvestorUpdate(input: CreateInvestorUpdateInput): Promise<CreateInvestorUpdateOutput> {
  const { agent_id, trigger_type, observations, changes, survival_impact, growth_impact, brain_cost } = input;

  // Fetch agent details
  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .select("*")
    .eq("id", agent_id)
    .single();

  if (agentError || !agent) {
    throw new Error(`Failed to fetch agent: ${agentError?.message}`);
  }

  // Fetch current agent runtime state for balance info
  const { data: runtimeState } = await supabase
    .from("agent_runtime_state")
    .select("current_round")
    .eq("agent_id", agent_id)
    .single();

  const balance_after = (agent?.balance || 0) - brain_cost;
  const runway_rounds = balance_after > 0 ? Math.ceil(balance_after / 5) : 0;
  const current_round = runtimeState?.current_round || 0;

  // Format investor update using actual table schema
  const { data: investorUpdate, error: insertError } = await supabase
    .from("investor_updates")
    .insert([
      {
        agent_id,
        trigger_type,
        trigger_details: `${trigger_type} triggered strategic review for ${agent.name}`,
        observations,
        changes: changes.map((c) => ({
          category: c.category,
          description: c.description,
          reasoning: c.reasoning,
        })),
        survival_impact,
        growth_impact,
        balance_before: agent.balance,
        balance_after,
        runway_rounds,
        brain_cost,
        round_number: current_round,
        policy_version_before: 0, // Would be set by brain
        policy_version_after: 0, // Would be set by brain
      },
    ])
    .select()
    .single();

  if (insertError || !investorUpdate) {
    throw new Error(`Failed to create investor update: ${insertError?.message}`);
  }

  // Build HTML summary
  const htmlSummary = `
    <div class="investor-update">
      <h2>${agent.name} - ${trigger_type} Update</h2>
      <p><strong>Status:</strong> ${balance_after > 50 ? "healthy" : balance_after > 20 ? "caution" : "critical"}</p>
      <p><strong>Balance Before:</strong> $${agent.balance.toFixed(2)}</p>
      <p><strong>Balance After:</strong> $${balance_after.toFixed(2)}</p>
      <p><strong>Brain Cost:</strong> $${brain_cost.toFixed(4)}</p>
      <h3>Changes</h3>
      <ul>
        ${changes.map((c) => `<li><strong>${c.category}:</strong> ${c.description}</li>`).join("")}
      </ul>
      <h3>Impact</h3>
      <p><strong>Survival Impact:</strong> ${survival_impact}</p>
      <p><strong>Growth Impact:</strong> ${growth_impact}</p>
    </div>
  `;

  return {
    success: true,
    update_id: investorUpdate.id,
    timestamp: investorUpdate.created_at,
    html_summary: htmlSummary,
    posted_to_profile: true,
    notification_sent: true,
  };
}
