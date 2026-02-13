import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { computeReportMetrics } from '@/lib/reports/compute-metrics';
import { generateReportNarrative } from '@/lib/reports/generate-narrative';

/**
 * POST /api/reports/generate
 * Generate a new industry report.
 * Body (optional): { start_round?: number, end_round?: number }
 * If omitted, auto-calculates from simulation_state.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    // 1. Load config from simulation_state
    const { data: config, error: configError } = await supabase
      .from('simulation_state')
      .select('current_round, report_interval, report_model, last_report_round, llm_models')
      .eq('id', 'global')
      .single();

    if (configError || !config) {
      console.error('[/api/reports/generate] Failed to load config:', configError);
      return NextResponse.json(
        { success: false, error: 'Failed to load simulation config' },
        { status: 500 }
      );
    }

    // 2. Determine round range (default: last N rounds where N = report_interval)
    const interval = config.report_interval || 20;
    const endRound = body.end_round ?? config.current_round;
    const startRound = body.start_round ?? Math.max(1, endRound - interval + 1);

    if (endRound < startRound || endRound < 1) {
      return NextResponse.json(
        { success: false, error: `Not enough rounds to report (current_round=${config.current_round})` },
        { status: 400 }
      );
    }

    // 3. Determine report number
    const { data: lastReport } = await supabase
      .from('industry_reports')
      .select('report_number')
      .order('report_number', { ascending: false })
      .limit(1)
      .single();

    const reportNumber = (lastReport?.report_number ?? 0) + 1;

    console.log(`[Report] Generating report #${reportNumber} for rounds ${startRound}-${endRound}`);

    // 4. Compute metrics
    const metricsStart = Date.now();
    const metrics = await computeReportMetrics(startRound, endRound);

    // 5. Generate narrative (prefer per-activity llm_models.reports, fall back to report_model)
    const llmModels = config.llm_models as Record<string, string> | null;
    const modelToUse = llmModels?.reports || config.report_model || 'gemini-2.5-flash-lite';
    const narrative = await generateReportNarrative(
      metrics,
      modelToUse,
      startRound,
      endRound
    );
    const generationTimeMs = Date.now() - metricsStart;

    // 6. Insert into industry_reports
    const { data: report, error: insertError } = await supabase
      .from('industry_reports')
      .insert({
        report_number: reportNumber,
        start_round: startRound,
        end_round: endRound,
        metrics,
        narrative,
        model_used: modelToUse,
        generation_time_ms: generationTimeMs,
      })
      .select()
      .single();

    if (insertError) {
      console.error('[Report] Failed to insert report:', insertError);
      return NextResponse.json(
        { success: false, error: `Failed to save report: ${insertError.message}` },
        { status: 500 }
      );
    }

    // 7. Update simulation_state.last_report_round
    const { error: updateError } = await supabase
      .from('simulation_state')
      .update({ last_report_round: endRound })
      .eq('id', 'global');

    if (updateError) {
      console.error('[Report] Failed to update last_report_round:', updateError);
      // Don't fail the request, report was already saved
    }

    // 8. Write summary to industry_memory for brain context
    try {
      await supabase
        .from('industry_memory')
        .insert({
          round_number: endRound,
          event_type: 'industry_report',
          data: {
            report_number: reportNumber,
            start_round: startRound,
            end_round: endRound,
            total_tasks: metrics.market.total_tasks,
            total_revenue: metrics.market.total_revenue,
            avg_winning_bid: metrics.market.avg_winning_bid,
            winning_bid_trend: metrics.market.winning_bid_trend,
          },
          narrative: `Industry Report #${reportNumber} (Rounds ${startRound}-${endRound}): ${narrative.headline}. ${narrative.executive_summary}`,
          severity: 'normal',
          agents_affected: metrics.agents.length,
        });
    } catch (memError) {
      console.error('[Report] Failed to write industry_memory:', memError);
      // Non-critical, don't fail the request
    }

    console.log(`[Report] Generated report #${reportNumber} in ${generationTimeMs}ms`);

    return NextResponse.json({
      success: true,
      report,
    });
  } catch (err) {
    console.error('[/api/reports/generate] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
