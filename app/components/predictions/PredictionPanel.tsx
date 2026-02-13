'use client';

import { useEffect, useState, useCallback, CSSProperties } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { AgentAvatar } from '@/components/ui/AgentAvatar';

interface PredictionQuestion {
  id: string;
  text: string;
  type: 'multiple_choice' | 'yes_no';
  options: string[];
  correctAnswer?: string;
}

interface PredictionRound {
  id: string;
  roundNumber: number;
  questions: PredictionQuestion[];
  status: 'OPEN' | 'LOCKED' | 'SCORED';
}

interface PredictionPanelProps {
  userWallet?: string;
  arenaStatus: string;
  compact?: boolean;
}

// Color themes per question — gives each card a distinct personality
interface CardTheme {
  color: string;       // primary hex (e.g. #8b5cf6)
  colorMuted: string;  // dark bg variant
  label: string;       // for debugging
}

const CARD_THEMES: CardTheme[] = [
  { color: '#8b5cf6', colorMuted: '#1a0e3a', label: 'violet' },   // violet
  { color: '#f59e0b', colorMuted: '#2a1a04', label: 'amber' },    // amber
  { color: '#06b6d4', colorMuted: '#042f38', label: 'cyan' },     // cyan
  { color: '#f43f5e', colorMuted: '#2a0a14', label: 'rose' },     // rose
  { color: '#10b981', colorMuted: '#04231a', label: 'emerald' },  // emerald
];

// Question category icons
function getQuestionIcon(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('agent') && lower.includes('win')) return '\u{1F3C6}';
  if (lower.includes('revenue') || lower.includes('$')) return '\u{1F4B0}';
  if (lower.includes('brain') || lower.includes('wakeup')) return '\u{1F9E0}';
  if (lower.includes('task type') || lower.includes('most bids')) return '\u{1F3AF}';
  if (lower.includes('balance') && lower.includes('increase')) return '\u{1F4C8}';
  if (lower.includes('balance') && lower.includes('decrease')) return '\u{1F4C9}';
  if (lower.includes('balance')) return '\u{1F4CA}';
  return '\u{1F52E}';
}

// Does this question have agent names as options?
function isAgentQuestion(text: string): boolean {
  const lower = text.toLowerCase();
  return (lower.includes('agent') && lower.includes('win')) ||
         (lower.includes('balance') && (lower.includes('increase') || lower.includes('decrease')));
}

function cardStyle(theme: CardTheme, state: 'default' | 'selected' | 'correct' | 'wrong'): CSSProperties {
  if (state === 'correct') {
    return { borderColor: '#10b98160', backgroundColor: '#064e3b20' };
  }
  if (state === 'wrong') {
    return { borderColor: '#ef444460', backgroundColor: '#450a0a20' };
  }
  if (state === 'selected') {
    return { borderColor: theme.color + '50', backgroundColor: theme.colorMuted + '40' };
  }
  return {};
}

function optionStyle(theme: CardTheme, state: 'default' | 'selected' | 'correct' | 'wrong'): CSSProperties {
  if (state === 'correct') {
    return { borderColor: '#10b981', backgroundColor: '#10b98120', color: '#6ee7b7' };
  }
  if (state === 'wrong') {
    return { borderColor: '#ef4444', backgroundColor: '#ef444420', color: '#fca5a5', textDecoration: 'line-through' };
  }
  if (state === 'selected') {
    return { borderColor: theme.color, backgroundColor: theme.color + '18', color: theme.color };
  }
  return {};
}

/**
 * Prediction panel with color-themed betting cards.
 */
