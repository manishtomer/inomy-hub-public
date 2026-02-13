/**
 * POST /api/admin/market-reset
 *
 * Reset the marketplace to break price stalemates.
 * Resets policies, reputations, brain cooldowns, and optionally balances.
 *
 * Body: {
 *   reset_policies: boolean,    // Reset to personality defaults
 *   reset_reputations: boolean, // Randomize 3.2-4.8
 *   reset_brain_cooldown: boolean, // Allow immediate brain wakeup
 *   reset_balances: boolean,    // Equalize DB balances (no on-chain transfer)
 *   balance_amount?: number,    // Target balance (default 1.0)
 * }
 */

import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { createEvent } from '@/lib/api-helpers';
import { PERSONALITY_DEFAULTS } from '@/lib/agent-runtime/constants';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      reset_policies = true,
      reset_reputations = true,
      reset_brain_cooldown = true,
      reset_balances = false,
      balance_amount = 1.0,
    } = body;

    // Fetch all active agents
    const { data: agents, error: fetchError } = await supabase
      .from('agents')
      .select('id, name, type, status, balance, reputation, personality')
      .in('status', ['ACTIVE', 'LOW_FUNDS']);

    if (fetchError || !agents || agents.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No active agents found' },
        { status: 400 }
      );
    }

    const results: Record<string, unknown> = {
      agents_affected: agents.length,
      resets_applied: [],
    };
    const resetsApplied: string[] = [];

    // 1. Reset policies to personality defaults
    if (reset_policies) {
      let policiesReset = 0;

      for (const agent of agents) {
        const personality = agent.personality || 'balanced';
        const defaults = PERSONALITY_DEFAULTS[personality] || PERSONALITY_DEFAULTS.balanced;

        const { error } = await supabase
          .from('agent_policies')
          .update({
            policy_json: defaults,
            policy_version: 1,
            updated_at: new Date().toISOString(),
          })
          .eq('agent_id', agent.id);

        if (!error) policiesReset++;
      }

      results.policies_reset = policiesReset;
      resetsApplied.push(`policies (${policiesReset} agents)`);
      console.log(`[MarketReset] Reset ${policiesReset} agent policies to personality defaults`);
    }

    // 2. Randomize reputations (3.2 - 4.8)
    if (reset_reputations) {
      let repsReset = 0;

      for (const agent of agents) {
        const newRep = Math.round((3.2 + Math.random() * 1.6) * 1000) / 1000;
        const { error } = await supabase
          .from('agents')
          .update({ reputation: newRep })
          .eq('id', agent.id);

        if (!error) {
          repsReset++;
        }
      }

      results.reputations_reset = repsReset;
      resetsApplied.push(`reputations (${repsReset} agents → random 3.2-4.8)`);
      console.log(`[MarketReset] Randomized ${repsReset} agent reputations`);
    }

    // 3. Reset brain cooldowns
    if (reset_brain_cooldown) {
      const { data: updated } = await supabase
        .from('agent_runtime_state')
        .update({
          last_brain_wakeup_round: 0,
          last_policy_change_round: 0,
          consecutive_losses: 0,
          consecutive_wins: 0,
        })
        .in('agent_id', agents.map(a => a.id))
        .select('id');

      const count = updated?.length || 0;
      results.brain_cooldowns_reset = count;
      resetsApplied.push(`brain cooldowns (${count} agents)`);
      console.log(`[MarketReset] Reset ${count} agent brain cooldowns`);
    }

    // 4. Equalize balances (DB only — for on-chain, use seed-agents-usdc.ts)
    if (reset_balances) {
      let balancesReset = 0;

      for (const agent of agents) {
        const { error } = await supabase
          .from('agents')
          .update({
            balance: balance_amount,
            status: 'ACTIVE',
          })
          .eq('id', agent.id);

        if (!error) balancesReset++;
      }

      results.balances_reset = balancesReset;
      results.balance_amount = balance_amount;
      resetsApplied.push(`balances (${balancesReset} agents → $${balance_amount})`);
      console.log(`[MarketReset] Set ${balancesReset} agent balances to $${balance_amount}`);
    }

    results.resets_applied = resetsApplied;

    // Log the reset event
    await createEvent({
      event_type: 'round_started',
      description: `Market Reset: ${resetsApplied.join(', ')}`,
      metadata: {
        type: 'market_reset',
        ...results,
      },
    });

    console.log(`[MarketReset] Complete: ${resetsApplied.join(', ')}`);

    return NextResponse.json({ success: true, data: results });
  } catch (error) {
    console.error('[MarketReset] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
