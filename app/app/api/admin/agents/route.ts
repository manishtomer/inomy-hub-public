import { NextResponse, NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { AgentType, AgentStatus } from "@/types/database";

/**
 * POST /api/admin/agents
 *
 * Quick agent creation for demo/testing purposes.
 * Creates agents directly in the database with simulated balances.
 * No blockchain registration or Privy wallet needed.
 *
 * Body:
 *   name: string (required)
 *   type: "CATALOG" | "REVIEW" | "CURATION" | "SELLER" (required)
 *   personality?: string (stored in metadata for runtime init)
 *   balance?: number (default: 1.0)
 *   reputation?: number (default: 500)
 *   count?: number (create multiple agents with auto-generated names, max 10)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Batch creation mode
    if (body.count && body.count > 1) {
      return createBatch(body);
    }

    // Single agent creation
    if (!body.name || !body.type) {
      return NextResponse.json(
        { success: false, error: "Name and type are required" },
        { status: 400 }
      );
    }

    const agent = await createDemoAgent(body);
    if (!agent) {
      return NextResponse.json(
        { success: false, error: "Failed to create agent" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: agent }, { status: 201 });
  } catch (err) {
    console.error("[Admin Agents] Error:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

/** Agent name prefixes by personality */
const PERSONALITY_NAMES: Record<string, string[]> = {
  "risk-taker": ["Maverick", "Blaze", "Daring", "Rogue", "Ace"],
  conservative: ["Sentinel", "Guardian", "Anchor", "Shield", "Bastion"],
  "profit-maximizer": ["Apex", "Summit", "Pinnacle", "Zenith", "Prime"],
  "volume-chaser": ["Surge", "Torrent", "Cascade", "Avalanche", "Rush"],
  opportunist: ["Phantom", "Shadow", "Swift", "Viper", "Raptor"],
  "partnership-oriented": ["Nexus", "Bridge", "Unity", "Alliance", "Synergy"],
};

const ALL_PERSONALITIES = [
  "risk-taker",
  "conservative",
  "profit-maximizer",
  "volume-chaser",
  "opportunist",
  "partnership-oriented",
];

const AGENT_TYPES = [
  AgentType.CATALOG,
  AgentType.REVIEW,
  AgentType.CURATION,
];

function generateAgentName(type: string, personality: string, index: number): string {
  const names = PERSONALITY_NAMES[personality] || PERSONALITY_NAMES["opportunist"];
  const name = names[index % names.length];
  const suffix = Math.floor(Math.random() * 100);
  return `${name}-${type.toLowerCase()}-${suffix}`;
}

async function createDemoAgent(body: {
  name: string;
  type: string;
  personality?: string;
  balance?: number;
  reputation?: number;
}): Promise<Record<string, unknown> | null> {
  const personality = body.personality || "conservative";
  const balance = body.balance ?? 1.0;
  const reputation = body.reputation ?? 500;

  const { data, error } = await supabase
    .from("agents")
    .insert({
      name: body.name,
      type: body.type,
      status: AgentStatus.ACTIVE,
      balance,
      reputation,
      token_price: 0.001,
      total_revenue: 0,
      investor_share_bps: 7500,
      tasks_completed: 0,
      tasks_failed: 0,
      last_synced_block: 0,
      // Store personality in wallet_address field temporarily for runtime init
      // (demo agents don't have real wallets)
      metadata_uri: JSON.stringify({ personality, demo: true }),
    })
    .select("*")
    .single();

  if (error) {
    console.error("[Admin Agents] DB error:", error.message);
    return null;
  }

  // Also create initial policy if needed
  if (data) {
    await supabase.from("agent_policies").upsert(
      {
        agent_id: data.id,
        personality,
        policy_version: 0,
        policy_json: JSON.stringify({ pending_init: true }),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "agent_id" }
    );
  }

  return data;
}

async function createBatch(body: {
  type?: string;
  personality?: string;
  balance?: number;
  reputation?: number;
  count: number;
}): Promise<NextResponse> {
  const count = Math.min(Math.max(body.count, 2), 10);
  const agents: Record<string, unknown>[] = [];

  for (let i = 0; i < count; i++) {
    const type = body.type || AGENT_TYPES[i % AGENT_TYPES.length];
    const personality = body.personality || ALL_PERSONALITIES[i % ALL_PERSONALITIES.length];
    const name = generateAgentName(String(type), personality, i);

    const agent = await createDemoAgent({
      name,
      type: String(type),
      personality,
      balance: body.balance,
      reputation: body.reputation,
    });

    if (agent) agents.push(agent);
  }

  return NextResponse.json(
    {
      success: true,
      data: agents,
      count: agents.length,
    },
    { status: 201 }
  );
}
