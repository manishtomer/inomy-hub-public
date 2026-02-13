/**
 * Per-Activity LLM Model Configuration
 *
 * Each LLM activity (narrator, brain, qbr, exception, reports) can use
 * a different Gemini model. Reads from simulation_state.llm_models JSONB.
 */

import { supabase } from '@/lib/supabase';

export const DEFAULT_MODEL = 'gemini-2.5-flash-lite';

export const AVAILABLE_MODELS = [
  { id: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite (fast, cheapest)' },
  { id: 'gemini-2.0-flash', label: 'gemini-2.0-flash (balanced)' },
  { id: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview (latest)' },
] as const;

export const AVAILABLE_MODEL_IDS = AVAILABLE_MODELS.map(m => m.id);

export type LlmActivity = 'narrator' | 'brain' | 'qbr' | 'exception' | 'reports';

export const LLM_ACTIVITIES: { key: LlmActivity; label: string }[] = [
  { key: 'narrator', label: 'Memory Narrator' },
  { key: 'brain', label: 'Brain (Strategic Thinking)' },
  { key: 'qbr', label: 'QBR (Quarterly Review)' },
  { key: 'exception', label: 'Exception Response' },
  { key: 'reports', label: 'Industry Reports' },
];

const DEFAULT_LLM_MODELS: Record<LlmActivity, string> = {
  narrator: DEFAULT_MODEL,
  brain: DEFAULT_MODEL,
  qbr: DEFAULT_MODEL,
  exception: DEFAULT_MODEL,
  reports: DEFAULT_MODEL,
};

/**
 * Read the configured LLM model for a specific activity from simulation_state.
 * Falls back to DEFAULT_MODEL if DB is unavailable or key is missing.
 */
export async function getModelForActivity(activity: LlmActivity): Promise<string> {
  try {
    const { data, error } = await supabase
      .from('simulation_state')
      .select('llm_models')
      .eq('id', 'global')
      .single();

    if (error || !data?.llm_models) {
      return DEFAULT_LLM_MODELS[activity];
    }

    const models = data.llm_models as Record<string, string>;
    return models[activity] || DEFAULT_LLM_MODELS[activity];
  } catch {
    return DEFAULT_LLM_MODELS[activity];
  }
}

/**
 * Read all configured LLM models. Returns full map of activity -> model.
 */
export async function getAllLlmModels(): Promise<Record<LlmActivity, string>> {
  try {
    const { data, error } = await supabase
      .from('simulation_state')
      .select('llm_models')
      .eq('id', 'global')
      .single();

    if (error || !data?.llm_models) {
      return { ...DEFAULT_LLM_MODELS };
    }

    const models = data.llm_models as Record<string, string>;
    return {
      narrator: models.narrator || DEFAULT_MODEL,
      brain: models.brain || DEFAULT_MODEL,
      qbr: models.qbr || DEFAULT_MODEL,
      exception: models.exception || DEFAULT_MODEL,
      reports: models.reports || DEFAULT_MODEL,
    };
  } catch {
    return { ...DEFAULT_LLM_MODELS };
  }
}
