/**
 * BrainService - Brain wake-up orchestration
 *
 * Handles exception detection and brain wake-ups.
 * Uses 4 exception checks from autopilot (consecutive_losses, low_balance,
 * reputation_drop, win_rate_drop) and supports useLLM flag.
 */

import { supabase } from '@/lib/supabase';
import { createEvent, logSystemError } from '@/lib/api-helpers';
import { createPersonalMemory } from '@/lib/agent-runtime/personal-memory';
import { checkExceptions, isQBRDue } from '@/lib/agent-runtime/autopilot';
import { PERSONALITY_DEFAULTS } from '@/lib/agent-runtime/constants';
import { loadRuntimeState, saveRuntimeState, recordBrainWakeup } from '@/lib/agent-runtime/state';
import { economyService } from '../economy/EconomyService';
import type { MemoryContext } from '@/lib/agent-runtime/memory-types';
import type { AgentPolicy } from '@/lib/agent-runtime/types';
import type {
  AgentWithPolicy,
  ExceptionTrigger,
  BrainWakeupResult,
} from '../types';

/** Minimum rounds between brain wakeups for the same agent */
const BRAIN_COOLDOWN_ROUNDS = 3;

export class BrainService {
  /**
   * Check all agents for exceptions and trigger brain wake-ups.
   * Uses all 4 checks from autopilot: consecutive_losses, low_balance,
   * reputation_drop, win_rate_drop.
   */
  /**
   * Detect which agents have exceptions (fast — DB reads only, no LLM).
   * Returns the list of agents needing wakeup, capped at maxBrainCalls.
   */
  async detectExceptions(
    agents: AgentWithPolicy[],
    roundNum: number,
    maxBrainCalls = 3
  ): Promise<Array<{ agent: AgentWithPolicy; exception: ExceptionTrigger }>> {
    // Load runtime states for all agents (needed for 4-check exception detection)
    const statePromises = agents.map(agent =>
      supabase.from('agent_runtime_state').select('*').eq('agent_id', agent.id).single()
    );
    const stateResults = await Promise.all(statePromises);

    const agentsNeedingWakeup: Array<{
      agent: AgentWithPolicy;
      exception: ExceptionTrigger;
    }> = [];

    agents.forEach((agent, index) => {
      const stateData = stateResults[index].data;
      if (!stateData) return;

      // Cooldown: skip agent if brain woke up recently (within BRAIN_COOLDOWN_ROUNDS)
      const lastWakeup = stateData.last_brain_wakeup_round ?? 0;
      const roundsSinceWakeup = roundNum - lastWakeup;
      if (roundsSinceWakeup > 0 && roundsSinceWakeup < BRAIN_COOLDOWN_ROUNDS) {
        console.log(`[BrainService] Skipping ${agent.name}: brain cooldown (${roundsSinceWakeup}/${BRAIN_COOLDOWN_ROUNDS} rounds since last wakeup)`);
        return;
      }

      // Use autopilot checkExceptions for all 4 checks
      const policy = agent.policy || PERSONALITY_DEFAULTS[agent.personality] || PERSONALITY_DEFAULTS.balanced;
      const trigger = checkExceptions(stateData, policy as AgentPolicy, agent.balance, agent.reputation);

      if (trigger) {
        agentsNeedingWakeup.push({
          agent,
          exception: {
            type: trigger.type as ExceptionTrigger['type'],
            details: { message: trigger.details, current_value: trigger.current_value },
            threshold: trigger.threshold,
            currentValue: trigger.current_value,
          },
        });
      }
    });

    return agentsNeedingWakeup.slice(0, maxBrainCalls);
  }

  /**
   * Execute brain wake-ups for already-detected exceptions.
   * This is the slow part (LLM calls). Can be fire-and-forget.
   */
  async executeWakeups(
    agentsNeedingWakeup: Array<{ agent: AgentWithPolicy; exception: ExceptionTrigger }>,
    roundNum: number,
    useLLM: boolean
  ): Promise<BrainWakeupResult[]> {
    if (!useLLM) {
      return this.applyDefaultExceptionResponses(agentsNeedingWakeup, roundNum);
    }

    const wakeupPromises = agentsNeedingWakeup.map(({ agent, exception }) =>
      this.wakeForException(agent, exception, roundNum)
    );

    const results = await Promise.allSettled(wakeupPromises);

    return results
      .filter((r): r is PromiseFulfilledResult<BrainWakeupResult | null> =>
        r.status === 'fulfilled' && r.value !== null
      )
      .map(r => r.value!);
  }

