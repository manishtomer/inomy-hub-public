import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { AVAILABLE_MODEL_IDS, DEFAULT_MODEL, LLM_ACTIVITIES } from '@/lib/llm-config';
import type { LlmActivity } from '@/lib/llm-config';

const DEFAULT_LLM_MODELS: Record<LlmActivity, string> = {
  narrator: DEFAULT_MODEL,
  brain: DEFAULT_MODEL,
  qbr: DEFAULT_MODEL,
  exception: DEFAULT_MODEL,
  reports: DEFAULT_MODEL,
};

/**
 * GET /api/reports/config
 * Returns report configuration from simulation_state.
 */
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('simulation_state')
      .select('current_round, report_interval, report_model, last_report_round, llm_models')
      .eq('id', 'global')
      .single();

    if (error) {
      console.error('[/api/reports/config] DB error:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      config: {
        report_interval: data?.report_interval ?? 20,
        report_model: data?.report_model ?? DEFAULT_MODEL,
        llm_models: data?.llm_models ?? DEFAULT_LLM_MODELS,
        last_report_round: data?.last_report_round ?? 0,
        current_round: data?.current_round ?? 0,
      },
    });
  } catch (err) {
    console.error('[/api/reports/config] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/reports/config
 * Update report configuration in simulation_state.
 * Body: { report_interval?: number, report_model?: string, llm_models?: Partial<Record<LlmActivity, string>> }
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    const updates: Record<string, unknown> = {};

    if (body.report_interval !== undefined) {
      const interval = parseInt(body.report_interval);
      if (isNaN(interval) || interval < 5) {
        return NextResponse.json(
          { success: false, error: 'report_interval must be >= 5' },
          { status: 400 }
        );
      }
      updates.report_interval = interval;
    }

    if (body.report_model !== undefined) {
      if (!AVAILABLE_MODEL_IDS.includes(body.report_model)) {
        return NextResponse.json(
          { success: false, error: `Invalid model. Must be one of: ${AVAILABLE_MODEL_IDS.join(', ')}` },
          { status: 400 }
        );
      }
      updates.report_model = body.report_model;
    }

    // Per-activity LLM models (partial update)
    if (body.llm_models !== undefined && typeof body.llm_models === 'object') {
      const validKeys = LLM_ACTIVITIES.map(a => a.key);
      for (const [key, value] of Object.entries(body.llm_models)) {
        if (!validKeys.includes(key as LlmActivity)) {
          return NextResponse.json(
            { success: false, error: `Invalid activity key: ${key}. Must be one of: ${validKeys.join(', ')}` },
            { status: 400 }
          );
        }
        if (!(AVAILABLE_MODEL_IDS as readonly string[]).includes(value as string)) {
          return NextResponse.json(
            { success: false, error: `Invalid model for ${key}. Must be one of: ${AVAILABLE_MODEL_IDS.join(', ')}` },
            { status: 400 }
          );
        }
      }

      // Read existing llm_models, merge in the partial update
      const { data: existing } = await supabase
        .from('simulation_state')
        .select('llm_models')
        .eq('id', 'global')
        .single();

      const currentModels = (existing?.llm_models as Record<string, string>) || DEFAULT_LLM_MODELS;
      updates.llm_models = { ...currentModels, ...body.llm_models };
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('simulation_state')
      .update(updates)
      .eq('id', 'global');

    if (error) {
      console.error('[/api/reports/config] Update error:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, updated: updates });
  } catch (err) {
    console.error('[/api/reports/config] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
