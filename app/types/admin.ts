/**
 * Admin System Type Definitions
 *
 * Types for admin-manageable skills and personalities.
 * Part of Phase 0: Agent Runtime Admin System
 *
 * Created: 2026-02-06
 */

import type { AgentPolicy } from "@/lib/agent-runtime/types";

// ============================================================================
// SKILL TYPES
// ============================================================================

/**
 * Cost structure for a skill
 * Defines per-task operational costs
 */
export interface CostStructure {
  llm_inference: number; // Cost of LLM inference for task
  data_retrieval: number; // Cost of data retrieval
  storage: number; // Cost of storing results
  submission: number; // Cost of submitting work
}

/**
 * Skill definition from the skills table
 * Represents a capability an agent can have
 */
export interface Skill {
  id: string;
  code: string; // Unique identifier (e.g., "CATALOG", "REVIEW")
  name: string; // Display name (e.g., "Catalog Extraction")
  description: string | null;
  category: string; // Category (e.g., "data", "analysis", "commerce")
  cost_structure: CostStructure; // Per-task operational costs
  task_types: string[]; // Array of task types this skill can handle
  is_active: boolean; // Whether skill is currently available
  is_system: boolean; // System skills cannot be deleted
  created_at: string;
  updated_at: string;
}

/**
 * Request payload for creating a new skill
 */
export interface CreateSkillRequest {
  code: string; // Must be unique, uppercase recommended
  name: string;
  description?: string;
  category?: string; // defaults to "general"
  cost_structure: CostStructure;
  task_types?: string[]; // defaults to empty array
  is_active?: boolean; // defaults to true
}

/**
 * Request payload for updating an existing skill
 */
export interface UpdateSkillRequest {
  name?: string;
  description?: string;
  category?: string;
  cost_structure?: CostStructure;
  task_types?: string[];
  is_active?: boolean;
}

// ============================================================================
// PERSONALITY TYPES
// ============================================================================

/**
 * Personality definition from the personalities table
 * Defines behavioral characteristics and default policy
 */
export interface Personality {
  id: string;
  code: string; // Unique identifier (e.g., "risk-taker", "conservative")
  name: string; // Display name (e.g., "Risk-Taker")
  description: string | null;
  color: string; // Hex color for UI (e.g., "#ef4444")
  icon: string; // Icon name for UI (e.g., "flame", "shield")
  default_policy: AgentPolicy; // Full policy JSON
  behavioral_prompt: string | null; // LLM system prompt describing behavior
  is_active: boolean; // Whether personality is currently available
  is_system: boolean; // System personalities cannot be deleted
  created_at: string;
  updated_at: string;
}

/**
 * Request payload for creating a new personality
 */
export interface CreatePersonalityRequest {
  code: string; // Must be unique, lowercase-with-hyphens recommended
  name: string;
  description?: string;
  color?: string; // defaults to "#6366f1"
  icon?: string; // defaults to "zap"
  default_policy: AgentPolicy; // Required: full policy definition
  behavioral_prompt?: string;
  is_active?: boolean; // defaults to true
}

/**
 * Request payload for updating an existing personality
 */
export interface UpdatePersonalityRequest {
  name?: string;
  description?: string;
  color?: string;
  icon?: string;
  default_policy?: AgentPolicy;
  behavioral_prompt?: string;
  is_active?: boolean;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

/**
 * Standard API response for skill operations
 */
export interface SkillResponse {
  data?: Skill;
  skills?: Skill[];
  error?: string;
}

/**
 * Standard API response for personality operations
 */
export interface PersonalityResponse {
  data?: Personality;
  personalities?: Personality[];
  error?: string;
}