  /**
   * Check all agents for exceptions and trigger brain wake-ups.
   * Convenience method that combines detectExceptions + executeWakeups.
   */
  async checkAndTriggerExceptions(
    agents: AgentWithPolicy[],
    roundNum: number,
    options?: { maxBrainCalls?: number; useLLM?: boolean }
  ): Promise<BrainWakeupResult[]> {
    const maxBrainCalls = options?.maxBrainCalls ?? 3;
    const useLLM = options?.useLLM ?? true;

    const detected = await this.detectExceptions(agents, roundNum, maxBrainCalls);
    return this.executeWakeups(detected, roundNum, useLLM);
  }

  /**
   * Apply default responses when useLLM=false
   */
  private async applyDefaultExceptionResponses(
    agents: Array<{ agent: AgentWithPolicy; exception: ExceptionTrigger }>,
    roundNum: number
  ): Promise<BrainWakeupResult[]> {
    const results: BrainWakeupResult[] = [];

    for (const { agent, exception } of agents) {
      const policyChanges: Record<string, unknown> = {};
      const exType = exception.type;

      console.log(`[BrainService] ${agent.name} default exception response: ${exType}`);
      console.log(`[BrainService] ${agent.name} policy BEFORE: target_margin=${(agent.policy as any)?.bidding?.target_margin ?? 'default'}, min_margin=${(agent.policy as any)?.bidding?.min_margin ?? 'default'}`);

      if (exType === 'consecutive_losses') {
        policyChanges.bidding = { target_margin: 0.08 }; // Lower margin to win more
      } else if (exType === 'balance_critical' || exType === 'win_rate_too_low') {
        policyChanges.bidding = { target_margin: 0.20 }; // Conservative to preserve capital
      }

      if (Object.keys(policyChanges).length > 0) {
        await this.applyPolicyChanges(agent, policyChanges);
        console.log(`[BrainService] ${agent.name} policy AFTER: target_margin=${(agent.policy as any)?.bidding?.target_margin ?? 'default'}, min_margin=${(agent.policy as any)?.bidding?.min_margin ?? 'default'}`);
      }

      const reasoning = `Default response to ${exType} (LLM disabled)`;

      // Track wakeup (no cost since no LLM call)
      await recordBrainWakeup(agent.id, 0).catch(err =>
        console.error(`[BrainService] Failed to record brain wakeup for ${agent.name}:`, err)
      );

      // Update runtime state: cooldown + checkpoint
      try {
        const runtimeState = await loadRuntimeState(agent.id);
        if (runtimeState) {
          runtimeState.last_brain_wakeup_round = roundNum;
          runtimeState.reputation_at_last_check = agent.reputation;
          runtimeState.win_rate_at_last_check = runtimeState.win_rate_last_20;
          if (Object.keys(policyChanges).length > 0) {
            runtimeState.last_policy_change_round = roundNum;
            runtimeState.total_policy_changes = (runtimeState.total_policy_changes || 0) + 1;
            runtimeState.metrics_at_last_change = {
              win_rate: runtimeState.win_rate_last_20,
              balance: agent.balance,
              consecutive_losses: runtimeState.consecutive_losses,
              target_margin: (policyChanges as any)?.bidding?.target_margin ?? 0,
            };
          }
          await saveRuntimeState(runtimeState);
        }
      } catch (err) {
        console.error(`[BrainService] Failed to update runtime state for ${agent.name}:`, err);
      }

      // Emit brain_decision event so it appears in the activity feed
      const wallets = agent.wallet_address ? [agent.wallet_address] : [];
      createEvent({
        event_type: 'brain_decision',
        description: `${agent.name}: "${reasoning}"`,
        agent_wallets: wallets,
        round_number: roundNum,
        metadata: {
          decision_type: 'exception_handled',
          agent_name: agent.name,
          trigger: exType,
          full_reasoning: reasoning,
          policy_changes: policyChanges,
          llm_enabled: false,
        },
      }).then(({ error }) => {
        if (error) console.error(`[BrainService] Failed to create brain_decision event for ${agent.name}:`, error.message);
      }).catch(err => console.error(`[BrainService] brain_decision event error:`, err));

      results.push({
        agentId: agent.id,
        agentName: agent.name,
        round: roundNum,
        exceptionType: exType,
        details: JSON.stringify(exception.details),
        policyChanges,
        reasoning,
      });
    }

    return results;
  }

