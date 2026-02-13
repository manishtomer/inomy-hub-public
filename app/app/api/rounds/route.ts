import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/rounds
 * Returns recent rounds with full auction matrix data (tasks, bids, winners).
 * Query params:
 *   - limit: max number of rounds to return (default 20)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '20');

    // 1. Fetch distinct round numbers (most recent first)
    const { data: roundRows, error: roundError } = await supabase
      .from('tasks')
      .select('round_number')
      .not('round_number', 'is', null)
      .order('round_number', { ascending: false });

    if (roundError) {
      return NextResponse.json(
        { success: false, error: `Failed to fetch rounds: ${roundError.message}` },
        { status: 500 }
      );
    }

    // Deduplicate round numbers and limit
    const uniqueRounds = [...new Set((roundRows || []).map(r => r.round_number as number))].slice(0, limit);

    if (uniqueRounds.length === 0) {
      return NextResponse.json({ success: true, rounds: [], source: 'database' });
    }

    // 2. Fetch all tasks for these rounds
    const { data: tasks, error: tasksError } = await supabase
      .from('tasks')
      .select('*')
      .in('round_number', uniqueRounds)
      .order('round_number', { ascending: false });

    if (tasksError) {
      return NextResponse.json(
        { success: false, error: `Failed to fetch tasks: ${tasksError.message}` },
        { status: 500 }
      );
    }

    const taskIds = (tasks || []).map(t => t.id);

    // 3. Fetch all bids for these tasks + all active agents (in parallel)
    const [bidsResult, agentsResult] = await Promise.all([
      taskIds.length > 0
        ? supabase.from('bids_cache').select('*').in('task_id', taskIds)
        : Promise.resolve({ data: [], error: null }),
      supabase.from('agents').select('id, name, type, status').eq('status', 'ACTIVE'),
    ]);

    if (bidsResult.error) {
      return NextResponse.json(
        { success: false, error: `Failed to fetch bids: ${bidsResult.error.message}` },
        { status: 500 }
      );
    }

    const bids = bidsResult.data || [];
    const agents = agentsResult.data || [];
    const agentMap = new Map(agents.map(a => [a.id, a]));

    // 4. Group by round
    const roundMap = new Map<number, typeof tasks>();
    for (const task of (tasks || [])) {
      const rn = task.round_number as number;
      if (!roundMap.has(rn)) roundMap.set(rn, []);
      roundMap.get(rn)!.push(task);
    }

    // Build bid lookup: taskId -> bids[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bidsByTask = new Map<string, any[]>();
    for (const bid of bids) {
      if (!bidsByTask.has(bid.task_id)) bidsByTask.set(bid.task_id, []);
      bidsByTask.get(bid.task_id)!.push(bid);
    }

    // 5. Build response
    const rounds = uniqueRounds.map(roundNumber => {
      const roundTasks = roundMap.get(roundNumber) || [];
      let totalBids = 0;
      let tasksCompleted = 0;
      let revenue = 0;

      const taskResults = roundTasks.map(task => {
        const taskBids = bidsByTask.get(task.id) || [];
        totalBids += taskBids.length;

        if (task.status === 'COMPLETED') {
          tasksCompleted++;
        }

        // Find winning bid
        const winningBid = taskBids.find(b => b.status === 'won');
        if (winningBid) {
          revenue += winningBid.amount || 0;
        }

        // Build bid list (including agents who didn't bid as "skipped")
        const biddingAgentIds = new Set(taskBids.map(b => b.agent_id));
        const bidList = [
          ...taskBids.map(b => ({
            agent_id: b.agent_id,
            agent_name: agentMap.get(b.agent_id)?.name || b.agent_id,
            agent_type: agentMap.get(b.agent_id)?.type || null,
            amount: b.amount,
            score: b.score,
            status: b.status as string,
          })),
          ...agents
            .filter(a => !biddingAgentIds.has(a.id))
            .map(a => ({
              agent_id: a.id,
              agent_name: a.name,
              agent_type: a.type,
              amount: null as number | null,
              score: null as number | null,
              status: 'skipped',
            })),
        ].sort((a, b) => {
          // Winners first, then by amount desc, skipped last
          if (a.status === 'won') return -1;
          if (b.status === 'won') return 1;
          if (a.status === 'skipped') return 1;
          if (b.status === 'skipped') return -1;
          return (b.amount || 0) - (a.amount || 0);
        });

        const winner = winningBid
          ? {
              agent_name: agentMap.get(winningBid.agent_id)?.name || winningBid.agent_id,
              amount: winningBid.amount,
            }
          : null;

        return {
          id: task.id,
          type: task.type,
          status: task.status,
          input_ref: task.input_ref,
          bids: bidList,
          winner,
        };
      });

      return {
        round_number: roundNumber,
        tasks: taskResults,
        summary: {
          total_tasks: roundTasks.length,
          total_bids: totalBids,
          tasks_completed: tasksCompleted,
          revenue: Math.round(revenue * 10000) / 10000,
        },
      };
    });

    return NextResponse.json({ success: true, rounds, source: 'database' });
  } catch (err) {
    console.error('[/api/rounds] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
