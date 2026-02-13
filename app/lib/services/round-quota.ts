import { supabase } from '@/lib/supabase';

const DAILY_LIMIT = 50;
const EXEMPT_WALLET = process.env.COST_SINK_WALLET_ADDRESS?.toLowerCase();

interface QuotaResult {
  allowed: boolean;
  used: number;
  remaining: number;
  limit: number;
}

/**
 * Check if a wallet has remaining round quota for the day.
 * Deployer wallet (COST_SINK_WALLET_ADDRESS) is exempt.
 */
export async function checkQuota(wallet: string): Promise<QuotaResult> {
  const normalized = wallet.toLowerCase();

  // Exempt wallet has no limit
  if (EXEMPT_WALLET && normalized === EXEMPT_WALLET) {
    return { allowed: true, used: 0, remaining: Infinity, limit: Infinity };
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('round_usage_log')
    .select('rounds_used')
    .eq('wallet_address', normalized)
    .gte('created_at', since);

  if (error) {
    console.error('[round-quota] Failed to check quota:', error);
    // Fail open — don't block users if DB is down
    return { allowed: true, used: 0, remaining: DAILY_LIMIT, limit: DAILY_LIMIT };
  }

  const used = (data || []).reduce((sum, row) => sum + (row.rounds_used || 0), 0);
  const remaining = Math.max(DAILY_LIMIT - used, 0);

  return {
    allowed: remaining > 0,
    used,
    remaining,
    limit: DAILY_LIMIT,
  };
}

/**
 * Record round usage after successful completion.
 */
export async function recordUsage(wallet: string, rounds: number): Promise<void> {
  const normalized = wallet.toLowerCase();

  // Don't record for exempt wallet
  if (EXEMPT_WALLET && normalized === EXEMPT_WALLET) return;

  const { error } = await supabase
    .from('round_usage_log')
    .insert({ wallet_address: normalized, rounds_used: rounds });

  if (error) {
    console.error('[round-quota] Failed to record usage:', error);
  }
}
