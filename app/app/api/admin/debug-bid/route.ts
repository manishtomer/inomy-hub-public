/**
 * Debug endpoint: test bidding + DB insert
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { agentService, biddingService, taskService, auctionService, TaskService } from '@/lib/services';

export async function GET() {
  const agents = await agentService.getActiveAgents();
  const taskInputs = TaskService.generateRandomTaskInputs(2);

  // Create REAL tasks in DB
  const tasks = await taskService.createBatchTasks(taskInputs);

  // Generate bids
  const { bids, skipped } = biddingService.generateBidsForRound(tasks, agents);

  // Try to submit bids to DB
  let submitResult: any = null;
  let submitError: any = null;
  if (bids.length > 0) {
    try {
      const submitted = await auctionService.submitBatchBids(bids);
      submitResult = { count: submitted.length, first: submitted[0] || null };
    } catch (err) {
      submitError = String(err);
    }
  }

  // Also try direct insert to see the raw error
  let rawInsertError: any = null;
  if (bids.length > 0) {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data, error } = await supabase
      .from('bids_cache')
      .insert({
        task_id: tasks[0].id,
        agent_id: bids[0].agentId,
        bidder_wallet: bids[0].bidderWallet,
        amount: bids[0].amount,
        score: bids[0].score,
        status: 'PENDING',
        created_at: new Date().toISOString(),
      })
      .select()
      .single();
    rawInsertError = error ? JSON.parse(JSON.stringify(error)) : null;
    if (data) submitResult = { ...submitResult, raw_insert: data };
  }

  return NextResponse.json({
    agents: agents.length,
    tasks: tasks.map(t => ({ id: t.id, type: t.type })),
    bids_generated: bids.length,
    skipped: skipped.length,
    submit_result: submitResult,
    submit_error: submitError,
    raw_insert_error: rawInsertError,
    first_bid_input: bids[0] || null,
  });
}
