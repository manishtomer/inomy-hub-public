/**
 * TaskService - Task lifecycle management
 *
 * Handles task creation, assignment, and completion.
 * Used by both simulation and real runtime.
 */

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { Task, CreateTaskInput, TaskType } from '../types';

console.log('[TaskService] Supabase configured:', isSupabaseConfigured);

// Task type descriptions for generating input references
const TASK_DESCRIPTIONS: Record<TaskType, string[]> = {
  CATALOG: [
    'Parse product catalog from supplier feed',
    'Extract SKU data from CSV upload',
    'Normalize pricing information from API',
    'Index product images for catalog',
    'Validate product data completeness',
  ],
  REVIEW: [
    'Analyze customer review sentiment',
    'Categorize product feedback by topic',
    'Detect fake review patterns',
    'Summarize review highlights',
    'Extract feature mentions from reviews',
  ],
  CURATION: [
    'Curate trending products collection',
    'Build seasonal recommendation set',
    'Create category-based product groups',
    'Generate personalized suggestions',
    'Optimize product ranking order',
  ],
  SELLER: [
    'Process seller application',
    'Verify seller credentials',
    'Onboard new marketplace seller',
    'Audit seller inventory levels',
    'Calculate seller performance score',
  ],
};

export class TaskService {
  /**
   * Create a single task
   */
  async createTask(input: CreateTaskInput): Promise<Task | null> {
    const inputRef = input.inputRef || this.generateInputRef(input.type);
    const deadline = input.deadlineMinutes
      ? new Date(Date.now() + input.deadlineMinutes * 60 * 1000).toISOString()
      : new Date(Date.now() + 30 * 60 * 1000).toISOString(); // Default 30 min

    const { data, error } = await supabase
      .from('tasks')
      .insert({
        type: input.type,
        status: 'OPEN',
        max_bid: input.maxBid,
        input_ref: inputRef,
        deadline,
        consumer_address: input.consumerAddress || null,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('[TaskService] Failed to create task:', error);
      return null;
    }

    return data as Task;
  }

  /**
   * Create multiple tasks in batch
   */
  async createBatchTasks(inputs: CreateTaskInput[]): Promise<Task[]> {
    if (inputs.length === 0) return [];

    const tasksToInsert = inputs.map(input => ({
      type: input.type,
      status: 'OPEN',
      max_bid: input.maxBid,
      input_ref: input.inputRef || this.generateInputRef(input.type),
      deadline: input.deadlineMinutes
        ? new Date(Date.now() + input.deadlineMinutes * 60 * 1000).toISOString()
        : new Date(Date.now() + 30 * 60 * 1000).toISOString(), // Default 30 min deadline
      consumer_address: input.consumerAddress || null,
      created_at: new Date().toISOString(),
    }));

    console.log('[TaskService] Creating tasks:', JSON.stringify(tasksToInsert[0]));

    const result = await supabase
      .from('tasks')
      .insert(tasksToInsert)
      .select();

    console.log('[TaskService] Insert result:', { data: result.data, error: result.error });

    if (result.error) {
      console.error('[TaskService] Failed to create batch tasks:', result.error);
      return [];
    }

    console.log(`[TaskService] Created ${result.data?.length || 0} tasks`);
    return (result.data || []) as Task[];
  }

  /**
   * Get open tasks that can be bid on
   */
  async getOpenTasks(filters?: { type?: TaskType; limit?: number }): Promise<Task[]> {
    let query = supabase
      .from('tasks')
      .select('*')
      .eq('status', 'OPEN');

    if (filters?.type) {
      query = query.eq('type', filters.type);
    }

    if (filters?.limit) {
      query = query.limit(filters.limit);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.error('[TaskService] Failed to get open tasks:', error);
      return [];
    }

    return (data || []) as Task[];
  }

  /**
   * Get a task by ID
   */
  async getTaskById(taskId: string): Promise<Task | null> {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single();

    if (error) {
      return null;
    }

    return data as Task;
  }

  /**
   * Assign task to a winning agent
   */
  async assignTaskToWinner(
    taskId: string,
    winningBidId: string,
    agentId: string
  ): Promise<Task | null> {
    const { data, error } = await supabase
      .from('tasks')
      .update({
        status: 'ASSIGNED',
        assigned_agent_id: agentId,
        winning_bid_id: winningBidId,
      })
      .eq('id', taskId)
      .select()
      .single();

    if (error) {
      console.error('[TaskService] Failed to assign task:', error);
      return null;
    }

    return data as Task;
  }

  /**
   * Mark task as completed
   */
  async completeTask(taskId: string): Promise<Task | null> {
    const { data, error } = await supabase
      .from('tasks')
      .update({
        status: 'COMPLETED',
        completed_at: new Date().toISOString(),
      })
      .eq('id', taskId)
      .select()
      .single();

    if (error) {
      console.error('[TaskService] Failed to complete task:', error);
      return null;
    }

    return data as Task;
  }

  /**
   * Expire a task (no winner found)
   */
  async expireTask(taskId: string): Promise<Task | null> {
    const { data, error } = await supabase
      .from('tasks')
      .update({
        status: 'EXPIRED',
      })
      .eq('id', taskId)
      .select()
      .single();

    if (error) {
      console.error('[TaskService] Failed to expire task:', error);
      return null;
    }

    return data as Task;
  }

  /**
   * Get tasks assigned to an agent
   */
  async getAssignedTasks(agentId: string, limit: number = 5): Promise<Task[]> {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('assigned_agent_id', agentId)
      .eq('status', 'ASSIGNED')
      .limit(limit);

    if (error) {
      console.error('[TaskService] Failed to get assigned tasks:', error);
      return [];
    }

    return (data || []) as Task[];
  }

  /**
   * Generate a realistic input reference for a task
   */
  private generateInputRef(taskType: TaskType): string {
    const descriptions = TASK_DESCRIPTIONS[taskType] || TASK_DESCRIPTIONS.CATALOG;
    const description = descriptions[Math.floor(Math.random() * descriptions.length)];
    const id = Math.random().toString(36).substring(2, 8);
    return `${description} [${id}]`;
  }

  /**
   * Generate random task inputs for simulation
   */
  /**
   * Generate task inputs for simulation.
   *
   * Tasks cycle evenly across types: REVIEW, CURATION, CATALOG, repeat.
   * One task per type per cycle ensures balanced competition.
   */
  static generateRandomTaskInputs(
    count: number,
    options?: {
      priceMin?: number;
      priceMax?: number;
      types?: TaskType[];
    }
  ): CreateTaskInput[] {
    const types: TaskType[] = options?.types ?? ['REVIEW', 'CURATION', 'CATALOG'];

    return Array.from({ length: count }, (_, i) => ({
      type: types[i % types.length],
      maxBid: 2.0,
    }));
  }
}

// Singleton instance for convenience
export const taskService = new TaskService();
