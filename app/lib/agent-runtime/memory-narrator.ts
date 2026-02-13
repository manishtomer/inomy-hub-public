/**
 * Memory Narrator - LLM-powered narrative generation
 *
 * Generates natural language narratives for memory entries using Gemini.
 * - Industry narratives: Market observer perspective (objective, analytical)
 * - Personal narratives: First-person journal entries (reflective, learning-focused)
 *
 * Created: 2026-02-06
 */

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import type { IndustryEventType, PersonalMemoryType, MemoryContext } from './memory-types';
import { getModelForActivity } from '@/lib/llm-config';

// Initialize Gemini client with proper error handling
const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.warn('[Memory Narrator] GOOGLE_API_KEY not set - memory narratives will use fallback mode');
}

const genAI = new GoogleGenerativeAI(apiKey || '');

/** Lazily create model using the per-activity configured LLM */
async function getModel(): Promise<GenerativeModel> {
  const modelName = await getModelForActivity('narrator');
  return genAI.getGenerativeModel({ model: modelName });
}

/**
 * Generate narrative for industry events
 * Voice: Objective market observer
 * Style: 2-3 sentences, analytical, focused on implications
 */
export async function generateIndustryNarrative(
  eventType: IndustryEventType,
  data: Record<string, unknown>,
  roundNumber: number
): Promise<string> {
  const prompt = `You are the market observer for an AI agent economy. Write a brief narrative (2-3 sentences) describing this market event for agents to read later.

Event Type: ${eventType}
Round: ${roundNumber}
Data: ${JSON.stringify(data, null, 2)}

Write from an objective market observer perspective. Be concise but insightful.
Focus on what agents should know and potential implications for their strategies.

Example style:
"Round 47: Market crash. Three agents died this round - Catalog-3, Review-7, and Seller-2. All had been operating on thin margins. The survivors are now more cautious, and average bids have dropped 30%."

Your narrative:`;

  try {
    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY not configured');
    }
    const model = await getModel();
    const result = await model.generateContent(prompt);
    const narrative = result.response.text().trim();
    return narrative || `Round ${roundNumber}: ${eventType} occurred. ${JSON.stringify(data)}`;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes('not configured')) {
      console.warn(`[Memory Narrator] API key not set - using fallback narrative for ${eventType}`);
    } else {
      console.error('[Memory Narrator] Failed to generate industry narrative:', errorMsg);
    }
    // Fallback to basic narrative
    return `Round ${roundNumber}: ${eventType} event. ${Object.entries(data).map(([k, v]) => `${k}: ${v}`).join(', ')}`;
  }
}

/**
 * Generate narrative for personal memories
 * Voice: First-person (the agent writing in their journal)
 * Style: 2-4 sentences, reflective, learning-focused
 */
export async function generatePersonalNarrative(
  memoryType: PersonalMemoryType,
  data: Record<string, unknown>,
  context: MemoryContext,
  roundNumber: number
): Promise<string> {
  const prompt = `You are ${context.identity.name}, a ${context.identity.type} agent with a ${context.identity.personality} personality.

Write a brief journal entry (2-4 sentences) about this experience.
Write in first person. Reflect on what happened and what you learned.

Event type: ${memoryType}
Round: ${roundNumber}
What happened: ${JSON.stringify(data, null, 2)}
Your current state:
- Balance: $${context.balance.toFixed(3)}
- Reputation: ${context.reputation}

Include:
1. What happened (the facts)
2. How it affects you (the impact)
3. What you learned or will do differently (the insight)

Example style:
"Round 23: I bid $0.08 on task X (catalog extraction for electronics category), but lost to Catalog-3 who bid $0.06. I was aiming for 15% margin, but the market clearly expects lower. I need to adjust my target margin from 15% to 10%, or focus on specialized tasks where I have reputation advantage."

Your journal entry:`;

  try {
    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY not configured');
    }
    const model = await getModel();
    const result = await model.generateContent(prompt);
    const narrative = result.response.text().trim();
    return narrative || `Round ${roundNumber}: ${memoryType} - ${JSON.stringify(data)}`;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes('not configured')) {
      console.warn(`[Memory Narrator] API key not set - using fallback narrative for ${memoryType}`);
    } else {
      console.error('[Memory Narrator] Failed to generate personal narrative:', errorMsg);
    }
    // Fallback to basic narrative
    return `Round ${roundNumber}: I experienced a ${memoryType} event. ${Object.entries(data).map(([k, v]) => `${k}: ${v}`).join(', ')}`;
  }
}
