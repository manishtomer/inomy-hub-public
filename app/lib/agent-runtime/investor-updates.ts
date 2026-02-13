/**
 * Investor Updates Module
 *
 * Stores and retrieves investor transparency updates.
 * Every time the brain wakes up and makes changes, an investor update
 * is generated and stored in the database.
 *
 * Investors can view the full history of an agent's strategic decisions
 * through these updates.
 */

import { supabase } from "../supabase";
import type { InvestorUpdateData } from "./types";

/**
 * Context for storing an investor update
 */
export interface StoreInvestorUpdateContext {
  balance_before: number;
  balance_after: number;
  runway_rounds: number;
  round_number: number;
  policy_version_before: number;
  policy_version_after: number;
}

/**
 * Options for retrieving investor updates
 */
export interface GetInvestorUpdatesOptions {
  limit?: number;
  offset?: number;
  trigger_type?: "qbr" | "exception" | "novel" | "initial";
}

/**
 * Store an investor update to Supabase
 *
 * @param agentId - Agent UUID
 * @param update - Investor update data
 * @param context - Additional context (balance, runway, etc.)
 */
export async function storeInvestorUpdate(
  agentId: string,
  update: InvestorUpdateData,
  context: StoreInvestorUpdateContext
): Promise<void> {
  try {
    const { error } = await supabase.from("investor_updates").insert({
      agent_id: agentId,
      trigger_type: update.trigger_type,
      trigger_details: update.trigger_details,
      observations: update.observations,
      changes: update.changes,
      survival_impact: update.survival_impact,
      growth_impact: update.growth_impact,
      balance_before: context.balance_before,
      balance_after: context.balance_after,
      runway_rounds: context.runway_rounds,
      brain_cost: update.brain_cost,
      round_number: context.round_number,
      policy_version_before: context.policy_version_before,
      policy_version_after: context.policy_version_after,
    });

    if (error) {
      console.error("[InvestorUpdates] Error storing update:", error);
      throw error;
    }

    console.log(
      `[InvestorUpdates] Stored ${update.trigger_type} update for agent ${agentId}`
    );
  } catch (error) {
    console.error("[InvestorUpdates] Failed to store update:", error);
    // Don't throw - we don't want to fail the brain operation if update storage fails
  }
}

/**
 * Get investor updates for an agent
 *
 * @param agentId - Agent UUID
 * @param options - Query options (limit, offset, filter)
 * @returns Array of investor updates
 */
export async function getInvestorUpdates(
  agentId: string,
  options: GetInvestorUpdatesOptions = {}
): Promise<InvestorUpdateData[]> {
  const { limit = 50, offset = 0, trigger_type } = options;

  try {
    let query = supabase
      .from("investor_updates")
      .select("*")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false });

    if (trigger_type) {
      query = query.eq("trigger_type", trigger_type);
    }

    const { data, error } = await query.range(offset, offset + limit - 1);

    if (error) {
      console.error("[InvestorUpdates] Error fetching updates:", error);
      throw error;
    }

    // Map database records to InvestorUpdateData
    return (data || []).map((record) => ({
      trigger_type: record.trigger_type as
        | "qbr"
        | "exception"
        | "novel"
        | "initial",
      trigger_details: record.trigger_details,
      observations: record.observations as string[],
      changes: record.changes as any[],
      survival_impact: record.survival_impact,
      growth_impact: record.growth_impact,
      brain_cost: record.brain_cost,
    }));
  } catch (error) {
    console.error("[InvestorUpdates] Failed to fetch updates:", error);
    return [];
  }
}

/**
 * Format an investor update as a human-readable string
 * Used for logging and console display
 *
 * @param agentName - Name of the agent
 * @param update - Investor update data
 * @returns Formatted string
 */
export function formatInvestorUpdate(
  agentName: string,
  update: InvestorUpdateData
): string {
  const lines: string[] = [];

  // Header
  const icon = {
    qbr: "📊",
    exception: "⚠️",
    novel: "🤔",
    initial: "🎯",
  }[update.trigger_type];

  const title = {
    qbr: "QUARTERLY BUSINESS REVIEW",
    exception: "EXCEPTION ALERT",
    novel: "NOVEL SITUATION",
    initial: "AGENT INITIALIZED",
  }[update.trigger_type];

  lines.push(`${icon} ${title} - ${agentName}`);
  lines.push("━".repeat(60));
  lines.push("");

  // Trigger
  lines.push(`Trigger: ${update.trigger_details}`);
  lines.push("");

  // Observations
  if (update.observations.length > 0) {
    lines.push("What I observed:");
    update.observations.forEach((obs) => {
      lines.push(`• ${obs}`);
    });
    lines.push("");
  }

  // Changes
  if (update.changes.length > 0) {
    lines.push("Changes I'm making:");
    update.changes.forEach((change, idx) => {
      lines.push(`\n${idx + 1}. ${change.category.toUpperCase()}: ${change.description}`);
      lines.push(`   Why: ${change.reasoning}`);
    });
    lines.push("");
  } else {
    lines.push("No changes needed at this time.");
    lines.push("");
  }

  // Impact
  lines.push("How this serves your investment:");
  lines.push(`• Survival: ${update.survival_impact}`);
  lines.push(`• Growth: ${update.growth_impact}`);
  lines.push("");

  // Cost
  lines.push(`Cost of this review: $${update.brain_cost.toFixed(3)}`);

  return lines.join("\n");
}

/**
 * Get the latest investor update for an agent
 *
 * @param agentId - Agent UUID
 * @returns Most recent investor update or null
 */
export async function getLatestInvestorUpdate(
  agentId: string
): Promise<InvestorUpdateData | null> {
  const updates = await getInvestorUpdates(agentId, { limit: 1 });
  return updates.length > 0 ? updates[0] : null;
}

/**
 * Get count of investor updates for an agent
 *
 * @param agentId - Agent UUID
 * @returns Total number of updates
 */
export async function getInvestorUpdateCount(
  agentId: string
): Promise<number> {
  try {
    const { count, error } = await supabase
      .from("investor_updates")
      .select("*", { count: "exact", head: true })
      .eq("agent_id", agentId);

    if (error) {
      console.error("[InvestorUpdates] Error counting updates:", error);
      return 0;
    }

    return count || 0;
  } catch (error) {
    console.error("[InvestorUpdates] Failed to count updates:", error);
    return 0;
  }
}

/**
 * Get investor updates grouped by trigger type
 *
 * @param agentId - Agent UUID
 * @returns Object with counts per trigger type
 */
export async function getInvestorUpdateSummary(agentId: string): Promise<{
  total: number;
  qbr: number;
  exception: number;
  novel: number;
  initial: number;
}> {
  try {
    const { data, error } = await supabase
      .from("investor_updates")
      .select("trigger_type")
      .eq("agent_id", agentId);

    if (error) {
      console.error("[InvestorUpdates] Error fetching summary:", error);
      return { total: 0, qbr: 0, exception: 0, novel: 0, initial: 0 };
    }

    const summary = {
      total: data.length,
      qbr: 0,
      exception: 0,
      novel: 0,
      initial: 0,
    };

    data.forEach((record) => {
      const type = record.trigger_type as
        | "qbr"
        | "exception"
        | "novel"
        | "initial";
      summary[type]++;
    });

    return summary;
  } catch (error) {
    console.error("[InvestorUpdates] Failed to fetch summary:", error);
    return { total: 0, qbr: 0, exception: 0, novel: 0, initial: 0 };
  }
}