  /**
   * Wake up an agent's brain for an exception
   */
  async wakeForException(
    agent: AgentWithPolicy,
    exception: ExceptionTrigger,
    roundNum: number
  ): Promise<BrainWakeupResult | null> {
    try {
      // Create memory context
      const context: MemoryContext = {
        identity: {
          name: agent.name,
          type: agent.type,
          personality: agent.personality,
        },
        balance: agent.balance,
        reputation: agent.reputation,
        currentRound: roundNum,
      };

      // Create exception memory
      await createPersonalMemory(
        agent.id,
        'exception_handled',
        {
          exception_type: exception.type,
          ...exception.details,
          triggered_brain: true,
        },
        roundNum,
        context,
        `Exception: ${exception.type}`,
        0.9
      );

      // Call brain
      const { brainStrategicThinking } = await import('@/lib/agent-brain/gemini-integration');
      const { buildWakeUpContext } = await import('@/lib/agent-runtime/context-builder');
      const { buildStrategicSystemPrompt, buildStrategicUserPrompt, buildHistorySummary } = await import('@/lib/agent-runtime/prompts/strategic-thinking');

      // Build context
      const wakeUpContext = await buildWakeUpContext(
        agent.id,
        'exception',
        exception.type,
        'high'
      );

      // Build prompts
      const systemPrompt = buildStrategicSystemPrompt(wakeUpContext);
      const userPrompt = buildStrategicUserPrompt(wakeUpContext);
      const historySummary = buildHistorySummary(wakeUpContext);

      console.log(`[BrainService] Brain waking for ${agent.name}: ${exception.type}`);
      console.log(`[BrainService] ${agent.name} policy BEFORE brain: target_margin=${(agent.policy as any)?.bidding?.target_margin ?? 'default'}, min_margin=${(agent.policy as any)?.bidding?.min_margin ?? 'default'}`);

      // Dump full prompt to file for inspection (non-critical, skip on read-only fs like Vercel)
      try {
        const fs = await import('fs');
        const path = await import('path');
        const promptDir = path.join('/tmp', 'brain-prompts-v2');
        fs.mkdirSync(promptDir, { recursive: true });
        const safeName = agent.name.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+$/, '');
        const filename = `R${roundNum}_${safeName}_${exception.type}.md`;
        const promptDump = [
          `# Brain Wake-Up: ${agent.name}`,
          `**Round:** ${roundNum}`,
          `**Trigger:** ${exception.type}`,
          `**Time:** ${new Date().toISOString()}`,
          `**Agent ID:** ${agent.id}`,
          `**Balance:** $${agent.balance.toFixed(4)}`,
          `**Reputation:** ${agent.reputation}`,
          '',
          '---',
          '',
          '# CONTEXT OBJECT',
          '',
          '```json',
          JSON.stringify(wakeUpContext, null, 2),
          '```',
          '',
          '---',
          '',
          '# SYSTEM PROMPT (sent to Gemini)',
          '',
          systemPrompt,
          '',
          '---',
          '',
          '# USER PROMPT (sent to Gemini)',
          '',
          userPrompt,
        ].join('\n');
        fs.writeFileSync(path.join(promptDir, filename), promptDump);
        console.log(`[BrainService] Wrote prompt to /tmp/brain-prompts-v2/${filename}`);
      } catch (_) { /* non-critical: read-only filesystem on Vercel */ }

      // Call brain - the LLM's update_policy tool writes directly to DB
      const result = await brainStrategicThinking(agent.id, systemPrompt, userPrompt, historySummary, 'exception');
      const policyChanges: Record<string, unknown> = result.policy_changes || {};

      console.log(`[BrainService] ${agent.name} brain decided: ${JSON.stringify(policyChanges)}`);

      // Append brain response to prompt file
      try {
        const fs2 = await import('fs');
        const path2 = await import('path');
        const promptDir2 = path2.join('/tmp', 'brain-prompts-v2');
        const safeName2 = agent.name.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+$/, '');
        const filename2 = `R${roundNum}_${safeName2}_${exception.type}.md`;
        const responseDump = [
          '',
          '---',
          '',
          '# BRAIN RESPONSE',
          '',
          `**Reasoning:** ${result.reasoning}`,
          '',
          `**Policy Changes:** \`${JSON.stringify(policyChanges)}\``,
          '',
          `**Actions Taken:** ${JSON.stringify(result.actions_taken || [], null, 2)}`,
          '',
          `**Partnership Actions:** ${JSON.stringify(result.partnership_actions || [], null, 2)}`,
          '',
          `**Phase 1 Summary:** ${JSON.stringify(result.phase1_summary || {}, null, 2)}`,
          '',
          `**Phase 2 Actions:** ${JSON.stringify(result.phase2_actions || [], null, 2)}`,
        ].join('\n');
        fs2.appendFileSync(path2.join(promptDir2, filename2), responseDump);
      } catch (_) { /* non-critical */ }

