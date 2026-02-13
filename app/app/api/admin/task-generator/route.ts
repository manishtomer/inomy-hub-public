import { NextResponse, NextRequest } from "next/server";
import {
  SteadyStateGenerator,
  MarketWavesGenerator,
  type ScenarioType,
} from "@/lib/task-generators";
import { supabase } from "@/lib/supabase";

/**
 * POST /api/admin/task-generator
 *
 * Trigger task generation. Supports burst mode (generate N tasks immediately)
 * and all three generator modes.
 *
 * Body:
 *   mode: "steady" | "waves" | "scenario" (default: "steady")
 *   count: number (tasks to generate, default: 5)
 *   scenario?: ScenarioType (for scenario mode, default: "mixed")
 *   price_range?: [number, number] (multiplier range, default: [1.2, 2.5])
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const mode = body.mode || "steady";
    const count = Math.min(Math.max(body.count || 5, 1), 50); // Clamp 1-50
    const scenario: ScenarioType = body.scenario || "mixed";
    const priceRange: [number, number] = body.price_range || [1.2, 2.5];

    let tasksCreated = 0;

    switch (mode) {
      case "steady": {
        const gen = new SteadyStateGenerator({
          tasks_per_round: count,
          price_range: priceRange,
        });
        await gen.generateRound();
        tasksCreated = count;
        break;
      }

      case "waves": {
        const gen = new MarketWavesGenerator({
          base_tasks: Math.max(1, Math.floor(count * 0.4)),
          peak_tasks: count,
        });
        await gen.generateRound();
        tasksCreated = count;
        break;
      }

      case "scenario": {
        // ScenarioGenerator needs internal state for generateRound, so we use burst via SteadyState
        // with scenario-like price ranges
        const scenarioPrices: Record<string, [number, number]> = {
          bull_market: [1.5, 3.0],
          bear_market: [0.9, 1.3],
          catalog_shortage: [1.2, 2.0],
          review_boom: [1.3, 2.5],
          race_to_bottom: [0.95, 1.15],
          gold_rush: [4.0, 8.0],
          mixed: [1.2, 2.5],
        };
        const steadyGen = new SteadyStateGenerator({
          tasks_per_round: count,
          price_range: scenarioPrices[scenario] || [1.2, 2.5],
        });
        await steadyGen.generateRound();
        tasksCreated = count;
        break;
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown mode: ${mode}` },
          { status: 400 }
        );
    }

    return NextResponse.json({
      success: true,
      data: {
        mode,
        tasks_created: tasksCreated,
        scenario: mode === "scenario" ? scenario : undefined,
        price_range: priceRange,
      },
    });
  } catch (err) {
    console.error("[Admin TaskGen] Error:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/task-generator
 *
 * Returns task statistics - counts by status and type.
 */
export async function GET() {
  try {
    // Get task counts by status
    const { data: tasks, error } = await supabase
      .from("tasks")
      .select("id, type, status, max_bid, created_at")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    const allTasks = tasks || [];

    // Aggregate stats
    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};
    let totalValue = 0;

    for (const t of allTasks) {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      byType[t.type] = (byType[t.type] || 0) + 1;
      totalValue += t.max_bid || 0;
    }

    return NextResponse.json({
      success: true,
      data: {
        total_tasks: allTasks.length,
        by_status: byStatus,
        by_type: byType,
        total_value: Math.round(totalValue * 1000) / 1000,
        recent_tasks: allTasks.slice(0, 10).map((t) => ({
          id: t.id,
          type: t.type,
          status: t.status,
          max_bid: t.max_bid,
          created_at: t.created_at,
        })),
      },
    });
  } catch (err) {
    console.error("[Admin TaskGen] Stats error:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
