/**
 * Agent Self-Update API
 *
 * Allows an agent to modify its own settings using its wallet.
 * Only the agent's wallet (wallet_address) can call this endpoint.
 *
 * PUT /api/agents/[id]/self-update
 *
 * Headers:
 *   X-Agent-Signature: EIP-712 signature proving wallet ownership
 *
 * Body:
 *   personality?: "conservative" | "balanced" | "aggressive" | "opportunistic"
 *   description?: string
 *   type?: "CATALOG" | "REVIEW" | "CURATION" | "SELLER"
 *   investor_share_bps?: number (5000-9500)
 *
 * Note: name and token_symbol cannot be changed after creation.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyMessage } from "viem";
import type { AgentPersonality } from "@/types/database";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface SelfUpdateRequest {
  personality?: AgentPersonality;
  description?: string;
  type?: "CATALOG" | "REVIEW" | "CURATION" | "SELLER";
  investor_share_bps?: number;
  // Signature fields
  signature: string;
  message: string;
  timestamp: number;
}

const VALID_PERSONALITIES: AgentPersonality[] = [
  "conservative",
  "balanced",
  "aggressive",
  "opportunistic",
];

const VALID_TYPES = ["CATALOG", "REVIEW", "CURATION", "SELLER"] as const;

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: agentId } = await params;

  try {
    const body = (await request.json()) as SelfUpdateRequest;

    // Validate signature is present
    if (!body.signature || !body.message || !body.timestamp) {
      return NextResponse.json(
        { success: false, error: "Missing signature, message, or timestamp" },
        { status: 400 }
      );
    }

    // Check timestamp is recent (within 5 minutes)
    const now = Date.now();
    if (Math.abs(now - body.timestamp) > 5 * 60 * 1000) {
      return NextResponse.json(
        { success: false, error: "Signature timestamp expired" },
        { status: 400 }
      );
    }

    // Initialize Supabase
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Fetch agent to verify wallet
    const { data: agent, error: fetchError } = await supabase
      .from("agents")
      .select("id, name, wallet_address, personality, type, investor_share_bps, metadata_uri")
      .eq("id", agentId)
      .single();

    if (fetchError || !agent) {
      return NextResponse.json(
        { success: false, error: "Agent not found" },
        { status: 404 }
      );
    }

    if (!agent.wallet_address) {
      return NextResponse.json(
        { success: false, error: "Agent has no wallet configured" },
        { status: 400 }
      );
    }

    // Verify the signature is from the agent's wallet
    const expectedMessage = `Inomy Agent Self-Update\nAgent: ${agentId}\nTimestamp: ${body.timestamp}`;
    if (body.message !== expectedMessage) {
      return NextResponse.json(
        { success: false, error: "Invalid message format" },
        { status: 400 }
      );
    }

    let isValid = false;
    try {
      isValid = await verifyMessage({
        address: agent.wallet_address as `0x${string}`,
        message: body.message,
        signature: body.signature as `0x${string}`,
      });
    } catch {
      isValid = false;
    }

    if (!isValid) {
      return NextResponse.json(
        { success: false, error: "Invalid signature - only the agent's wallet can update itself" },
        { status: 403 }
      );
    }

    // Build update object
    const updates: Record<string, unknown> = {};

    // Validate and set personality
    if (body.personality !== undefined) {
      if (!VALID_PERSONALITIES.includes(body.personality)) {
        return NextResponse.json(
          { success: false, error: `Invalid personality. Valid values: ${VALID_PERSONALITIES.join(", ")}` },
          { status: 400 }
        );
      }
      updates.personality = body.personality;
    }

    // Validate and set type
    if (body.type !== undefined) {
      if (!(VALID_TYPES as readonly string[]).includes(body.type)) {
        return NextResponse.json(
          { success: false, error: `Invalid type. Valid values: ${VALID_TYPES.join(", ")}` },
          { status: 400 }
        );
      }
      updates.type = body.type;
    }

    // Validate and set investor_share_bps
    if (body.investor_share_bps !== undefined) {
      if (body.investor_share_bps < 5000 || body.investor_share_bps > 9500) {
        return NextResponse.json(
          { success: false, error: "investor_share_bps must be between 5000 (50%) and 9500 (95%)" },
          { status: 400 }
        );
      }
      updates.investor_share_bps = body.investor_share_bps;
    }

    // Set description in metadata
    if (body.description !== undefined) {
      // Parse existing metadata and update description
      let metadata: Record<string, unknown> = {};
      try {
        if (agent.metadata_uri?.startsWith("data:application/json,")) {
          const jsonStr = decodeURIComponent(agent.metadata_uri.replace("data:application/json,", ""));
          metadata = JSON.parse(jsonStr);
        }
      } catch {
        // Ignore parse errors, start fresh
      }

      metadata.description = body.description;
      metadata.updatedAt = new Date().toISOString();
      metadata.updatedBy = "agent_self_update";

      updates.metadata_uri = `data:application/json,${encodeURIComponent(JSON.stringify(metadata))}`;
    }

    // Check if there are any updates
    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { success: false, error: "No valid fields to update" },
        { status: 400 }
      );
    }

    // Apply updates
    updates.updated_at = new Date().toISOString();

    const { data: updatedAgent, error: updateError } = await supabase
      .from("agents")
      .update(updates)
      .eq("id", agentId)
      .select()
      .single();

    if (updateError) {
      console.error("[Agent Self-Update] Update error:", updateError);
      return NextResponse.json(
        { success: false, error: "Failed to update agent" },
        { status: 500 }
      );
    }

    console.log(`[Agent Self-Update] ${agent.name} updated:`, Object.keys(updates));

    return NextResponse.json({
      success: true,
      data: updatedAgent,
      updated_fields: Object.keys(updates).filter((k) => k !== "updated_at"),
    });
  } catch (err) {
    console.error("[Agent Self-Update] Error:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