      // Deduct brain cost from agent balance and track the wakeup
      const brainCost = 0.001;
      await economyService.adjustBalance(agent.id, -brainCost);
      await recordBrainWakeup(agent.id, brainCost);

      // Update runtime state: cooldown + checkpoint + "since last change" tracking
      try {
        const runtimeState = await loadRuntimeState(agent.id);
        if (runtimeState) {
          runtimeState.last_brain_wakeup_round = roundNum;
          // Checkpoint reputation and win rate so next exception detection uses THIS as baseline
          runtimeState.reputation_at_last_check = agent.reputation;
          runtimeState.win_rate_at_last_check = runtimeState.win_rate_last_20;

          // If policy changed, snapshot current metrics for "since last change" tracking
          if (Object.keys(policyChanges).length > 0) {
            const currentMargin = (policyChanges as any)?.bidding?.target_margin
              ?? (agent.policy as any)?.bidding?.target_margin ?? 0;
            runtimeState.last_policy_change_round = roundNum;
            runtimeState.total_policy_changes = (runtimeState.total_policy_changes || 0) + 1;
            runtimeState.metrics_at_last_change = {
              win_rate: runtimeState.win_rate_last_20,
              balance: agent.balance,
              consecutive_losses: runtimeState.consecutive_losses,
              target_margin: currentMargin,
            };
          }

          await saveRuntimeState(runtimeState);
        }
      } catch (err) {
        console.error(`[BrainService] Failed to update runtime state after brain wakeup for ${agent.name}:`, err);
      }

      // Store in exception_history
      const investorUpdate = result.investor_update || { observations: [], changes: [] };
      await supabase.from('exception_history').insert({
        agent_id: agent.id,
        exception_type: exception.type,
        exception_details: JSON.stringify(exception.details),
        current_value: exception.currentValue,
        threshold: exception.threshold,
        round_number: roundNum,
        brain_response: {
          reasoning: result.reasoning,
          observations: investorUpdate.observations,
          policy_changes: policyChanges,
          partnership_actions: result.partnership_actions || [],
        },
        resolved: true,
        resolved_at: new Date().toISOString(),
      });

      // Record brain_decision event
      if (result.reasoning) {
        const shortReasoning = result.reasoning.length > 100
          ? result.reasoning.substring(0, 100) + '...'
          : result.reasoning;

        const wallets = agent.wallet_address ? [agent.wallet_address] : [];
        createEvent({
          event_type: 'brain_decision',
          description: `${agent.name}: "${shortReasoning}"`,
          agent_wallets: wallets,
          round_number: roundNum,
          metadata: {
            decision_type: 'exception_handled',
            agent_name: agent.name,
            trigger: exception.type,
            full_reasoning: result.reasoning,
            policy_changes: policyChanges,
          },
        }).then(({ error }) => {
          if (error) console.error(`[BrainService] Failed to create brain_decision event for ${agent.name}:`, error.message);
        }).catch(err => console.error(`[BrainService] brain_decision event error:`, err));
      }

