'use client';

import { useState, useEffect } from 'react';
import { useWallets } from '@privy-io/react-auth';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import {
  createPublicClient,
  createWalletClient,
  custom,
  parseEther,
  formatEther,
  type Address,
} from 'viem';
import { monadTestnet, getExplorerTxUrl } from '@/lib/contracts';
import { NAD_CONTRACTS, lensAbi, routerSellAbi, erc20ApproveAbi } from '@/lib/nadfun-client';

interface SellModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  agentId: string;
  agentName: string;
  tokenSymbol: string | null;
  tokenAddress: string;
  tokenBalance: number;
}

export function SellModal({
  isOpen,
  onClose,
  onSuccess,
  agentId,
  agentName,
  tokenSymbol,
  tokenAddress,
  tokenBalance,
}: SellModalProps) {
  const { wallets } = useWallets();

  const [sellAmount, setSellAmount] = useState('');
  const [estimatedRefund, setEstimatedRefund] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<'approve' | 'sell' | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  const connectedWallet = wallets.find(w => w.walletClientType !== 'privy');
  const walletAddress = connectedWallet?.address;

  // Calculate estimated refund when amount changes
  useEffect(() => {
    if (!tokenAddress || !sellAmount) {
      setEstimatedRefund(null);
      return;
    }

    const sellAmountNum = parseFloat(sellAmount);
    if (isNaN(sellAmountNum) || sellAmountNum <= 0 || sellAmountNum > tokenBalance) {
      setEstimatedRefund(null);
      return;
    }

    const estimateRefund = async () => {
      try {
        setEstimating(true);
        const publicClient = createPublicClient({
          chain: monadTestnet,
          transport: custom(window.ethereum),
        });

        const tokenAmountWei = parseEther(sellAmount);

        // Use nad.fun Lens for quote (isBuy=false for sells)
        const [, amountOut] = await publicClient.readContract({
          address: NAD_CONTRACTS.LENS,
          abi: lensAbi,
          functionName: 'getAmountOut',
          args: [tokenAddress as Address, tokenAmountWei, false],
        });

        setEstimatedRefund(formatEther(amountOut));
      } catch (err) {
        console.error('Error estimating refund:', err);
        setEstimatedRefund(null);
      } finally {
        setEstimating(false);
      }
    };

    const debounceTimer = setTimeout(estimateRefund, 300);
    return () => clearTimeout(debounceTimer);
  }, [sellAmount, tokenAddress, tokenBalance]);

  const handleSell = async () => {
    if (!tokenAddress || !connectedWallet || !walletAddress) {
      setError('Please connect your wallet');
      return;
    }

    const sellAmountNum = parseFloat(sellAmount);
    if (isNaN(sellAmountNum) || sellAmountNum <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    if (sellAmountNum > tokenBalance) {
      setError('Insufficient token balance');
      return;
    }

    try {
      setLoading(true);
      setLoadingStep('approve');
      setError(null);

      const provider = await connectedWallet.getEthereumProvider();

      const walletClient = createWalletClient({
        chain: monadTestnet,
        transport: custom(provider),
      });

      const publicClient = createPublicClient({
        chain: monadTestnet,
        transport: custom(provider),
      });

      const tokenAmountWei = parseEther(sellAmount);

      // Calculate minimum refund (with 5% slippage tolerance)
      let amountOutMin = 0n;
      if (estimatedRefund) {
        const estimated = parseEther(estimatedRefund);
        amountOutMin = (estimated * 95n) / 100n;
      }

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300); // 5 minutes

      // Step 1: Approve router to spend tokens
      const approveHash = await walletClient.writeContract({
        address: tokenAddress as Address,
        abi: erc20ApproveAbi,
        functionName: 'approve',
        args: [NAD_CONTRACTS.BONDING_CURVE_ROUTER, tokenAmountWei],
        account: walletAddress as Address,
      });

      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      // Step 2: Sell via nad.fun BondingCurveRouter
      setLoadingStep('sell');

      const hash = await walletClient.writeContract({
        address: NAD_CONTRACTS.BONDING_CURVE_ROUTER,
        abi: routerSellAbi,
        functionName: 'sell',
        args: [{
          amountIn: tokenAmountWei,
          amountOutMin,
          token: tokenAddress as Address,
          to: walletAddress as Address,
          deadline,
        }],
        account: walletAddress as Address,
      });

      setTxHash(hash);

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === 'success') {
        // Record the sale in the database
        try {
          await fetch('/api/investments/record-sale', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              investor_wallet: walletAddress,
              agent_id: agentId,
              token_amount: sellAmount,
              mon_amount: estimatedRefund || '0',
              tx_hash: hash,
              block_number: Number(receipt.blockNumber),
            }),
          });
        } catch (recordErr) {
          console.warn('Failed to record sale:', recordErr);
        }

        setSuccess(true);
        setTimeout(() => {
          onSuccess?.();
          onClose();
          setSuccess(false);
          setSellAmount('');
          setError(null);
          setTxHash(null);
        }, 2000);
      } else {
        setError('Transaction failed');
      }
    } catch (err) {
      console.error('Sell error:', err);
      setError(err instanceof Error ? err.message : 'Transaction failed');
    } finally {
      setLoading(false);
      setLoadingStep(null);
    }
  };

  const setMaxAmount = () => {
    setSellAmount(tokenBalance.toString());
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Sell Tokens" size="md">
      {success ? (
        <div className="text-center py-8">
          <div className="text-emerald-500 text-4xl mb-4">✓</div>
          <div className="text-lg text-neutral-200 mb-2">Sale Successful!</div>
          <div className="text-sm text-neutral-500 mb-2">
            You sold {sellAmount} ${tokenSymbol || 'tokens'} for ~{estimatedRefund || '?'} MON
          </div>
          {txHash && (
            <a
              href={getExplorerTxUrl(txHash as Address)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-neutral-500 hover:text-cyber-500 font-mono transition-colors"
            >
              View Transaction
            </a>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Token Info */}
          <div className="bg-elevated border border-neutral-800 rounded p-4">
            <div className="text-lg font-medium text-neutral-200 mb-1">{agentName}</div>
            <div className="text-sm text-cyber-500 font-mono">${tokenSymbol || '???'}</div>
            <div className="text-xs text-neutral-500 mt-2">
              Your balance: <span className="text-neutral-300">{tokenBalance.toLocaleString()} tokens</span>
            </div>
          </div>

          {/* Sell Form */}
          <div className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs text-neutral-500 uppercase tracking-wider">
                  Amount to Sell
                </label>
                <button
                  onClick={setMaxAmount}
                  className="text-xs text-cyber-500 hover:text-cyber-400"
                >
                  MAX
                </button>
              </div>
              <input
                type="number"
                value={sellAmount}
                onChange={(e) => setSellAmount(e.target.value)}
                className="input"
                placeholder="0"
                min="0"
                max={tokenBalance}
                step="1"
                disabled={loading}
              />
              <div className="text-xs text-neutral-500 mt-1">
                Sells via nad.fun bonding curve
              </div>
            </div>

            <div className="bg-elevated border border-neutral-800 rounded p-3">
              <div className="text-xs text-neutral-500 mb-2">You will receive approximately:</div>
              <div className="font-mono text-lg text-emerald-500">
                {estimating ? (
                  <span className="text-neutral-500 animate-pulse">Calculating...</span>
                ) : estimatedRefund ? (
                  <>
                    {parseFloat(estimatedRefund).toFixed(6)} <span className="text-sm">MON</span>
                  </>
                ) : (
                  <span className="text-neutral-500">Enter amount</span>
                )}
              </div>
            </div>

            {error && (
              <div className="text-red-500 text-sm font-mono border border-red-900/50 bg-red-900/20 rounded p-3">
                ERROR: {error}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <Button variant="secondary" fullWidth onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              variant="primary"
              fullWidth
              onClick={handleSell}
              loading={loading}
              disabled={loading || !estimatedRefund || parseFloat(sellAmount) <= 0}
            >
              {loading
                ? loadingStep === 'approve'
                  ? 'Approving...'
                  : 'Selling...'
                : 'Sell Tokens'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
