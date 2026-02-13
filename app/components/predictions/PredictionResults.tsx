'use client';

import { Card } from '@/components/ui/Card';

interface PredictionQuestion {
  id: string;
  text: string;
  type: string;
  options: string[];
  correctAnswer?: string;
}

interface PredictionResultsProps {
  questions: PredictionQuestion[];
  userAnswers: Record<string, string>;
  score: number;
  streak: number;
}

export function PredictionResults({
  questions,
  userAnswers,
  score,
  streak,
}: PredictionResultsProps) {
  const correct = questions.filter(q => userAnswers[q.id] === q.correctAnswer).length;
  const total = questions.length;
  const isPerfect = correct === total;

  return (
    <Card className={isPerfect ? 'border-amber-500/50' : 'border-emerald-800/30'}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-bold text-neutral-200 uppercase tracking-wider">
          Results
        </h4>
        <div className="flex items-center gap-3">
          <span className="text-xs text-neutral-400">
            {correct}/{total} correct
          </span>
          <span className="text-sm font-bold text-cyber-500">+{score} pts</span>
          {streak > 1 && (
            <span className="text-[10px] text-amber-500 bg-amber-900/30 px-1.5 py-0.5 rounded">
              {streak} streak
            </span>
          )}
        </div>
      </div>

      {isPerfect && (
        <div className="mb-3 text-center py-2 bg-amber-900/10 border border-amber-800/30 rounded">
          <span className="text-sm text-amber-400 font-medium uppercase tracking-wider">
            Perfect Round! +25 bonus
          </span>
        </div>
      )}

      <div className="space-y-2">
        {questions.map((q) => {
          const userAnswer = userAnswers[q.id];
          const isCorrect = userAnswer === q.correctAnswer;

          return (
            <div key={q.id} className="flex items-start gap-2 text-xs">
              <span className={`mt-0.5 ${isCorrect ? 'text-emerald-500' : 'text-red-400'}`}>
                {isCorrect ? '+' : 'x'}
              </span>
              <div className="flex-1">
                <span className="text-neutral-400">{q.text}</span>
                <div className="mt-0.5">
                  {!isCorrect && userAnswer && (
                    <span className="text-red-400 line-through mr-2">{userAnswer}</span>
                  )}
                  <span className="text-emerald-500">{q.correctAnswer}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
