'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

interface ExitButtonProps {
  holdingId: string;
  agentName: string;
  tokenBalance: number;
  onSuccess?: () => void;
  size?: 'sm' | 'md' | 'lg';
}

export function ExitButton({
  holdingId,
  agentName,
  tokenBalance,
  onSuccess,
  size = 'sm',
}: ExitButtonProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExit = async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch(`/api/holdings/${holdingId}`, {
        method: 'DELETE',
      });

      const json = await res.json();

      if (json.success) {
        setShowConfirm(false);
        onSuccess?.();
      } else {
        setError(json.error || 'Exit failed');
      }
    } catch (err) {
      setError('Network error');
      console.error('Exit error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        variant="danger"
        size={size}
        onClick={() => setShowConfirm(true)}
      >
        Exit
      </Button>

      <Modal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        title="Exit Investment"
        size="sm"
      >
        <div className="space-y-4">
          <div className="text-neutral-300 text-sm">
            Are you sure you want to exit your investment in{' '}
            <span className="font-medium text-neutral-100">{agentName}</span>?
          </div>

          <div className="bg-elevated border border-neutral-800 rounded p-3">
            <div className="text-xs text-neutral-500 mb-1">You will sell:</div>
            <div className="font-mono text-lg text-neutral-200">
              {tokenBalance.toFixed(2)}{' '}
              <span className="text-sm text-neutral-500">tokens</span>
            </div>
          </div>

          {error && (
            <div className="text-red-500 text-sm font-mono border border-red-900/50 bg-red-900/20 rounded p-3">
              ERROR: {error}
            </div>
          )}

          <div className="flex gap-3">
            <Button
              variant="secondary"
              fullWidth
              onClick={() => setShowConfirm(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              fullWidth
              onClick={handleExit}
              loading={loading}
              disabled={loading}
            >
              {loading ? 'Processing...' : 'Confirm Exit'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
