/**
 * Report Narrative Generation Engine
 *
 * Uses Google Gemini to generate structured analyst-style narrative
 * from computed metrics. Produces 7 sections: headline, executive summary,
 * market dynamics, agent spotlight, strategy analysis, outlook, and awards.
 *
 * Created: 2026-02-08
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ReportMetrics, ReportNarrative } from '@/types/database';

/**
 * Generate an analyst narrative from computed metrics
 */
export async function generateReportNarrative(
  metrics: ReportMetrics,
  model: string,
  startRound: number,
  endRound: number
): Promise<ReportNarrative> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.warn('[Report Narrative] GOOGLE_API_KEY not set, using fallback narrative');
    return generateFallbackNarrative(metrics, startRound, endRound);
  }

  try {
    const client = new GoogleGenerativeAI(apiKey);
    const genModel = client.getGenerativeModel({ model });

    const prompt = buildPrompt(metrics, startRound, endRound);

    const result = await genModel.generateContent(prompt);
    const text = result.response.text();

    // Parse the JSON response
    const parsed = parseNarrativeResponse(text);
    if (parsed) return parsed;

    // If parsing fails, try to extract from markdown code block
    console.warn('[Report Narrative] Failed to parse JSON response, using fallback');
    return generateFallbackNarrative(metrics, startRound, endRound);
  } catch (error) {
    console.error('[Report Narrative] LLM generation failed:', error);
    return generateFallbackNarrative(metrics, startRound, endRound);
  }
}

/**
 * Build the LLM prompt with metrics context
 */
function buildPrompt(metrics: ReportMetrics, startRound: number, endRound: number): string {
  const topAgents = metrics.agents.slice(0, 5);
  const totalRounds = endRound - startRound + 1;

  return `You are the Chief Market Analyst for an autonomous AI agent economy called Inomy.
In this economy, AI agents compete in auctions to win tasks (CATALOG, REVIEW, CURATION types).
They bid using USDC, and the winner with the best score (reputation/bid ratio) gets the task.
Agents have personalities (conservative, balanced, aggressive, opportunistic) that affect their bidding.
They have an LLM "brain" that periodically reviews performance and adjusts bidding policy.

Analyze the following market data for rounds ${startRound}-${endRound} (${totalRounds} rounds) and produce a JSON report.

## MARKET DATA
${JSON.stringify(metrics.market, null, 2)}

## TOP AGENTS (by wins)
${JSON.stringify(topAgents.map(formatAgentForPrompt), null, 2)}

## ALL AGENTS (${metrics.agents.length} total)
${JSON.stringify(metrics.agents.map(formatAgentForPrompt), null, 2)}

## EVENTS
${JSON.stringify(metrics.events, null, 2)}

## AGENT STRATEGY EVOLUTION (Brain Decisions & Memories)
${metrics.strategy?.agents?.length ? JSON.stringify(metrics.strategy.agents, null, 2) : 'No strategy evolution data available for this period.'}

## COMPETITIVE DYNAMICS
${formatCompetitiveDynamicsForPrompt(metrics, startRound, endRound)}

Respond with ONLY a JSON object (no markdown, no code fences) with these exact keys:
{
  "headline": "A punchy 5-10 word headline summarizing the period (like a newspaper)",
  "executive_summary": "2-3 sentence overview of the most important developments",
  "market_dynamics": "1-2 paragraphs analyzing pricing trends, competition, and market health",
  "agent_spotlight": "1-2 paragraphs spotlighting the most interesting agent(s) - who dominated, who struggled, any surprising behavior",
  "strategy_analysis": "1-2 paragraphs on bidding strategies - which personality types are winning, margin trends, brain adaptations",
  "strategy_evolution": "1-2 paragraphs about how agents adapted their strategies. Include specific agent names, what triggered their brain to wake up, what they changed, and quote their first-person memories when available. Focus on the most interesting pivots. If no strategy data is available, write a brief note about the absence of brain activity.",
  "competitive_dynamics": "1-2 paragraphs analyzing winner diversity per task type, leadership changes, bid convergence trends, and the most impactful margin changes with their cause-and-effect on bid amounts. Reference the highlighted margin change annotations.",
  "outlook": "1-2 sentences on what to watch for in the next period",
  "awards": [
    {
      "title": "Top Earner",
      "agent_name": "name",
      "reason": "brief reason with specific numbers",
      "stats": {"revenue": "$X.XXXX", "profit": "$X.XXXX", "win_rate": "XX.X%", "margin": "XX.X%", "investor_payout": "$X.XXXX"}
    }
  ]
}

Rules:
- Use actual agent names and numbers from the data
- ALWAYS format win rates and margins as percentages (e.g., "96.4%" not "0.9636", "17.3%" not "0.1725")
- Use dollar amounts for bids/revenue (e.g., "$0.0523")
- Awards should reference real agents from the data. Include 2-4 awards.
- Each award MUST include a "stats" object with at least 2-3 of: revenue, profit, win_rate, margin, investor_payout (use data from the agent metrics; for investor_payout estimate from investor_share_bps if available)
- Keep the tone professional but engaging, like a Bloomberg analyst report
- If data is sparse, note it honestly rather than fabricating trends`;
}

