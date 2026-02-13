/**
 * UI-specific type definitions
 * Extended types for frontend components that include computed/display data
 */

import { Agent } from './database';

/**
 * Personality types for agents
 */
export type PersonalityType = 'conservative' | 'balanced' | 'aggressive' | 'opportunistic';

/**
 * Extended agent details with additional computed data
 */
export interface AgentDetail extends Agent {
  personality: PersonalityType;
  total_revenue: number;
  total_costs: number;
  profit_loss: number;
  burn_rate_per_task: number;
  runway_tasks: number;
  total_invested: number;
  total_dividends: number;
}

/**
 * Agent activity entry
 */
export interface AgentActivity {
  id: string;
  type: 'task_completed' | 'task_failed' | 'investment_received' | 'status_changed' | 'partnership_formed';
  description: string;
  timestamp: string;
  amount?: number;
  status?: 'success' | 'warning' | 'error' | 'info';
  tx_hash?: string | null;
  isOutflow?: boolean;
}

/**
 * Agent thinking/reasoning entry
 */
export interface AgentThinking {
  timestamp: string;
  thought: string;
  context?: string;
}
