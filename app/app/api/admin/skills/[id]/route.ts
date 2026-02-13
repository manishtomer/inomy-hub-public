/**
 * Admin Skills API - Single Skill Operations
 *
 * GET    /api/admin/skills/:id - Get single skill
 * PUT    /api/admin/skills/:id - Update skill
 * DELETE /api/admin/skills/:id - Delete skill (403 if is_system=true)
 *
 * Part of Phase 0: Agent Runtime Admin System
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { UpdateSkillRequest, Skill } from "@/types/admin";

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
 * GET /api/admin/skills/:id
 * Fetch a single skill by ID
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { data: skill, error } = await getSupabase()
      .from("skills")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !skill) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    return NextResponse.json({ data: skill as Skill });
  } catch (error) {
    console.error("[Admin Skills API] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/skills/:id
 * Update an existing skill
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body: UpdateSkillRequest = await request.json();

    // Fetch existing skill to check if it exists
    const { data: existing, error: fetchError } = await getSupabase()
      .from("skills")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    // Validate cost structure if provided
    if (body.cost_structure) {
      const requiredCostFields = [
        "llm_inference",
        "data_retrieval",
        "storage",
        "submission",
      ];
      const missingFields = requiredCostFields.filter(
        (field) => !(field in body.cost_structure!)
      );

      if (missingFields.length > 0) {
        return NextResponse.json(
          {
            error: `Missing cost_structure fields: ${missingFields.join(", ")}`,
          },
          { status: 400 }
        );
      }
    }

    // Build update object
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.category !== undefined) updateData.category = body.category;
    if (body.cost_structure !== undefined)
      updateData.cost_structure = body.cost_structure;
    if (body.task_types !== undefined) updateData.task_types = body.task_types;
    if (body.is_active !== undefined) updateData.is_active = body.is_active;

    // Update skill
    const { data: updatedSkill, error: updateError } = await getSupabase()
      .from("skills")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      console.error("[Admin Skills API] Error updating skill:", updateError);
      return NextResponse.json(
        { error: "Failed to update skill" },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: updatedSkill as Skill });
  } catch (error) {
    console.error("[Admin Skills API] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/skills/:id
 * Delete a skill (only if not a system skill)
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    // Fetch skill to check if it exists and is not system
    const { data: skill, error: fetchError } = await getSupabase()
      .from("skills")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !skill) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    // Prevent deletion of system skills
    if (skill.is_system) {
      return NextResponse.json(
        { error: "System skills cannot be deleted" },
        { status: 403 }
      );
    }

    // Delete skill
    const { error: deleteError } = await getSupabase()
      .from("skills")
      .delete()
      .eq("id", id);

    if (deleteError) {
      console.error("[Admin Skills API] Error deleting skill:", deleteError);
      return NextResponse.json(
        { error: "Failed to delete skill" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Admin Skills API] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