/**
 * Format competitive dynamics data for the LLM prompt.
 * Produces a compact but information-rich section with winner timelines,
 * bid spread trends, and highlighted margin change annotations.
 */
function formatCompetitiveDynamicsForPrompt(metrics: ReportMetrics, _startRound: number, _endRound: number): string {
  const comp = metrics.competitive;
  if (!comp || comp.by_task_type.length === 0) {
    return 'No competitive dynamics data available for this period.';
  }

  const lines: string[] = [];

  // Winner timeline - one line per round, columns per task type
  for (const tt of comp.by_task_type) {
    lines.push(`### ${tt.task_type} (${tt.unique_winners} unique winners, ${tt.leadership_changes} leadership changes)`);
    lines.push('Round-by-round winners:');
    for (const w of tt.winners) {
      lines.push(`  R${w.round}: ${w.winner_name}($${w.winner_bid.toFixed(4)}) [${w.num_bidders} bidders]`);
    }

    // Bid spread trend summary
    if (tt.bid_spreads.length >= 2) {
      const first = tt.bid_spreads[0];
      const last = tt.bid_spreads[tt.bid_spreads.length - 1];
      const trend = last.spread < first.spread ? 'converging' : last.spread > first.spread ? 'diverging' : 'stable';
      lines.push(`Bid spread: R${first.round} $${first.spread.toFixed(4)} -> R${last.round} $${last.spread.toFixed(4)} (${trend})`);
    }
    lines.push('');
  }

  // Margin change annotations (highlighted)
  if (comp.margin_changes.length > 0) {
    lines.push('### MARGIN CHANGES WITH BID IMPACT');
    for (const mc of comp.margin_changes) {
      lines.push(`>> R${mc.round} ${mc.agent_name}: ${mc.annotation} (${mc.trigger})`);
    }
  } else {
    lines.push('### MARGIN CHANGES: None detected in this period');
  }

  return lines.join('\n');
}

/**
 * Format agent data for the LLM prompt with human-readable percentages
 */
function formatAgentForPrompt(a: ReportMetrics['agents'][0]) {
  return {
    name: a.name,
    type: a.type,
    personality: a.personality,
    wins: a.wins,
    bids: a.bids,
    win_rate: `${(a.win_rate * 100).toFixed(1)}%`,
    avg_bid: `$${a.avg_bid.toFixed(4)}`,
    avg_margin: a.avg_margin !== null ? `${(a.avg_margin * 100).toFixed(1)}%` : null,
    balance: `$${a.balance_end.toFixed(4)}`,
    brain_wakeups: a.brain_wakeups,
    policy_changes: a.policy_changes,
  };
}

/**
 * Parse the LLM's JSON response, handling various formatting quirks
 */
function parseNarrativeResponse(text: string): ReportNarrative | null {
  // Try direct parse
  try {
    const parsed = JSON.parse(text);
    if (isValidNarrative(parsed)) return parsed;
  } catch {
    // Not direct JSON
  }

  // Try extracting from markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (isValidNarrative(parsed)) return parsed;
    } catch {
      // Failed
    }
  }

  // Try finding JSON object in the text
  const jsonMatch = text.match(/\{[\s\S]*"headline"[\s\S]*"awards"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (isValidNarrative(parsed)) return parsed;
    } catch {
      // Failed
    }
  }

  return null;
}

/**
 * Validate that the parsed object has all required narrative fields
 */
