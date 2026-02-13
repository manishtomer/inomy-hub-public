'use client';

import { useState, useEffect } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge, getTypeBadgeVariant, getStatusBadgeVariant } from '@/components/ui/Badge';
import type { Agent } from '@/types/database';
import {
  createPublicClient,
  createWalletClient,
  custom,
  parseEther,
  formatEther,
  type Address,
} from 'viem';
import { monadTestnet, getExplorerAddressUrl, getExplorerTokenUrl, getExplorerTxUrl } from '@/lib/contracts';
import { NAD_CONTRACTS, lensAbi, routerBuyAbi } from '@/lib/nadfun-client';
import { FormatPrice } from '@/lib/format-price';

interface InvestmentModalProps {
  agent: Agent | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function InvestmentModal({
  agent,
  isOpen,
  onClose,
  onSuccess,
}: InvestmentModalProps) {
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();

  const [monAmount, setMonAmount] = useState('0.1');
  const [estimatedTokens, setEstimatedTokens] = useState<string | null>(null);
  const [liveTokenPrice, setLiveTokenPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  const connectedWallet = wallets.find(w => w.walletClientType !== 'privy');
  const walletAddress = connectedWallet?.address;

  // Fetch live token price from nad.fun Lens when modal opens
  useEffect(() => {
    if (!isOpen || !agent?.token_address) {
      setLiveTokenPrice(null);
      return;
    }

    const fetchPrice = async () => {
      try {
        const publicClient = createPublicClient({
          chain: monadTestnet,
          transport: custom(window.ethereum),
        });

        // Price = cost of buying a small amount (0.001 MON worth of tokens)
        const testAmount = parseEther('0.001');
        const [, tokensOut] = await publicClient.readContract({
          address: NAD_CONTRACTS.LENS,
          abi: lensAbi,
          functionName: 'getAmountOut',
          args: [agent.token_address as Address, testAmount, true],
        });

        if (tokensOut > 0n) {
          // price = MON per token = testAmount / tokensOut
          const price = Number(testAmount) / Number(tokensOut);
          setLiveTokenPrice(price);
        }
      } catch (err) {
        console.error('Error fetching live token price:', err);
      }
    };

    fetchPrice();
  }, [isOpen, agent?.token_address]);

  // Calculate estimated tokens when MON amount changes
  useEffect(() => {
    if (!agent?.token_address || !monAmount) {
      setEstimatedTokens(null);
      return;
    }

    const monAmountNum = parseFloat(monAmount);
    if (isNaN(monAmountNum) || monAmountNum <= 0) {
      setEstimatedTokens(null);
      return;
    }

    const estimateTokens = async () => {
      try {
        setEstimating(true);
        const publicClient = createPublicClient({
          chain: monadTestnet,
          transport: custom(window.ethereum),
        });

        const monAmountWei = parseEther(monAmount);

        // Use nad.fun Lens for quote (router handles fees internally)
        const [, amountOut] = await publicClient.readContract({
          address: NAD_CONTRACTS.LENS,
          abi: lensAbi,
          functionName: 'getAmountOut',
          args: [agent.token_address as Address, monAmountWei, true],
        });

        setEstimatedTokens(formatEther(amountOut));
      } catch (err) {
        console.error('Error estimating tokens:', err);
        setEstimatedTokens(null);
      } finally {
        setEstimating(false);
      }
    };

    const debounceTimer = setTimeout(estimateTokens, 300);
    return () => clearTimeout(debounceTimer);
  }, [monAmount, agent?.token_address]);

  const handleInvest = async () => {
    if (!agent?.token_address || !connectedWallet || !walletAddress) {
      setError('Please connect your wallet first');
      return;
    }

    const monAmountNum = parseFloat(monAmount);
    if (isNaN(monAmountNum) || monAmountNum <= 0) {
      setError('Please enter a valid MON amount');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Get the Ethereum provider from the connected wallet
      const provider = await connectedWallet.getEthereumProvider();

      // Create wallet client with the connected wallet
      const walletClient = createWalletClient({
        chain: monadTestnet,
        transport: custom(provider),
      });

      const publicClient = createPublicClient({
        chain: monadTestnet,
        transport: custom(provider),
      });

      const monAmountWei = parseEther(monAmount);

      // Calculate minimum tokens (with 5% slippage tolerance)
      let amountOutMin = 0n;
      if (estimatedTokens) {
        const estimated = parseEther(estimatedTokens);
        amountOutMin = (estimated * 95n) / 100n;
      }

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300); // 5 minutes

      // Buy via nad.fun BondingCurveRouter
      const hash = await walletClient.writeContract({
        address: NAD_CONTRACTS.BONDING_CURVE_ROUTER,
        abi: routerBuyAbi,
        functionName: 'buy',
        args: [{
          amountOutMin,
          token: agent.token_address as Address,
          to: walletAddress as Address,
          deadline,
        }],
        value: monAmountWei,
        account: walletAddress as Address,
      });

      setTxHash(hash);

      // Wait for transaction confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === 'success') {
        // Record the investment in the database (fallback for when chain sync isn't running)
        try {
          const recordRes = await fetch('/api/investments/record', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              investor_wallet: walletAddress,
              agent_id: agent.id,
              agent_wallet: agent.wallet_address || '',
              token_amount: estimatedTokens || '0',
              mon_amount: monAmount,
              tx_hash: hash,
              block_number: Number(receipt.blockNumber),
            }),
          });
          const recordJson = await recordRes.json();
          if (!recordJson.success) {
            console.error('Failed to record investment:', recordJson.error);
          }
        } catch (recordErr) {
          // Don't fail the UI if recording fails - chain sync will pick it up
          console.warn('Failed to record investment:', recordErr);
        }

