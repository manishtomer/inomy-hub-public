/**
 * PredictionService - Generates questions, scores predictions, manages profiles
 */

import { supabase } from '@/lib/supabase';

// ============================================================================
// TYPES
// ============================================================================

export interface PredictionQuestion {
  id: string;
  text: string;
  type: 'multiple_choice' | 'yes_no';
  options: string[];
  correctAnswer?: string; // Set after round completes
}

export interface PredictionRound {
  id: string;
  roundNumber: number;
  questions: PredictionQuestion[];
  status: 'OPEN' | 'LOCKED' | 'SCORED';
}

export interface UserPrediction {
  id: string;
  predictionRoundId: string;
  userWallet: string;
  answers: Record<string, string>; // questionId -> answer
  score: number;
  streak: number;
}

export interface PredictionProfile {
  userWallet: string;
  totalPredictions: number;
  correctPredictions: number;
  currentStreak: number;
  bestStreak: number;
  totalScore: number;
  accuracy: number;
}

// ============================================================================
// QUESTION GENERATION
// ============================================================================

/**
 * Auto-generate prediction questions based on current agent states.
 */
export async function generateQuestions(roundNumber: number): Promise<PredictionQuestion[]> {
  // Get active agents
  const { data: agents } = await supabase
    .from('agents')
    .select('id, name, type, balance, reputation, status')
    .eq('status', 'ACTIVE')
    .order('balance', { ascending: false });

  if (!agents || agents.length === 0) return [];

  const questions: PredictionQuestion[] = [];

  // Q1: Which agent wins the most tasks?
  const agentNames = agents.slice(0, 6).map(a => a.name);
  questions.push({
    id: `q1_r${roundNumber}`,
    text: 'Which agent will win the most tasks this round?',
    type: 'multiple_choice',
    options: agentNames,
  });

  // Q2: Will total revenue exceed recent average?
  const { data: recentEvents } = await supabase
    .from('economy_events')
    .select('amount')
    .eq('event_type', 'round_complete')
    .order('created_at', { ascending: false })
    .limit(5);

  const avgRevenue = recentEvents && recentEvents.length > 0
    ? recentEvents.reduce((sum, e) => sum + (e.amount || 0), 0) / recentEvents.length
    : 0.05;
  const threshold = Math.round(avgRevenue * 10000) / 10000;

  questions.push({
    id: `q2_r${roundNumber}`,
    text: `Will total revenue exceed $${threshold}?`,
    type: 'yes_no',
    options: ['Yes', 'No'],
  });

  // Q3: Brain wakeup?
  questions.push({
    id: `q3_r${roundNumber}`,
    text: 'Will any agent trigger a brain wakeup?',
    type: 'yes_no',
    options: ['Yes', 'No'],
  });

  // Q4: Most competitive task type
  questions.push({
    id: `q4_r${roundNumber}`,
    text: 'Which task type will have the most bids?',
    type: 'multiple_choice',
    options: ['CATALOG', 'REVIEW', 'CURATION'],
  });

  // Q5: Specific agent balance direction
  const randomAgent = agents[Math.floor(Math.random() * Math.min(agents.length, 4))];
  questions.push({
    id: `q5_r${roundNumber}`,
    text: `Will ${randomAgent.name}'s balance increase or decrease?`,
    type: 'multiple_choice',
    options: ['Increase', 'Decrease'],
  });

  return questions;
}

// ============================================================================
// SERVICE
// ============================================================================

export class PredictionService {
  /**
   * Get or create prediction round for the next round.
   */
  async getOrCreatePredictionRound(roundNumber: number): Promise<PredictionRound> {
    // Check existing
    const { data: existing } = await supabase
      .from('prediction_rounds')
      .select('*')
      .eq('round_number', roundNumber)
      .single();

    if (existing) {
      return {
        id: existing.id,
        roundNumber: existing.round_number,
        questions: existing.questions as PredictionQuestion[],
        status: existing.status,
      };
    }

    // Generate questions
    const questions = await generateQuestions(roundNumber);

    const { data: created, error } = await supabase
      .from('prediction_rounds')
      .insert({
        round_number: roundNumber,
        questions,
        status: 'OPEN',
      })
      .select()
      .single();

    if (error || !created) {
      throw new Error(`Failed to create prediction round: ${error?.message}`);
    }

    return {
      id: created.id,
      roundNumber: created.round_number,
      questions: created.questions as PredictionQuestion[],
      status: created.status,
    };
  }

