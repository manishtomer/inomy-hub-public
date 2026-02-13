import { supabase } from "./supabase";
import type {
  Agent,
  CreateAgentRequest,
  UpdateAgentRequest,
  Task,
  CreateTaskRequest,
  UpdateTaskRequest,
  Intent,
  CreateIntentRequest,
  UpdateIntentRequest,
} from "@/types/database";

/**
 * Fetch data from Supabase table
 * Returns { data, error } directly for consistent API usage
 */
export async function fetchFromTable(
  tableName: string,
  options?: {
    select?: string;
    filters?: Record<string, unknown>;
    limit?: number;
    orderBy?: string;
  }
): Promise<{ data: unknown[] | null; error: { message: string } | null }> {
  let query = supabase.from(tableName).select(options?.select || "*");

  // Apply filters
  if (options?.filters) {
    for (const [key, value] of Object.entries(options.filters)) {
      query = query.eq(key, value);
    }
  }

  // Apply limit
  if (options?.limit) {
    query = query.limit(options.limit);
  }

  // Apply order
  if (options?.orderBy) {
    query = query.order(options.orderBy, { ascending: false });
  }

  // Execute the query and return result directly
  const result = await query;
  return result as { data: unknown[] | null; error: { message: string } | null };
}

/**
 * Insert data into Supabase table
 */
export async function insertIntoTable(tableName: string, data: Record<string, unknown>) {
  return supabase.from(tableName).insert([data]).select();
}

/**
 * Update data in Supabase table
 */
export async function updateInTable(
  tableName: string,
  id: string,
  data: Record<string, unknown>
) {
  return supabase.from(tableName).update(data).eq("id", id).select();
}

/**
 * Delete data from Supabase table
 */
export async function deleteFromTable(tableName: string, id: string) {
  return supabase.from(tableName).delete().eq("id", id);
}

/**
 * Error handler for API responses
 */
export function handleSupabaseError(error: { message?: string } | null) {
  return {
    error: error?.message || "Database operation failed",
    status: 400,
  };
}

// ============================================================================
// AGENT-SPECIFIC HELPERS
// ============================================================================

/**
 * Fetch all agents with optional filters
 * Returns { data, error } directly
 */
export async function getAllAgents(options?: { limit?: number; orderBy?: string }): Promise<{ data: Agent[] | null; error: { message: string } | null }> {
  const result = await fetchFromTable("agents", {
    limit: options?.limit,
    orderBy: options?.orderBy || "created_at",
  });
  return result as { data: Agent[] | null; error: { message: string } | null };
}

/**
 * Fetch a single agent by ID
 */
export async function getAgentById(id: string) {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return { data: null, error };
  return { data: data as Agent, error: null };
}

/**
 * Create a new agent
 * Applies default values for optional fields
 */
export async function createAgent(agent: CreateAgentRequest) {
  // Apply default values for required database fields
  const agentWithDefaults = {
    name: agent.name,
    type: agent.type,
    status: agent.status || "UNFUNDED",
    balance: agent.balance ?? 0,
    reputation: agent.reputation ?? 3.0,
    token_price: agent.token_price ?? 0.001,
    tasks_completed: 0,
    tasks_failed: 0,
  };

  const { data, error } = await supabase
    .from("agents")
    .insert([agentWithDefaults])
    .select()
    .single();

  if (error) return { data: null, error };
  return { data: data as Agent, error: null };
}

/**
 * Update an agent
 */
export async function updateAgent(id: string, updates: UpdateAgentRequest) {
  const { data, error } = await supabase
    .from("agents")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) return { data: null, error };
  return { data: data as Agent, error: null };
}

/**
 * Delete an agent
 */
export async function deleteAgent(id: string) {
  return supabase.from("agents").delete().eq("id", id);
}

/**
 * Update agent wallet fields after Privy wallet creation
 */
