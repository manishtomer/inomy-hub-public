/**
 * Admin Personalities API
 *
 * GET  /api/admin/personalities - List all personalities
 * POST /api/admin/personalities - Create new personality
 *
 * Part of Phase 0: Agent Runtime Admin System
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { CreatePersonalityRequest, Personality } from "@/types/admin";

// Lazy initialization to avoid build-time errors
let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

/**
 * GET /api/admin/personalities
 * List all personalities (active and inactive)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get("active_only") === "true";

    let query = getSupabase()
      .from("personalities")
      .select("*")
      .order("created_at", { ascending: false });

    if (activeOnly) {
      query = query.eq("is_active", true);
    }

    const { data: personalities, error } = await query;

    if (error) {
      console.error(
        "[Admin Personalities API] Error fetching personalities:",
        error
      );
      return NextResponse.json(
        { error: "Failed to fetch personalities" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      personalities: personalities as Personality[],
    });
  } catch (error) {
    console.error("[Admin Personalities API] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/personalities
 * Create a new personality
 */
export async function POST(request: NextRequest) {
  try {
    const body: CreatePersonalityRequest = await request.json();

    // Validate required fields
    if (!body.code || !body.name || !body.default_policy) {
      return NextResponse.json(
        { error: "Missing required fields: code, name, default_policy" },
        { status: 400 }
      );
    }

    // Validate default_policy structure
    const requiredPolicySections = [
      "identity",
      "bidding",
      "partnerships",
      "execution",
      "exceptions",
      "qbr",
    ];
    const missingSections = requiredPolicySections.filter(
      (section) => !(section in body.default_policy)
    );

    if (missingSections.length > 0) {
      return NextResponse.json(
        {
          error: `Missing default_policy sections: ${missingSections.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Check if code already exists
    const { data: existing } = await getSupabase()
      .from("personalities")
      .select("id")
      .eq("code", body.code)
      .single();

    if (existing) {
      return NextResponse.json(
        { error: `Personality with code "${body.code}" already exists` },
        { status: 409 }
      );
    }

    // Insert new personality
    const { data: newPersonality, error: insertError } = await getSupabase()
      .from("personalities")
      .insert({
        code: body.code,
        name: body.name,
        description: body.description || null,
        color: body.color || "#6366f1",
        icon: body.icon || "zap",
        default_policy: body.default_policy,
        behavioral_prompt: body.behavioral_prompt || null,
        is_active: body.is_active !== undefined ? body.is_active : true,
        is_system: false, // User-created personalities are not system
      })
      .select()
      .single();

    if (insertError) {
      console.error(
        "[Admin Personalities API] Error creating personality:",
        insertError
      );
      return NextResponse.json(
        { error: "Failed to create personality" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { data: newPersonality as Personality },
      { status: 201 }
    );
  } catch (error) {
    console.error("[Admin Personalities API] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