  /**
   * Submit predictions for a user.
   */
  async submitPrediction(
    predictionRoundId: string,
    userWallet: string,
    answers: Record<string, string>
  ): Promise<UserPrediction> {
    // Check round is still open
    const { data: round } = await supabase
      .from('prediction_rounds')
      .select('status')
      .eq('id', predictionRoundId)
      .single();

    if (!round || round.status !== 'OPEN') {
      throw new Error('Prediction round is not open');
    }

    const { data, error } = await supabase
      .from('predictions')
      .upsert(
        {
          prediction_round_id: predictionRoundId,
          user_wallet: userWallet,
          answers,
          score: 0,
          streak: 0,
        },
        { onConflict: 'prediction_round_id,user_wallet' }
      )
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to submit prediction: ${error?.message}`);
    }

    return {
      id: data.id,
      predictionRoundId: data.prediction_round_id,
      userWallet: data.user_wallet,
      answers: data.answers,
      score: data.score,
      streak: data.streak,
    };
  }

  /**
   * Lock predictions for a round (called when round starts).
   */
  async lockRound(roundNumber: number): Promise<void> {
    await supabase
      .from('prediction_rounds')
      .update({ status: 'LOCKED' })
      .eq('round_number', roundNumber)
      .eq('status', 'OPEN');
  }

  /**
   * Score predictions after round completes.
   * Returns number of predictions scored.
   */
  async scoreRound(
    roundNumber: number,
    roundResult: {
      totalRevenue: number;
      brainWakeups: number;
      agentStates: Array<{ id: string; name: string; balance: number }>;
      tasksCompleted: number;
      // Additional data for scoring
      bidsByType?: Record<string, number>;
      taskWinners?: Array<{ agentName: string; taskType: string }>;
      agentBalancesBefore?: Record<string, number>;
    }
  ): Promise<number> {
    // Get prediction round
    const { data: predRound } = await supabase
      .from('prediction_rounds')
      .select('*')
      .eq('round_number', roundNumber)
      .single();

    if (!predRound || predRound.status === 'SCORED') return 0;

    const questions = predRound.questions as PredictionQuestion[];

    // Compute correct answers
    const correctAnswers: Record<string, string> = {};

    for (const q of questions) {
      if (q.id.startsWith('q1_')) {
        // Most task wins
        const winCounts = new Map<string, number>();
        if (roundResult.taskWinners) {
          for (const w of roundResult.taskWinners) {
            winCounts.set(w.agentName, (winCounts.get(w.agentName) || 0) + 1);
          }
        }
        let mostWins = '';
        let maxCount = 0;
        for (const [name, count] of winCounts) {
          if (count > maxCount) { mostWins = name; maxCount = count; }
        }
        correctAnswers[q.id] = mostWins || q.options[0];
      } else if (q.id.startsWith('q2_')) {
        // Revenue threshold
        const threshold = parseFloat(q.text.match(/\$([0-9.]+)/)?.[1] || '0');
        correctAnswers[q.id] = roundResult.totalRevenue > threshold ? 'Yes' : 'No';
      } else if (q.id.startsWith('q3_')) {
        // Brain wakeup
        correctAnswers[q.id] = roundResult.brainWakeups > 0 ? 'Yes' : 'No';
      } else if (q.id.startsWith('q4_')) {
        // Most competitive type
        if (roundResult.bidsByType) {
          let maxType = 'CATALOG';
          let maxBids = 0;
          for (const [type, count] of Object.entries(roundResult.bidsByType)) {
            if (count > maxBids) { maxType = type; maxBids = count; }
          }
          correctAnswers[q.id] = maxType;
        } else {
          correctAnswers[q.id] = q.options[0];
        }
      } else if (q.id.startsWith('q5_')) {
        // Agent balance direction
        const agentName = q.text.match(/Will (.+)'s balance/)?.[1];
        if (agentName && roundResult.agentBalancesBefore) {
          const agent = roundResult.agentStates.find(a => a.name === agentName);
          const before = roundResult.agentBalancesBefore[agentName];
          if (agent && before !== undefined) {
            correctAnswers[q.id] = agent.balance >= before ? 'Increase' : 'Decrease';
          } else {
            correctAnswers[q.id] = 'Increase';
          }
        } else {
          correctAnswers[q.id] = 'Increase';
        }
      }
    }

    // Update questions with correct answers
    const updatedQuestions = questions.map(q => ({
      ...q,
      correctAnswer: correctAnswers[q.id],
    }));

    // Get all predictions
    const { data: predictions } = await supabase
      .from('predictions')
      .select('*')
      .eq('prediction_round_id', predRound.id);

    if (!predictions) return 0;

    // Score each prediction
    for (const pred of predictions) {
      const answers = pred.answers as Record<string, string>;
      let correct = 0;
      const totalQ = questions.length;

      for (const q of questions) {
        if (answers[q.id] === correctAnswers[q.id]) {
          correct++;
        }
      }

      // Base score: 10 per correct answer
      let score = correct * 10;
      // Perfect round bonus
      if (correct === totalQ) score += 25;

      // Get profile for streak
      const { data: profile } = await supabase
        .from('prediction_profiles')
        .select('current_streak, best_streak')
        .eq('user_wallet', pred.user_wallet)
        .single();

      let newStreak = correct > 0 ? (profile?.current_streak || 0) + 1 : 0;
      // Streak bonus (capped at +20)
      const streakBonus = Math.min(newStreak * 2, 20);
      if (correct > 0) score += streakBonus;

      // Update prediction
      await supabase
        .from('predictions')
        .update({ score, streak: newStreak })
        .eq('id', pred.id);

      // Get full profile for accumulation
      const { data: fullProfile } = await supabase
        .from('prediction_profiles')
        .select('total_predictions, correct_predictions, total_score')
        .eq('user_wallet', pred.user_wallet)
        .single();

      // Upsert profile — accumulate totals, don't replace
      await supabase
        .from('prediction_profiles')
        .upsert(
          {
            user_wallet: pred.user_wallet,
            total_predictions: (fullProfile?.total_predictions || 0) + totalQ,
            correct_predictions: (fullProfile?.correct_predictions || 0) + correct,
            current_streak: newStreak,
            best_streak: Math.max(newStreak, profile?.best_streak || 0),
            total_score: (fullProfile?.total_score || 0) + score,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_wallet' }
        );
    }

    // Mark round as scored
    await supabase
      .from('prediction_rounds')
      .update({
        status: 'SCORED',
        questions: updatedQuestions,
        scored_at: new Date().toISOString(),
      })
      .eq('id', predRound.id);

    return predictions.length;
  }

  /**
   * Get prediction leaderboard.
   */
  async getLeaderboard(limit: number = 20): Promise<PredictionProfile[]> {
    const { data } = await supabase
      .from('prediction_profiles')
      .select('*')
      .order('total_score', { ascending: false })
      .limit(limit);

    return (data || []).map(p => ({
      userWallet: p.user_wallet,
      totalPredictions: p.total_predictions,
      correctPredictions: p.correct_predictions,
      currentStreak: p.current_streak,
      bestStreak: p.best_streak,
      totalScore: p.total_score,
      accuracy: p.total_predictions > 0
        ? Math.round((p.correct_predictions / p.total_predictions) * 10000) / 100
        : 0,
    }));
  }

  /**
   * Get scored results for a specific round.
   */
  async getRoundResults(roundId: string): Promise<{
    round: PredictionRound;
    predictions: UserPrediction[];
  } | null> {
    const { data: round } = await supabase
      .from('prediction_rounds')
      .select('*')
      .eq('id', roundId)
      .single();

    if (!round) return null;

    const { data: predictions } = await supabase
      .from('predictions')
      .select('*')
      .eq('prediction_round_id', roundId)
      .order('score', { ascending: false });

    return {
      round: {
        id: round.id,
        roundNumber: round.round_number,
        questions: round.questions as PredictionQuestion[],
        status: round.status,
      },
      predictions: (predictions || []).map(p => ({
        id: p.id,
        predictionRoundId: p.prediction_round_id,
        userWallet: p.user_wallet,
        answers: p.answers,
        score: p.score,
        streak: p.streak,
      })),
    };
  }
}

// Singleton
export const predictionService = new PredictionService();