function isValidNarrative(obj: unknown): obj is ReportNarrative {
  if (!obj || typeof obj !== 'object') return false;
  const n = obj as Record<string, unknown>;
  return (
    typeof n.headline === 'string' &&
    typeof n.executive_summary === 'string' &&
    typeof n.market_dynamics === 'string' &&
    typeof n.agent_spotlight === 'string' &&
    typeof n.strategy_analysis === 'string' &&
    typeof n.outlook === 'string' &&
    Array.isArray(n.awards)
  );
}

/**
 * Generate a basic narrative without LLM (fallback)
 */
function generateFallbackNarrative(
  metrics: ReportMetrics,
  startRound: number,
  endRound: number
): ReportNarrative {
  const m = metrics.market;
  const topAgent = metrics.agents[0];
  const trend = m.winning_bid_trend === 'increasing' ? 'upward' :
    m.winning_bid_trend === 'decreasing' ? 'downward' : 'stable';

  return {
    headline: `${m.total_tasks} Tasks, ${m.total_bids} Bids Across ${endRound - startRound + 1} Rounds`,
    executive_summary: `The agent economy processed ${m.total_tasks} tasks generating $${m.total_revenue.toFixed(4)} in total revenue over rounds ${startRound}-${endRound}. Average winning bid was $${m.avg_winning_bid.toFixed(4)} with ${m.avg_bidders_per_task.toFixed(1)} bidders per task on average.`,
    market_dynamics: `Winning bids showed a ${trend} trend over the period. Market-wide margins averaged ${(m.margin_avg * 100).toFixed(1)}% (range: ${(m.margin_min * 100).toFixed(1)}%-${(m.margin_max * 100).toFixed(1)}%). Competition intensity averaged ${m.avg_bidders_per_task.toFixed(1)} bidders per task.`,
    agent_spotlight: topAgent
      ? `${topAgent.name} (${topAgent.type}) led with ${topAgent.wins} wins from ${topAgent.bids} bids (${(topAgent.win_rate * 100).toFixed(1)}% win rate). Their average bid of $${topAgent.avg_bid.toFixed(4)} proved competitive in the current market.`
      : 'No standout agents in this period.',
    strategy_analysis: `Brain wakeups: ${metrics.events.brain_decisions}, policy changes: ${metrics.events.policy_changes}. ${metrics.events.exceptions > 0 ? `${metrics.events.exceptions} exceptions were flagged.` : 'No exceptions flagged.'}`,
    strategy_evolution: metrics.strategy?.agents?.length
      ? `${metrics.strategy.agents.length} agents showed strategic adaptation during this period, with a total of ${metrics.strategy.agents.reduce((s, a) => s + a.moments.length, 0)} notable brain decisions and memory entries.`
      : undefined,
    competitive_dynamics: buildFallbackCompetitiveDynamics(metrics),
    outlook: `Watch for continued ${trend} pressure on winning bids as agents adapt their strategies.`,
    awards: topAgent ? [
      {
        title: 'Top Performer',
        agent_name: topAgent.name,
        reason: `${topAgent.wins} wins with ${(topAgent.win_rate * 100).toFixed(1)}% win rate`,
        stats: {
          win_rate: `${(topAgent.win_rate * 100).toFixed(1)}%`,
          margin: topAgent.avg_margin !== null ? `${(topAgent.avg_margin * 100).toFixed(1)}%` : undefined,
          revenue: `$${topAgent.balance_end.toFixed(4)}`,
        },
      },
    ] : [],
  };
}

/**
 * Build a basic competitive dynamics narrative from metrics (no LLM)
 */
function buildFallbackCompetitiveDynamics(metrics: ReportMetrics): string | undefined {
  const comp = metrics.competitive;
  if (!comp || comp.by_task_type.length === 0) return undefined;

  const parts: string[] = [];
  for (const tt of comp.by_task_type) {
    parts.push(`${tt.task_type}: ${tt.unique_winners} unique winners, ${tt.leadership_changes} leadership changes across ${tt.winners.length} rounds.`);
  }
  if (comp.margin_changes.length > 0) {
    parts.push(`${comp.margin_changes.length} margin change(s) detected: ${comp.margin_changes.map(mc => mc.annotation).join('; ')}.`);
  }
  return parts.join(' ');
}
