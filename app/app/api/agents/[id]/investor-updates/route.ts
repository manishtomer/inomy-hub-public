import { NextResponse, NextRequest } from "next/server";
import {
  getInvestorUpdates,
  getInvestorUpdateSummary,
} from "@/lib/agent-runtime/investor-updates";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/agents/:id/investor-updates
 *
 * Returns paginated investor transparency updates for an agent.
 *
 * Query params:
 *   limit    - Number of updates to return (default: 20, max: 100)
 *   offset   - Offset for pagination (default: 0)
 *   type     - Filter by trigger type: "qbr" | "exception" | "novel" | "initial"
 *   summary  - If "true", returns summary counts instead of full updates
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id: agentId } = await params;

  if (!agentId) {
    return NextResponse.json(
      { success: false, error: "Agent ID is required" },
      { status: 400 }
    );
  }

  const { searchParams } = new URL(req.url);

  // Summary mode
  if (searchParams.get("summary") === "true") {
    const summary = await getInvestorUpdateSummary(agentId);
    return NextResponse.json({ success: true, data: summary });
  }

  // Full updates mode
  const limit = Math.min(
    parseInt(searchParams.get("limit") || "20", 10),
    100
  );
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const triggerType = searchParams.get("type") as
    | "qbr"
    | "exception"
    | "novel"
    | "initial"
    | null;

  const updates = await getInvestorUpdates(agentId, {
    limit,
    offset,
    trigger_type: triggerType || undefined,
  });

  return NextResponse.json({
    success: true,
    data: updates,
    count: updates.length,
    pagination: { limit, offset },
  });
}