export async function updateAgentWallet(
  id: string,
  walletData: {
    wallet_address: string;
    privy_wallet_id: string;
    privy_user_id: string;
  }
) {
  const { data, error } = await supabase
    .from("agents")
    .update({
      wallet_address: walletData.wallet_address,
      privy_wallet_id: walletData.privy_wallet_id,
      privy_user_id: walletData.privy_user_id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return { data: null, error };
  return { data, error: null };
}

// ============================================================================
// TASK-SPECIFIC HELPERS
// ============================================================================

/**
 * Fetch all tasks with optional filters
 * Returns { data, error } directly
 */
export async function getAllTasks(options?: {
  limit?: number;
  orderBy?: string;
  status?: string;
  type?: string;
  include_bids?: boolean;
}): Promise<{ data: Task[] | null; error: { message: string } | null }> {
  const selectClause = options?.include_bids
    ? "*, agents(*), bids_cache!bids_cache_task_id_fkey(id, agent_id, bidder_wallet, amount, status, agents(id, name))"
    : "*, agents(*)";
  let query = supabase.from("tasks").select(selectClause);

  if (options?.status) {
    query = query.eq("status", options.status);
  }

  if (options?.type) {
    query = query.eq("type", options.type);
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  if (options?.orderBy) {
    query = query.order(options.orderBy, { ascending: false });
  }

  const result = await query;

  // Map bids_cache to bids for frontend compatibility
  if (options?.include_bids && result.data) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result.data = (result.data as any[]).map((task) => ({
      ...task,
      bids: (task.bids_cache || []).sort(
        (a: { amount: number }, b: { amount: number }) => a.amount - b.amount
      ),
      bids_cache: undefined,
    }));
  }

  return result as { data: Task[] | null; error: { message: string } | null };
}

/**
 * Fetch a single task by ID
 * When include_bids is true, joins bids_cache with nested agent data
 */
export async function getTaskById(id: string, options?: { include_bids?: boolean }) {
  if (options?.include_bids) {
    const { data, error } = await supabase
      .from("tasks")
      .select("*, agents(*), bids_cache!bids_cache_task_id_fkey(id, agent_id, bidder_wallet, amount, status, estimated_duration, proposal_uri, created_at, agents(id, name, type, reputation, wallet_address))")
      .eq("id", id)
      .single();

    if (error) return { data: null, error };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const taskData = data as any;
    const mapped = {
      ...taskData,
      bids: (taskData.bids_cache || []).sort(
        (a: { amount: number }, b: { amount: number }) => a.amount - b.amount
      ),
      bids_cache: undefined,
    };
    return { data: mapped as Task, error: null };
  }

  const { data, error } = await supabase
    .from("tasks")
    .select("*, agents(*)")
    .eq("id", id)
    .single();

  if (error) return { data: null, error };
  return { data: data as Task, error: null };
}

/**
 * Create a new task
 */
export async function createTask(task: CreateTaskRequest) {
  const { data, error } = await supabase
    .from("tasks")
    .insert([task])
    .select("*, agents(*)")
    .single();

  if (error) return { data: null, error };
  return { data: data as Task, error: null };
}

/**
 * Update a task
 */
export async function updateTask(id: string, updates: UpdateTaskRequest) {
  const { data, error } = await supabase
    .from("tasks")
    .update(updates)
    .eq("id", id)
    .select("*, agents(*)")
    .single();

  if (error) return { data: null, error };
  return { data: data as Task, error: null };
}

/**
 * Delete a task
 */
export async function deleteTask(id: string) {
  return supabase.from("tasks").delete().eq("id", id);
}

// ============================================================================
// INTENT-SPECIFIC HELPERS
// ============================================================================

/**
 * Fetch all intents with optional filters
 * Returns { data, error } directly
 */
export async function getAllIntents(options?: {
  limit?: number;
  orderBy?: string;
  status?: string;
  category?: string;
  include_responses?: boolean;
}): Promise<{ data: Intent[] | null; error: { message: string } | null }> {
  const selectClause = options?.include_responses
    ? "*, offers_cache(id, intent_id, agent_id, agent_wallet, price, proposal_text, matched_tags, relevance_score, status, submitted_at)"
    : "*";
  let query = supabase.from("intents").select(selectClause);

  if (options?.status) {
    query = query.eq("status", options.status);
  }

  if (options?.category) {
    query = query.eq("category", options.category);
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  if (options?.orderBy) {
    query = query.order(options.orderBy, { ascending: false });
  }

  const result = await query;

  // Map offers_cache to responses for frontend compatibility
  if (options?.include_responses && result.data) {
    // Collect all unique agent IDs from offers
    const agentIds = new Set<string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (result.data as any[]).forEach((intent) => {
      if (intent.offers_cache) {
        intent.offers_cache.forEach((offer: { agent_id: string | null }) => {
          if (offer.agent_id) agentIds.add(offer.agent_id);
        });
      }
    });

    // Fetch all agent names and types in one query
    const agentMap = new Map<string, { name: string; type: string }>();
    if (agentIds.size > 0) {
      const { data: agentsData } = await supabase
        .from("agents")
        .select("id, name, type")
        .in("id", Array.from(agentIds));

      if (agentsData) {
        agentsData.forEach((agent: { id: string; name: string; type: string }) => {
          agentMap.set(agent.id, { name: agent.name, type: agent.type });
        });
      }
    }

    // Transform offers_cache to responses
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result.data = (result.data as any[]).map((intent) => {
      const responses = (intent.offers_cache || []).map((offer: {
        id: string;
        intent_id: string | null;
        agent_id: string | null;
        agent_wallet: string;
        price: number;
        proposal_text: string | null;
        relevance_score: number;
        submitted_at: string;
      }) => {
        const agent = offer.agent_id ? agentMap.get(offer.agent_id) : null;
        return {
          id: offer.id,
          intent_id: offer.intent_id || intent.id,
          agent_id: offer.agent_id || "",
          agent_name: agent?.name || "Unknown Agent",
          agent_type: agent?.type || "SELLER",
          proposed_price: offer.price,
          response_text: offer.proposal_text || "",
          confidence: Math.round((offer.relevance_score || 0) * 100), // Convert 0-1 to percentage
          created_at: offer.submitted_at,
        };
      }).sort(
        // Sort by confidence descending (best first)
        (a: { confidence: number }, b: { confidence: number }) => b.confidence - a.confidence
      );

      return {
        ...intent,
        responses,
        offers_cache: undefined,
      };
    });
  }

  return result as { data: Intent[] | null; error: { message: string } | null };
}

/**
 * Fetch a single intent by ID
 */
export async function getIntentById(id: string) {
  const { data, error } = await supabase
    .from("intents")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return { data: null, error };
  return { data: data as Intent, error: null };
}

/**
 * Create a new intent
 */
export async function createIntent(intent: CreateIntentRequest) {
  const { data, error } = await supabase
    .from("intents")
    .insert([intent])
    .select()
    .single();

  if (error) return { data: null, error };
  return { data: data as Intent, error: null };
}

/**
 * Update an intent
 */
export async function updateIntent(id: string, updates: UpdateIntentRequest) {
  const { data, error } = await supabase
    .from("intents")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return { data: null, error };
  return { data: data as Intent, error: null };
}

/**
 * Delete an intent
 */
export async function deleteIntent(id: string) {
  return supabase.from("intents").delete().eq("id", id);
}

// ============================================================================
// INVESTOR-SPECIFIC HELPERS
// ============================================================================

/**
 * Fetch all investors with optional filters
 * Returns { data, error } directly
 */
export async function getAllInvestors(options?: { limit?: number; orderBy?: string }) {
  const result = await fetchFromTable("investors", {
    limit: options?.limit,
    orderBy: options?.orderBy || "created_at",
  });
  return result;
}

/**
 * Fetch a single investor by ID
 */
export async function getInvestorById(id: string) {
  const { data, error } = await supabase
    .from("investors")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return { data: null, error };
  return { data, error: null };
}

/**
 * Create a new investor
 */
export async function createInvestor(investor: { name: string; wallet_address: string }) {
  const { data, error } = await supabase
    .from("investors")
    .insert([investor])
    .select()
    .single();

  if (error) return { data: null, error };
  return { data, error: null };
}

// ============================================================================
// TOKEN HOLDINGS HELPERS
// ============================================================================

/**
 * Fetch all token holdings with optional filters
 * Returns { data, error } directly
 */
export async function getAllHoldings(options?: {
  limit?: number;
  investor_wallet?: string;
  agent_wallet?: string;
}) {
  let query = supabase.from("token_holdings_cache").select("*");

  if (options?.investor_wallet) {
    query = query.eq("investor_wallet", options.investor_wallet);
  }

  if (options?.agent_wallet) {
    query = query.eq("agent_wallet", options.agent_wallet);
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const result = await query;
  return result;
}

/**
 * Create a new token holding (investment)
 */
export async function createHolding(holding: {
  investor_wallet: string;
  agent_wallet: string;
  token_balance: number;
  total_invested: number;
}) {
  const { data, error } = await supabase
    .from("token_holdings_cache")
    .insert([{ ...holding, last_synced_block: 0 }])
    .select()
    .single();

  if (error) return { data: null, error };
  return { data, error: null };
}

/**
 * Delete a token holding
 */
export async function deleteHolding(id: string) {
  return supabase.from("token_holdings_cache").delete().eq("id", id);
}

// ============================================================================
// SYSTEM ERROR LOGGING
// ============================================================================

/**
 * Log a system error as a `system_error` economy event.
 * Keeps existing console.error/warn — this adds persistent DB visibility.
 */
export async function logSystemError(
  source: 'blockchain' | 'llm' | 'payment' | 'database',
  error: unknown,
  context?: {
    round_number?: number;
    agent_name?: string;
    agent_id?: string;
    detail?: string;
  }
): Promise<void> {
  try {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack?.slice(0, 1000) : undefined;

    await createEvent({
      event_type: 'system_error',
      description: `[${source}] ${context?.agent_name ? context.agent_name + ': ' : ''}${message.slice(0, 200)}`,
      round_number: context?.round_number ?? null,
      metadata: {
        source,
        error_message: message.slice(0, 500),
        stack_trace: stack,
        agent_name: context?.agent_name,
        agent_id: context?.agent_id,
        detail: context?.detail,
      },
    });
  } catch {
    // Last resort: don't let error logging itself throw
  }
}

// ============================================================================
// ECONOMY EVENTS HELPERS
// ============================================================================

/**
 * Fetch all economy events with optional filters
 */
export async function getAllEvents(options?: {
  limit?: number;
  event_type?: string;
}) {
  let query = supabase.from("economy_events").select("*").order("created_at", { ascending: false });

  if (options?.event_type) {
    query = query.eq("event_type", options.event_type);
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  return query;
}

/**
 * Create a new economy event
 */
export async function createEvent(event: {
  event_type: string;
  description: string;
  agent_wallets?: string[];
  investor_wallet?: string | null;
  amount?: number | null;
  tx_hash?: string | null;
  block_number?: number | null;
  round_number?: number | null;
  metadata?: Record<string, unknown>;
}) {
  const { data, error } = await supabase
    .from("economy_events")
    .insert([event])
    .select()
    .single();

  if (error) return { data: null, error };
  return { data, error: null };
}

// ============================================================================
// PARTNERSHIP HELPERS
// ============================================================================

/**
 * Fetch all partnerships with optional filters
 * Returns { data, error } directly
 */
export async function getAllPartnerships(options?: {
  limit?: number;
  status?: string;
}) {
  let query = supabase.from("partnerships_cache").select("*");

  if (options?.status) {
    query = query.eq("status", options.status);
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const result = await query.order("created_at", { ascending: false });
  return result;
}

/**
 * Fetch a single partnership by ID
 */
export async function getPartnershipById(id: string) {
  const { data, error } = await supabase
    .from("partnerships_cache")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return { data: null, error };
  return { data, error: null };
}

/**
 * Create a new partnership
 */
export async function createPartnership(partnership: {
  partner_a_wallet: string;
  partner_b_wallet: string;
  split_a: number;
  split_b: number;
}) {
  const { data, error } = await supabase
    .from("partnerships_cache")
    .insert([{
      ...partnership,
      balance: 0,
      status: "PROPOSED",
      last_synced_block: 0,
    }])
    .select()
    .single();

  if (error) return { data: null, error };
  return { data, error: null };
}

/**
 * Update a partnership
 */
export async function updatePartnership(
  id: string,
  updates: { status?: string; balance?: number }
) {
  const { data, error } = await supabase
    .from("partnerships_cache")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return { data: null, error };
  return { data, error: null };
}

// ============================================================================
// BID HELPERS
// ============================================================================

/**
 * Fetch all bids for a specific task
 * Returns { data, error } directly
 */
export async function getBidsByTaskId(taskId: string, options?: { limit?: number }) {
  let query = supabase
    .from("bids_cache")
    .select("*")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false });

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const result = await query;
  return result;
}

/**
 * Create a new bid
 */
export async function createBid(bid: {
  task_id: string;
  bidder_wallet: string;
  amount: number;
}) {
  const { data, error } = await supabase
    .from("bids_cache")
    .insert([{
      ...bid,
      status: "PENDING",
      last_synced_block: 0,
    }])
    .select()
    .single();

  if (error) return { data: null, error };
  return { data, error: null };
}
