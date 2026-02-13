/**
 * Admin Personalities API - Single Personality Operations
 *
 * GET    /api/admin/personalities/:id - Get single personality
 * PUT    /api/admin/personalities/:id - Update personality
 * DELETE /api/admin/personalities/:id - Delete personality (403 if is_system=true)
 *
 * Part of Phase 0: Agent Runtime Admin System
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { UpdatePersonalityRequest, Personality } from "@/types/admin";

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
 * GET /api/admin/personalities/:id
 * Fetch a single personality by ID
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { data: personality, error } = await getSupabase()
      .from("personalities")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !personality) {
      return NextResponse.json(
        { error: "Personality not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: personality as Personality });
  } catch (error) {
    console.error("[Admin Personalities API] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/personalities/:id
 * Update an existing personality
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body: UpdatePersonalityRequest = await request.json();

    // Fetch existing personality to check if it exists
    const { data: existing, error: fetchError } = await getSupabase()
      .from("personalities")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json(
        { error: "Personality not found" },
        { status: 404 }
      );
    }

    // Build update object
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.color !== undefined) updateData.color = body.color;
    if (body.icon !== undefined) updateData.icon = body.icon;
    if (body.default_policy !== undefined)
      updateData.default_policy = body.default_policy;
    if (body.behavioral_prompt !== undefined)
      updateData.behavioral_prompt = body.behavioral_prompt;
    if (body.is_active !== undefined) updateData.is_active = body.is_active;

    // Update personality
    const { data: updatedPersonality, error: updateError } = await getSupabase()
      .from("personalities")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      console.error(
        "[Admin Personalities API] Error updating personality:",
        updateError
      );
      return NextResponse.json(
        { error: "Failed to update personality" },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: updatedPersonality as Personality });
  } catch (error) {
    console.error("[Admin Personalities API] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/personalities/:id
 * Delete a personality (only if not a system personality)
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    // Fetch personality to check if it exists and is not system
    const { data: personality, error: fetchError } = await getSupabase()
      .from("personalities")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !personality) {
      return NextResponse.json(
        { error: "Personality not found" },
        { status: 404 }
      );
    }

    // Prevent deletion of system personalities
    if (personality.is_system) {
      return NextResponse.json(
        { error: "System personalities cannot be deleted" },
        { status: 403 }
      );
    }

    // Delete personality
    const { error: deleteError } = await getSupabase()
      .from("personalities")
      .delete()
      .eq("id", id);

    if (deleteError) {
      console.error(
        "[Admin Personalities API] Error deleting personality:",
        deleteError
      );
      return NextResponse.json(
        { error: "Failed to delete personality" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Admin Personalities API] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