      // Re-read the policy from DB to sync in-memory state
      // (the LLM's update_policy tool already wrote to DB — no second write needed)
      const { data: latestPolicy } = await supabase
        .from('agent_policies')
        .select('policy_json')
        .eq('agent_id', agent.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (latestPolicy?.policy_json) {
        agent.policy = latestPolicy.policy_json as AgentWithPolicy['policy'];
        console.log(`[BrainService] ${agent.name} policy AFTER brain: target_margin=${(agent.policy as any)?.bidding?.target_margin ?? 'default'}, min_margin=${(agent.policy as any)?.bidding?.min_margin ?? 'default'}`);
      }

      return {
        agentId: agent.id,
        agentName: agent.name,
        round: roundNum,
        exceptionType: exception.type,
        details: JSON.stringify(exception.details),
        policyChanges,
        strategicOptions: [],
        partnershipActions: (result.partnership_actions || []) as BrainWakeupResult['partnershipActions'],
        reasoning: result.reasoning,
      };
    } catch (error) {
      console.error(`[BrainService] Brain failed for ${agent.name}:`, error);
      await logSystemError('llm', error, {
        round_number: roundNum,
        agent_name: agent.name,
        agent_id: agent.id,
        detail: `Brain wakeup failed (${exception.type})`,
      });
      return null;
    }
  }

  /**
   * Check if QBR is due for an agent and run it if so.
   * Returns true if QBR was run.
   */
  async checkAndRunQBR(
    agent: AgentWithPolicy,
    roundNumber: number,
    useLLM: boolean
  ): Promise<boolean> {
    // Load runtime state to check QBR timing
    const { data: stateData } = await supabase
      .from('agent_runtime_state')
      .select('*')
      .eq('agent_id', agent.id)
      .single();

    if (!stateData) return false;

    // Load last QBR round
    const { data: policyData } = await supabase
      .from('agent_policies')
      .select('last_qbr_round')
      .eq('agent_id', agent.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const lastQBRRound = policyData?.last_qbr_round || 0;
    const policy = agent.policy || PERSONALITY_DEFAULTS[agent.personality] || PERSONALITY_DEFAULTS.balanced;

    if (!isQBRDue(stateData, policy as AgentPolicy, lastQBRRound)) {
      return false;
    }

    if (!useLLM) {
      // Skip QBR when LLM is disabled - just update the timestamp
      await supabase
        .from('agent_policies')
        .update({ last_qbr_round: roundNumber })
        .eq('agent_id', agent.id);
      console.log(`[BrainService] QBR due for ${agent.name} but useLLM=false, skipping`);
      return false;
    }

    // Run QBR via Gemini
    try {
      const { executeQBR } = await import('@/lib/agent-runtime/qbr-handler');
      await executeQBR({
        agent_id: agent.id,
        trigger_reason: 'scheduled',
        current_round: roundNumber,
      });

      // Deduct brain cost for QBR
      const brainCost = 0.001;
      await economyService.adjustBalance(agent.id, -brainCost);

      console.log(`[BrainService] QBR completed for ${agent.name}`);
      return true;
    } catch (err) {
      console.error(`[BrainService] QBR failed for ${agent.name}:`, err);
      await logSystemError('llm', err, {
        round_number: roundNumber,
        agent_name: agent.name,
        agent_id: agent.id,
        detail: 'QBR execution failed',
      });
      return false;
    }
  }

  /**
   * Apply policy changes from brain decision
   */
  async applyPolicyChanges(
    agent: AgentWithPolicy,
    changes: Record<string, unknown>
  ): Promise<void> {
    // Merge with existing policy
    const currentPolicy: Record<string, unknown> = (agent.policy as unknown as Record<string, unknown>) || {};
    const newPolicy = { ...currentPolicy };

    if (changes.bidding && typeof changes.bidding === 'object') {
      newPolicy.bidding = {
        ...((currentPolicy.bidding as Record<string, unknown>) || {}),
        ...(changes.bidding as Record<string, unknown>),
      };
    }

    if (changes.survival && typeof changes.survival === 'object') {
      newPolicy.survival = {
        ...((currentPolicy.survival as Record<string, unknown>) || {}),
        ...(changes.survival as Record<string, unknown>),
      };
    }

    // Insert new policy
    await supabase.from('agent_policies').insert({
      agent_id: agent.id,
      policy_json: newPolicy,
      created_at: new Date().toISOString(),
    });

    // Update local agent
    agent.policy = newPolicy as unknown as AgentWithPolicy['policy'];
  }

  /**
   * Get exception thresholds
   */
  getThresholds() {
    return {
      CONSECUTIVE_LOSSES: 3,
      WIN_RATE_LOW: 0.3,
      BALANCE_CRITICAL: 0.5,
      HIGH_PERFORMER: 0.7,
    };
  }
}

// Singleton instance for convenience
export const brainService = new BrainService();
