'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

interface TournamentCreatorProps {
  onCreated?: (id: string, tournament: { name: string; entryFee: number }) => void;
}

export function TournamentCreator({ onCreated }: TournamentCreatorProps) {
  const [name, setName] = useState('');
  const [entryFee, setEntryFee] = useState('0.10');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    setCreating(true);
    setError('');

    try {
      const res = await fetch('/api/tournaments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), entry_fee: parseFloat(entryFee) || 0 }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text.startsWith('{') ? JSON.parse(text).error : `Server error (${res.status})`);
      }

      const json = await res.json();
      if (json.success && json.data) {
        const createdName = name.trim();
        const createdFee = parseFloat(entryFee) || 0;
        setName('');
        onCreated?.(json.data.id, { name: createdName, entryFee: createdFee });
      } else {
        setError(json.error || 'Failed to create');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Card>
      <h3 className="text-sm font-bold text-neutral-200 uppercase tracking-wider mb-4">
        Create Tournament
      </h3>

      <div className="space-y-3">
        <div>
          <label className="block text-xs text-neutral-500 uppercase tracking-wider mb-1">
            Tournament Name
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g., The Grand Draft"
            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-sm text-neutral-200 focus:border-cyber-500 focus:outline-none"
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
          />
        </div>

        <div>
          <label className="block text-xs text-neutral-500 uppercase tracking-wider mb-1">
            Entry Fee (USDC)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={entryFee}
            onChange={e => setEntryFee(e.target.value)}
            placeholder="0.10"
            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-sm text-neutral-200 focus:border-cyber-500 focus:outline-none"
          />
          <p className="text-[10px] text-neutral-600 mt-1">
            Set to 0 for a free tournament. Fees form the winner prize pool.
          </p>
        </div>

        <p className="text-[10px] text-neutral-500">
          Draft 3 agents per team. 10 arena rounds. Score = real balance delta.
        </p>

        {error && (
          <p className="text-xs text-red-400">{error}</p>
        )}

        <Button onClick={handleCreate} loading={creating} disabled={!name.trim()}>
          Create Tournament
        </Button>
      </div>
    </Card>
  );
}