export function PredictionPanel({ userWallet, arenaStatus, compact = false }: PredictionPanelProps) {
  const [round, setRound] = useState<PredictionRound | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchCurrentRound = useCallback(async () => {
    try {
      const res = await fetch('/api/predictions/current');
      const json = await res.json();
      if (json.success && json.data) {
        setRound(json.data);
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCurrentRound();
  }, [fetchCurrentRound]);

  useEffect(() => {
    if (arenaStatus === 'IDLE') {
      fetchCurrentRound();
      setSubmitted(false);
      setAnswers({});
    }
  }, [arenaStatus, fetchCurrentRound]);

  const handleAnswer = (questionId: string, answer: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: answer }));
  };

  const handleSubmit = async () => {
    if (!round || !userWallet || submitted) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/predictions/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prediction_round_id: round.id,
          user_wallet: userWallet,
          answers,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setSubmitted(true);
      }
    } catch {
      // Ignore
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="py-4">
        <div className="text-xs text-neutral-500 animate-pulse">Loading predictions...</div>
      </div>
    );
  }

  if (!round || round.questions.length === 0) return null;

  const displayQuestions = compact ? round.questions.slice(0, 3) : round.questions;
  const allAnswered = round.questions.every(q => answers[q.id]);
  const isOpen = round.status === 'OPEN';
  const isScored = round.status === 'SCORED';
  const answeredCount = Object.keys(answers).length;

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">{'\u{1F52E}'}</span>
            <h2 className="text-sm font-bold text-neutral-100 uppercase tracking-wider">
              Predict Round {round.roundNumber}
            </h2>
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-bold border ${
            isOpen ? 'text-cyber-400 bg-cyber-900/40 border-cyber-700/40' :
            isScored ? 'text-emerald-400 bg-emerald-900/40 border-emerald-700/40' :
            'text-amber-400 bg-amber-900/40 border-amber-700/40'
          }`}>
            {round.status}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Progress dots */}
          {isOpen && !submitted && (
            <div className="flex items-center gap-1.5">
              {round.questions.map((q, i) => (
                <div
                  key={q.id}
                  className="w-2 h-2 rounded-full transition-all duration-300"
                  style={{
                    backgroundColor: answers[q.id]
                      ? CARD_THEMES[i % CARD_THEMES.length].color
                      : '#404040',
                    boxShadow: answers[q.id]
                      ? `0 0 6px ${CARD_THEMES[i % CARD_THEMES.length].color}60`
                      : 'none',
                  }}
                />
              ))}
              <span className="text-[10px] text-neutral-500 ml-1">
                {answeredCount}/{round.questions.length}
              </span>
            </div>
          )}

          {isOpen && !submitted && userWallet && (
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!allAnswered || submitting}
              loading={submitting}
            >
              Lock In
            </Button>
          )}

          {submitted && !isScored && (
            <span className="text-[10px] text-cyber-400 uppercase tracking-wider animate-pulse">
              Locked in — waiting for results...
            </span>
          )}
        </div>
      </div>

      {/* Betting cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {displayQuestions.map((q, idx) => {
          const theme = CARD_THEMES[idx % CARD_THEMES.length];
          const isSelected = !!answers[q.id];
          const isCorrect = isScored && q.correctAnswer === answers[q.id];
          const isWrong = isScored && answers[q.id] && q.correctAnswer !== answers[q.id];
          const icon = getQuestionIcon(q.text);

          const state = isCorrect ? 'correct' : isWrong ? 'wrong' : isSelected ? 'selected' : 'default';

          return (
            <div
              key={q.id}
              className="relative rounded-xl border border-neutral-800 bg-surface p-4 transition-all duration-200 hover:border-neutral-700"
              style={cardStyle(theme, state)}
            >
              {/* Subtle top accent line */}
              <div
                className="absolute top-0 left-4 right-4 h-px"
                style={{ backgroundColor: theme.color + '30' }}
              />

              {/* Result badge */}
              {isScored && (
                <div
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{
                    backgroundColor: isCorrect ? '#10b981' : isWrong ? '#ef4444' : '#525252',
                    color: '#0d0d0d',
                    boxShadow: isCorrect ? '0 2px 8px #10b98140' : isWrong ? '0 2px 8px #ef444440' : 'none',
                  }}
                >
                  {isCorrect ? '\u2713' : isWrong ? '\u2717' : '-'}
                </div>
              )}

              {/* Question header with icon */}
              <div className="flex items-start gap-2.5 mb-3">
                <span className="text-xl leading-none mt-0.5 flex-shrink-0">{icon}</span>
                <p className="text-[13px] text-neutral-200 leading-relaxed font-medium">
                  {q.text}
                </p>
              </div>

              {/* Options */}
              <div className="flex flex-wrap gap-2">
                {q.options.map(opt => {
                  const optSelected = answers[q.id] === opt;
                  const optCorrect = isScored && q.correctAnswer === opt;
                  const optWrong = isScored && optSelected && q.correctAnswer !== opt;

                  const optState = optCorrect ? 'correct' : optWrong ? 'wrong' : optSelected ? 'selected' : 'default';

                  return (
                    <button
                      key={opt}
                      onClick={() => isOpen && !submitted && handleAnswer(q.id, opt)}
                      disabled={!isOpen || submitted}
                      className={`px-3 py-1.5 text-[11px] font-semibold rounded-lg border border-neutral-700 text-neutral-400 transition-all duration-150 hover:border-neutral-500 hover:text-neutral-200 ${
                        (!isOpen || submitted) ? 'cursor-default' : 'cursor-pointer active:scale-95'
                      }`}
                      style={optionStyle(theme, optState)}
                    >
                      {q.type === 'yes_no' && opt === 'Yes' && <span className="mr-1">{'\u{1F44D}'}</span>}
                      {q.type === 'yes_no' && opt === 'No' && <span className="mr-1">{'\u{1F44E}'}</span>}
                      {isAgentQuestion(q.text) && <AgentAvatar name={opt} size={16} className="mr-1 inline-block -mt-px" />}
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Connect wallet prompt */}
      {!userWallet && isOpen && (
        <div className="mt-4 text-center">
          <p className="text-xs text-neutral-500">
            Connect wallet to make predictions
          </p>
        </div>
      )}

      {compact && (
        <Link
          href="/arena"
          className="block mt-3 text-xs text-cyber-500 hover:text-cyber-400 font-medium uppercase tracking-wider transition-colors"
        >
          More Predictions in Arena &rarr;
        </Link>
      )}
    </div>
  );
}
