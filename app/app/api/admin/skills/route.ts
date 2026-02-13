/**
 * Admin Skills API
 *
 * GET  /api/admin/skills - List all skills
 * POST /api/admin/skills - Create new skill
 *
 * Part of Phase 0: Agent Runtime Admin System
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { CreateSkillRequest, Skill } from "@/types/admin";

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
 * GET /api/admin/skills
 * List all skills (active and inactive)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get("active_only") === "true";

    let query = getSupabase()
      .from("skills")
      .select("*")
      .order("created_at", { ascending: false });

    if (activeOnly) {
      query = query.eq("is_active", true);
    }

    const { data: skills, error } = await query;

    if (error) {
      console.error("[Admin Skills API] Error fetching skills:", error);
      return NextResponse.json(
        { error: "Failed to fetch skills" },
        { status: 500 }
      );
    }

    return NextResponse.json({ skills: skills as Skill[] });
  } catch (error) {
    console.error("[Admin Skills API] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/skills
 * Create a new skill
 */
export async function POST(request: NextRequest) {
  try {
    const body: CreateSkillRequest = await request.json();

    // Validate required fields
    if (!body.code || !body.name || !body.cost_structure) {
      return NextResponse.json(
        { error: "Missing required fields: code, name, cost_structure" },
        { status: 400 }
      );
    }

    // Validate cost structure
    const requiredCostFields = [
      "llm_inference",
      "data_retrieval",
      "storage",
      "submission",
    ];
    const missingFields = requiredCostFields.filter(
      (field) => !(field in body.cost_structure)
    );

    if (missingFields.length > 0) {
      return NextResponse.json(
        {
          error: `Missing cost_structure fields: ${missingFields.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Check if code already exists
    const { data: existing } = await getSupabase()
      .from("skills")
      .select("id")
      .eq("code", body.code)
      .single();

    if (existing) {
      return NextResponse.json(
        { error: `Skill with code "${body.code}" already exists` },
        { status: 409 }
      );
    }

    // Insert new skill
    const { data: newSkill, error: insertError } = await getSupabase()
      .from("skills")
      .insert({
        code: body.code,
        name: body.name,
        description: body.description || null,
        category: body.category || "general",
        cost_structure: body.cost_structure,
        task_types: body.task_types || [],
        is_active: body.is_active !== undefined ? body.is_active : true,
        is_system: false, // User-created skills are not system skills
      })
      .select()
      .single();

    if (insertError) {
      console.error("[Admin Skills API] Error creating skill:", insertError);
      return NextResponse.json(
        { error: "Failed to create skill" },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: newSkill as Skill }, { status: 201 });
  } catch (error) {
    console.error("[Admin Skills API] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
