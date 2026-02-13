import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * GET /api/agents/[id]/policy-impact
 *
 * Returns policy changes with their subsequent bid outcomes.
 * Combines BOTH exception-triggered AND QBR-triggered policy changes.
 * Shows cause-effect: policy change → bids using that policy → won/lost
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: agentId } = await params;
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "15");

    // Fetch exception history, QBR history, and bids in parallel
    const [excResult, qbrResult, bidsResult] = await Promise.all([
      supabase
        .from("exception_history")
        .select("id, exception_type, brain_response, created_at")
        .eq("agent_id", agentId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("qbr_history")
        .select("id, qbr_number, decisions, period, created_at")
        .eq("agent_id", agentId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("bids_cache")
        .select("id, amount, status, created_at, policy_used")
        .eq("agent_id", agentId)
        .order("created_at", { ascending: true }),
    ]);

    if (excResult.error) {
      console.error("Error fetching exceptions:", excResult.error);
    }
    if (qbrResult.error) {
      console.error("Error fetching QBR history:", qbrResult.error);
    }
    if (bidsResult.error) {
      console.error("Error fetching bids:", bidsResult.error);
      return NextResponse.json(
        { success: false, error: bidsResult.error.message },
        { status: 500 }
      );
    }

    const allBids = bidsResult.data || [];

    // Normalize both sources into a unified list of policy change events
    interface PolicyChangeEvent {
      id: string;
      source: "exception" | "qbr";
      exception_type: string;
      reasoning: string | null;
      policy_changes: Record<string, unknown>;
      created_at: string;
    }

    const changeEvents: PolicyChangeEvent[] = [];

    // Add exception-triggered changes
    for (const exc of excResult.data || []) {
      const brainResponse = exc.brain_response || {};
      const policyChanges = brainResponse.policy_changes || {};
      changeEvents.push({
        id: exc.id,
        source: "exception",
        exception_type: exc.exception_type,
        reasoning: brainResponse.reasoning || null,
        policy_changes: policyChanges,
        created_at: exc.created_at,
      });
    }

    // Add QBR-triggered changes
    for (const qbr of qbrResult.data || []) {
      const decisions = qbr.decisions || {};
      const policyChanges = decisions.policy_changes || {};
      changeEvents.push({
        id: qbr.id,
        source: "qbr",
        exception_type: `qbr_#${qbr.qbr_number}`,
        reasoning: decisions.reasoning || null,
        policy_changes: policyChanges,
        created_at: qbr.created_at,
      });
    }

    // Sort by time descending (most recent first)
    changeEvents.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    // For each policy change event, find subsequent bids until the next change
    const policyImpacts = [];

    for (let i = 0; i < changeEvents.length && policyImpacts.length < limit; i++) {
      const event = changeEvents[i];
      const eventTime = new Date(event.created_at).getTime();

      // Next event (earlier in array = later in time, but we're sorted desc)
      const nextEvent = i > 0 ? changeEvents[i - 1] : null;
      const nextEventTime = nextEvent
        ? new Date(nextEvent.created_at).getTime()
        : Date.now();

      // Find bids between this event and the next one
      const subsequentBids = allBids.filter((bid) => {
        const bidTime = new Date(bid.created_at).getTime();
        return bidTime > eventTime && bidTime <= nextEventTime;
      });

      // Calculate stats
      const wonBids = subsequentBids.filter((b) => b.status === "WON");
      const lostBids = subsequentBids.filter((b) => b.status === "LOST");
      const totalBids = subsequentBids.length;
      const winRate = totalBids > 0 ? wonBids.length / totalBids : null;

      // Include if there were policy changes or bids after
      if (
        Object.keys(event.policy_changes).length > 0 ||
        totalBids > 0
      ) {
        policyImpacts.push({
          id: event.id,
          source: event.source,
          exception_type: event.exception_type,
          created_at: event.created_at,
          reasoning: event.reasoning,
          policy_changes: event.policy_changes,
          subsequent_bids: subsequentBids.slice(0, 5).map((b) => ({
            id: b.id,
            amount: b.amount,
            status: b.status,
            created_at: b.created_at,
            policy_used: b.policy_used || null,
          })),
          stats: {
            total_bids: totalBids,
            won: wonBids.length,
            lost: lostBids.length,
            win_rate: winRate,
            avg_bid:
              totalBids > 0
                ? subsequentBids.reduce((sum, b) => sum + b.amount, 0) /
                  totalBids
                : null,
          },
          impact:
            totalBids === 0
              ? "no_data"
              : winRate !== null && winRate > 0.5
                ? "positive"
                : winRate !== null && winRate < 0.3
                  ? "negative"
                  : "neutral",
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        policy_impacts: policyImpacts,
        total_exceptions: (excResult.data || []).length,
        total_qbrs: (qbrResult.data || []).length,
        total_bids: allBids.length,
      },
    });
  } catch (error) {
    console.error("Error in policy-impact API:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