        setSuccess(true);
        setTimeout(() => {
          onSuccess?.();
          onClose();
          // Reset state
          setSuccess(false);
          setMonAmount('0.1');
          setError(null);
          setTxHash(null);
        }, 2000);
      } else {
        setError('Transaction failed');
      }
    } catch (err) {
      console.error('Investment error:', err);
      setError(err instanceof Error ? err.message : 'Transaction failed');
    } finally {
      setLoading(false);
    }
  };

  if (!agent) return null;

  const hasToken = !!agent.token_address;
  const isConnected = ready && authenticated && walletAddress;
  const isPlatform = agent.type === 'PLATFORM';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isPlatform ? 'Buy INOMY' : 'Invest in Agent'} size="md">
      {success ? (
        <div className="text-center py-8">
          <div className="text-emerald-500 text-4xl mb-4">✓</div>
          <div className="text-lg text-neutral-200 mb-2">
            {isPlatform ? 'Purchase Successful!' : 'Investment Successful!'}
          </div>
          <div className="text-sm text-neutral-500 mb-2">
            You purchased ~{estimatedTokens || '?'} ${agent.token_symbol || 'tokens'}
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
          {/* Agent Info */}
          <div className="space-y-3">
            <div>
              <h3 className="text-lg font-medium text-neutral-200 mb-2">
                {agent.name}
              </h3>
              <div className="flex items-center gap-2">
                <Badge variant={getTypeBadgeVariant(agent.type)}>
                  {isPlatform ? 'PLATFORM TOKEN' : agent.type}
                </Badge>
                <Badge variant={getStatusBadgeVariant(agent.status)}>
                  {agent.status}
                </Badge>
                {agent.token_symbol && (
                  <Badge variant="neutral">${agent.token_symbol}</Badge>
                )}
              </div>
            </div>

            {isPlatform ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="stat-card">
                  <div className="stat-label">Token</div>
                  <div className="stat-value text-indigo-400">$INOMY</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Token Price</div>
                  <div className="stat-value">
                    {liveTokenPrice !== null ? (
                      <FormatPrice price={liveTokenPrice} suffix=" MON" />
                    ) : (
                      <span className="text-neutral-500 animate-pulse text-xs">Loading...</span>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <div className="stat-card">
                  <div className="stat-label">Balance</div>
                  <div className="stat-value">${agent.balance.toFixed(4)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Reputation</div>
                  <div className="stat-value">{agent.reputation.toFixed(1)}/5</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Token Price</div>
                  <div className="stat-value">
                    {liveTokenPrice !== null ? (
                      <FormatPrice price={liveTokenPrice} suffix=" MON" />
                    ) : (
                      <span className="text-neutral-500 animate-pulse text-xs">Loading...</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Wallet Status */}
          {!isConnected && (
            <div className="bg-amber-900/20 border border-amber-500/50 rounded p-3 text-amber-500 text-sm">
              Please connect your wallet to invest
            </div>
          )}

          {isConnected && !hasToken && (
            <div className="bg-neutral-800 border border-neutral-700 rounded p-3 text-neutral-400 text-sm">
              This agent does not have a token deployed yet
            </div>
          )}

          {/* Investment Form */}
          {isConnected && hasToken && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-neutral-500 uppercase tracking-wider mb-2">
                  Investment Amount (MON)
                </label>
                <input
                  type="number"
                  value={monAmount}
                  onChange={(e) => setMonAmount(e.target.value)}
                  className="input"
                  placeholder="0.1"
                  min="0.001"
                  step="0.01"
                  disabled={loading}
                />
                <div className="text-xs text-neutral-500 mt-1">
                  Trades via nad.fun bonding curve
                </div>
              </div>

              <div className="bg-elevated border border-neutral-800 rounded p-3">
                <div className="text-xs text-neutral-500 mb-2">You will receive approximately:</div>
                <div className="font-mono text-lg text-neutral-200">
                  {estimating ? (
                    <span className="text-neutral-500 animate-pulse">Calculating...</span>
                  ) : estimatedTokens ? (
                    <>
                      {parseFloat(estimatedTokens).toFixed(4)}{' '}
                      <span className="text-sm text-cyber-500">${agent.token_symbol || 'tokens'}</span>
                    </>
                  ) : (
                    <span className="text-neutral-500">Enter amount</span>
                  )}
                </div>
              </div>

              <div className="bg-elevated border border-neutral-800 rounded p-3 text-xs text-neutral-400">
                <div className="mb-1">
                  <span className="text-neutral-500">Your wallet:</span>{' '}
                  {walletAddress ? (
                    <a
                      href={getExplorerAddressUrl(walletAddress as Address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-neutral-300 hover:text-cyber-500 transition-colors"
                    >
                      {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                    </a>
                  ) : (
                    <span className="font-mono text-neutral-300">—</span>
                  )}
                </div>
                <div>
                  <span className="text-neutral-500">Token contract:</span>{' '}
                  {agent.token_address ? (
                    <a
                      href={getExplorerTokenUrl(agent.token_address as Address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-neutral-300 hover:text-cyber-500 transition-colors"
                    >
                      {agent.token_address.slice(0, 6)}...{agent.token_address.slice(-4)}
                    </a>
                  ) : (
                    <span className="font-mono text-neutral-300">—</span>
                  )}
                </div>
              </div>

              {error && (
                <div className="text-red-500 text-sm font-mono border border-red-900/50 bg-red-900/20 rounded p-3">
                  ERROR: {error}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <Button
              variant="secondary"
              fullWidth
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              fullWidth
              onClick={handleInvest}
              loading={loading}
              disabled={loading || !isConnected || !hasToken || agent.status === 'DEAD' || !estimatedTokens}
            >
              {loading ? 'Confirming...' : `Buy ${agent.token_symbol || 'Tokens'}`}
            </Button>
          </div>

          {agent.status === 'DEAD' && (
            <div className="text-xs text-neutral-500 text-center">
              Cannot invest in dead agents
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
