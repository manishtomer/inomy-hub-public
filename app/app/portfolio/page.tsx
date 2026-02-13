'use client';

import { useEffect, useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { Card } from '@/components/ui/Card';
import { AgentAvatar } from '@/components/ui/AgentAvatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SellModal } from '@/components/investment/SellModal';
import { InvestmentModal } from '@/components/investment/InvestmentModal';
import { AgentBusinessList } from '@/components/dashboard/AgentBusinessList';
import Link from 'next/link';
import type { Agent } from '@/types/database';
import {
  createPublicClient,
  http,
  formatEther,
  formatUnits,
  type Address,
} from 'viem';
import { monadTestnet } from '@/lib/contracts';
import { NAD_CONTRACTS, lensAbi } from '@/lib/nadfun-client';
import { FormatPrice } from '@/lib/format-price';

// USDC on Monad Testnet (6 decimals)
const USDC_ADDRESS = '0x534b2f3A21130d7a60830c2Df862319e593943A3';

interface TokenHolding {
  investor_wallet: string;
  agent_wallet: string;
  agent_id: string;
  token_balance: number;
  total_invested: number;
  current_value: number;
  unrealized_pnl: number;
  unclaimed_dividends: number;
  created_at: string;
  agent_name: string;
  token_symbol: string | null;
  token_address: string | null;
  agent_status: string;
  // Calculated fields
  current_price?: number;
  calculated_value?: number;
  pending_dividends?: number;
  // Escrow fields (from API)
  escrowed_dividends?: number;
  total_earned_dividends?: number;
  total_claimed_dividends?: number;
}

interface PortfolioData {
  wallet: string;
  holdingCount: number;
  totalInvested: number;
  totalValue: number;
  totalPnl: number;
  totalUnclaimedDividends: number;
  holdings: TokenHolding[];
  usdcBalance?: number;
}

interface Transaction {
  id: string;
  agent_id: string;
  transaction_type: 'BUY' | 'SELL';
  token_amount: number;
  mon_amount: number;
  tx_hash: string;
  transacted_at: string;
  agent_name: string;
  token_symbol: string;
}

export default function PortfolioPage() {
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();

  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [txLoading, setTxLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [investAgent, setInvestAgent] = useState<Agent | null>(null);
  const [showInvestModal, setShowInvestModal] = useState(false);

  // Sell modal state
  const [sellModalOpen, setSellModalOpen] = useState(false);
  const [selectedHolding, setSelectedHolding] = useState<TokenHolding | null>(null);

  // Claim state
  const [claimingAgent, setClaimingAgent] = useState<string | null>(null);
  const [claimingAll, setClaimingAll] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const connectedWallet = wallets.find(w => w.walletClientType !== 'privy');
  const walletAddress = connectedWallet?.address;

  useEffect(() => {
    if (walletAddress) {
      fetchPortfolio();
      fetchTransactionHistory();
    }
  }, [walletAddress]);

  const fetchPortfolio = async () => {
    if (!walletAddress) return;

    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/portfolio?wallet=${walletAddress}`);
      const json = await res.json();

      if (json.success && json.data) {
        // Single public client using direct HTTP (avoids MetaMask RPC rate limits)
        const publicClient = createPublicClient({
          chain: monadTestnet,
          transport: http(),
        });

        // All holdings are nad.fun tokens (API filters out legacy tokens)
        // Enrich sequentially with price + dividends
        const enrichedHoldings: TokenHolding[] = [];
        for (const holding of json.data.holdings as TokenHolding[]) {
          let priceNum = 0;

          // Get price via nad.fun Lens (buy-side quote to avoid reserve issues)
          if (holding.token_address && holding.token_address.length === 42) {
            try {
              const smallMon = BigInt('1000000000000000'); // 0.001 MON
              const [, tokensOut] = await publicClient.readContract({
                address: NAD_CONTRACTS.LENS,
                abi: lensAbi,
                functionName: 'getAmountOut',
                args: [holding.token_address as Address, smallMon, true],
              });
              if (tokensOut > 0n) {
                priceNum = parseFloat(formatEther(smallMon)) / parseFloat(formatEther(tokensOut));
              }
            } catch {
              // Lens quote failed — price stays 0
            }
          }

          // Fetch escrowed dividends from our API
          let escrowedDividends = 0;
          let totalEarned = 0;
          let totalClaimed = 0;
          try {
            const dividendRes = await fetch(
              `/api/dividends/${holding.agent_id}?wallet=${walletAddress}`
            );
            const dividendJson = await dividendRes.json();
            if (dividendJson.success && dividendJson.data?.investor) {
              escrowedDividends = dividendJson.data.investor.available_to_claim || 0;
              totalEarned = dividendJson.data.investor.total_earned || 0;
              totalClaimed = dividendJson.data.investor.total_claimed || 0;
            }
          } catch (err) {
            console.error('Error fetching escrow data:', err);
          }

          const calculatedValue = priceNum * Number(holding.token_balance);

          enrichedHoldings.push({
            ...holding,
            current_price: priceNum,
            calculated_value: calculatedValue,
            escrowed_dividends: escrowedDividends,
            total_earned_dividends: totalEarned,
            total_claimed_dividends: totalClaimed,
          });
        }

        const totalValue = enrichedHoldings.reduce(
          (sum, h) => sum + (h.calculated_value || 0),
          0
        );
        const totalDividends = enrichedHoldings.reduce(
          (sum, h) => sum + (h.escrowed_dividends || 0),
          0
        );

        // Single RPC call for USDC balance
        let usdcBalance = 0;
        try {
          const balance = await publicClient.readContract({
            address: USDC_ADDRESS as Address,
            abi: [
              {
                name: 'balanceOf',
                type: 'function',
                inputs: [{ name: 'account', type: 'address' }],
                outputs: [{ type: 'uint256' }],
                stateMutability: 'view',
              },
            ],
            functionName: 'balanceOf',
            args: [walletAddress as Address],
          }) as bigint;
          usdcBalance = parseFloat(formatUnits(balance, 6));
        } catch {
          // USDC balance fetch failed - continue without it
        }

        setPortfolio({
          ...json.data,
          holdings: enrichedHoldings,
          totalValue,
          totalUnclaimedDividends: totalDividends,
          usdcBalance,
        });
      } else {
        setError(json.error || 'Failed to fetch portfolio');
      }
    } catch (err) {
      setError('Network error');
      console.error('Failed to fetch portfolio:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchTransactionHistory = async () => {
    if (!walletAddress) return;

    try {
      setTxLoading(true);
      const res = await fetch(`/api/investments/history?wallet=${walletAddress}&limit=20`);
      const json = await res.json();

      if (json.success && json.data) {
        setTransactions(json.data.transactions);
      }
    } catch (err) {
      console.error('Failed to fetch history:', err);
    } finally {
      setTxLoading(false);
    }
  };

  const handleClaimDividends = async (holding: TokenHolding) => {
    if (!walletAddress) return;

    // Check if there are escrowed dividends to claim (USDC)
    const hasEscrowedDividends = (holding.escrowed_dividends || 0) > 0;
    setClaimError(null);

    try {
      setClaimingAgent(holding.agent_id);

      if (hasEscrowedDividends) {
        // Claim escrowed USDC dividends via our API
        const claimRes = await fetch('/api/dividends/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent_id: holding.agent_id,
            investor_wallet: walletAddress,
          }),
        });

        const claimJson = await claimRes.json();

        if (!claimJson.success) {
          console.error('Escrow claim failed:', claimJson.error);
          // Show error to user but continue to try on-chain claim
          if (claimJson.error?.includes('not configured')) {
            setClaimError('Escrow payouts not available yet - admin needs to configure escrow wallet');
          } else {
            setClaimError(`Escrow claim failed: ${claimJson.error}`);
          }
        } else {
          console.log(`Claimed $${claimJson.claimed} USDC from escrow (tx: ${claimJson.txHash})`);
        }
      }

      // Refresh portfolio
      await fetchPortfolio();
    } catch (err) {
      console.error('Claim error:', err);
      setClaimError(err instanceof Error ? err.message : 'Claim failed');
    } finally {
      setClaimingAgent(null);
    }
  };

  const handleClaimAll = async () => {
    if (!walletAddress || !portfolio || portfolio.totalUnclaimedDividends <= 0) return;

    setClaimError(null);

    try {
      setClaimingAll(true);

      const claimRes = await fetch('/api/dividends/claim-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          investor_wallet: walletAddress,
        }),
      });

      const claimJson = await claimRes.json();

      if (!claimJson.success) {
        setClaimError(claimJson.error || 'Claim all failed');
      } else {
        console.log(
          `Claimed $${claimJson.claimed} USDC from ${claimJson.agentCount} agents (tx: ${claimJson.txHash})`
        );
      }

      // Refresh portfolio
      await fetchPortfolio();
    } catch (err) {
      console.error('Claim all error:', err);
      setClaimError(err instanceof Error ? err.message : 'Claim all failed');
    } finally {
      setClaimingAll(false);
    }
  };

  const openSellModal = (holding: TokenHolding) => {
    setSelectedHolding(holding);
    setSellModalOpen(true);
  };

  const formatTimeAgo = (timestamp: string) => {
    const diff = Date.now() - new Date(timestamp).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'just now';
  };

  // Not ready yet
  if (!ready) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-bold text-neutral-100 uppercase tracking-wider mb-6">
          Your Portfolio
        </h1>
        <Card>
          <div className="text-neutral-500 text-sm font-mono animate-pulse">
            LOADING<span className="animate-blink">...</span>
          </div>
        </Card>
      </div>
    );
  }

  // Not connected
  if (!authenticated || !walletAddress) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-bold text-neutral-100 uppercase tracking-wider mb-6">
          Your Portfolio
        </h1>
        <Card>
          <div className="text-center py-8">
            <div className="text-neutral-500 text-sm font-mono mb-4">
              CONNECT WALLET TO VIEW PORTFOLIO
            </div>
            <Button variant="primary" onClick={login}>
              Connect Wallet
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (loading && !portfolio) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-bold text-neutral-100 uppercase tracking-wider mb-6">
          Your Portfolio
        </h1>
        <Card>
          <div className="text-neutral-500 text-sm font-mono animate-pulse">
            LOADING HOLDINGS<span className="animate-blink">...</span>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-neutral-100 uppercase tracking-wider mb-2">
              Your Portfolio
            </h1>
            {walletAddress && (
              <a
                href={`https://testnet.monadvision.com/address/${walletAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-neutral-500 font-mono hover:text-cyber-500 transition-colors"
              >
                {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Portfolio Summary */}
      {portfolio && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
          <div className="stat-card">
            <div className="stat-label">USDC Balance</div>
            <div className="stat-value text-emerald-500">
              ${(portfolio.usdcBalance || 0).toFixed(2)}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Holdings</div>
            <div className="stat-value">{portfolio.holdingCount}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total Invested</div>
            <div className="stat-value">{portfolio.totalInvested.toFixed(4)} MON</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Current Value</div>
            <div className="stat-value text-cyber-500">{portfolio.totalValue.toFixed(4)} MON</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Protected Dividends</div>
            <div className="stat-value text-emerald-500">
              ${portfolio.totalUnclaimedDividends.toFixed(6)} USDC
            </div>
            {portfolio.totalUnclaimedDividends > 0 && (
              <Button
                variant="primary"
                size="sm"
                className="mt-2 w-full"
                onClick={handleClaimAll}
                loading={claimingAll}
                disabled={claimingAll || claimingAgent !== null}
              >
                Claim All
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="mb-6 p-4 border border-red-900/50 bg-red-900/20 rounded">
          <div className="text-red-400 text-sm font-mono">ERROR: {error}</div>
        </div>
      )}

      {/* Claim Error Display */}
      {claimError && (
        <div className="mb-6 p-4 border border-yellow-900/50 bg-yellow-900/20 rounded flex items-center justify-between">
          <div className="text-yellow-400 text-sm font-mono">{claimError}</div>
          <button
            onClick={() => setClaimError(null)}
            className="text-yellow-500 hover:text-yellow-400 text-xs uppercase"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Holdings */}
      <Card className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="section-header mb-0">Your Token Holdings</div>
          <button
            onClick={fetchPortfolio}
            className="text-xs text-neutral-500 hover:text-neutral-300 uppercase tracking-wider transition-colors"
            disabled={loading}
          >
            {loading ? 'LOADING...' : 'REFRESH'}
          </button>
        </div>

        {!portfolio || portfolio.holdings.length === 0 ? (
          <>
          <div className="py-6">
            <h3 className="text-sm font-bold text-neutral-200 uppercase tracking-wider mb-4">
              How Investing Works
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="p-4 rounded-lg border border-neutral-800 bg-elevated/50">
                <div className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2">
                  1. Buy Agent Tokens
                </div>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Each agent has its own token on a bonding curve. Click &ldquo;Invest&rdquo; on any
                  active agent to buy their tokens with MON.
                </p>
              </div>
              <div className="p-4 rounded-lg border border-neutral-800 bg-elevated/50">
                <div className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2">
                  2. Earn Dividends
                </div>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  As agents complete tasks and earn revenue, they distribute dividends to token
                  holders based on the agent&apos;s investor share rate. Claim your USDC dividends anytime.
                </p>
              </div>
              <div className="p-4 rounded-lg border border-neutral-800 bg-elevated/50">
                <div className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2">
                  3. Bonding Curve Pricing
                </div>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Token prices rise as more people buy and fall as they sell. Early investors in
                  top-performing agents benefit as demand for their tokens grows.
                </p>
              </div>
            </div>
          </div>
          <div className="mt-6">
            <AgentBusinessList onAgentClick={(agent) => {
              setInvestAgent(agent);
              setShowInvestModal(true);
            }} />
          </div>
          </>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-800">
                  <th className="text-left py-3 px-2 text-xs text-neutral-500 uppercase tracking-wider font-medium">
                    Agent
                  </th>
                  <th className="text-right py-3 px-2 text-xs text-neutral-500 uppercase tracking-wider font-medium">
                    Balance
                  </th>
                  <th className="text-right py-3 px-2 text-xs text-neutral-500 uppercase tracking-wider font-medium">
                    Price
                  </th>
                  <th className="text-right py-3 px-2 text-xs text-neutral-500 uppercase tracking-wider font-medium">
                    Value
                  </th>
                  <th className="text-right py-3 px-2 text-xs text-neutral-500 uppercase tracking-wider font-medium">
                    Dividends
                  </th>
                  <th className="text-right py-3 px-2 text-xs text-neutral-500 uppercase tracking-wider font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {portfolio.holdings.map((holding, idx) => (
                  <tr
                    key={idx}
                    className="border-b border-neutral-800/50 hover:bg-elevated/50 transition-colors"
                  >
                    <td className="py-3 px-2">
                      <Link href={`/agents/${holding.agent_id}`} className="block">
                        <div className="flex items-center gap-2">
                          <AgentAvatar name={holding.agent_name} size={32} />
                          <div>
                            <div className="text-neutral-200 font-medium hover:text-cyber-500 transition-colors">
                              {holding.agent_name}
                            </div>
                            <div className="text-xs text-cyber-500 font-mono">
                              ${holding.token_symbol || holding.agent_name.slice(0, 4).toUpperCase()}
                            </div>
                          </div>
                        </div>
                      </Link>
                    </td>
                    <td className="py-3 px-2 text-right">
                      <div className="font-mono text-neutral-300">
                        {Number(holding.token_balance).toLocaleString()}
                      </div>
                    </td>
                    <td className="py-3 px-2 text-right">
                      <div className="font-mono text-neutral-400">
                        {holding.current_price ? <FormatPrice price={holding.current_price} suffix=" MON" /> : '—'}
                      </div>
                    </td>
                    <td className="py-3 px-2 text-right">
                      <div className="font-mono text-cyber-500">
                        {holding.calculated_value ? <FormatPrice price={holding.calculated_value} suffix=" MON" /> : '—'}
                      </div>
                    </td>
                    <td className="py-3 px-2 text-right">
                      <div className="space-y-1">
                        {/* Claimable USDC dividends (protected) */}
                        {(holding.escrowed_dividends || 0) > 0 && (
                          <div className="flex items-center justify-end gap-2">
                            <span className="font-mono text-emerald-500">
                              ${holding.escrowed_dividends?.toFixed(6)}
                            </span>
                            <span className="text-[10px] bg-emerald-900/30 text-emerald-400 px-1.5 py-0.5 rounded uppercase tracking-wider">
                              Claimable
                            </span>
                          </div>
                        )}
                        {/* Already claimed dividends */}
                        {(holding.total_claimed_dividends || 0) > 0 && (
                          <div className="flex items-center justify-end gap-2">
                            <span className="font-mono text-neutral-500">
                              ${holding.total_claimed_dividends?.toFixed(6)}
                            </span>
                            <span className="text-[10px] bg-neutral-800 text-neutral-500 px-1.5 py-0.5 rounded uppercase tracking-wider">
                              Claimed
                            </span>
                          </div>
                        )}
                        {/* No dividends at all */}
                        {(holding.total_earned_dividends || 0) === 0 && (
                          <div className="font-mono text-neutral-500">-</div>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-2 text-right">
                      <div className="flex gap-2 justify-end">
                        {(holding.escrowed_dividends || 0) > 0 && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleClaimDividends(holding)}
                            loading={claimingAgent === holding.agent_id}
                            disabled={claimingAgent !== null || claimingAll}
                          >
                            Claim
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openSellModal(holding)}
                        >
                          Sell
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Transaction History */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div className="section-header mb-0">Transaction History</div>
          <button
            onClick={fetchTransactionHistory}
            className="text-xs text-neutral-500 hover:text-neutral-300 uppercase tracking-wider transition-colors"
            disabled={txLoading}
          >
            {txLoading ? 'LOADING...' : 'REFRESH'}
          </button>
        </div>

        {transactions.length === 0 ? (
          <div className="text-neutral-500 text-sm font-mono">
            NO TRANSACTIONS YET
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-800">
                  <th className="text-left py-2 px-2 text-xs text-neutral-500 uppercase tracking-wider font-medium">
                    Type
                  </th>
                  <th className="text-left py-2 px-2 text-xs text-neutral-500 uppercase tracking-wider font-medium">
                    Agent
                  </th>
                  <th className="text-right py-2 px-2 text-xs text-neutral-500 uppercase tracking-wider font-medium">
                    Tokens
                  </th>
                  <th className="text-right py-2 px-2 text-xs text-neutral-500 uppercase tracking-wider font-medium">
                    MON
                  </th>
                  <th className="text-right py-2 px-2 text-xs text-neutral-500 uppercase tracking-wider font-medium">
                    Time
                  </th>
                  <th className="text-right py-2 px-2 text-xs text-neutral-500 uppercase tracking-wider font-medium">
                    TX
                  </th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-neutral-800/50">
                    <td className="py-2 px-2">
                      <Badge variant={tx.transaction_type === 'BUY' ? 'active' : 'warning'}>
                        {tx.transaction_type}
                      </Badge>
                    </td>
                    <td className="py-2 px-2">
                      <div className="text-neutral-300">{tx.agent_name}</div>
                      <div className="text-xs text-cyber-500 font-mono">${tx.token_symbol}</div>
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-neutral-300">
                      {tx.transaction_type === 'BUY' ? '+' : '-'}{Number(tx.token_amount).toLocaleString()}
                    </td>
                    <td className="py-2 px-2 text-right font-mono">
                      <span className={tx.transaction_type === 'BUY' ? 'text-red-400' : 'text-emerald-500'}>
                        {tx.transaction_type === 'BUY' ? '-' : '+'}{Number(tx.mon_amount).toFixed(4)}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-right text-neutral-500">
                      {formatTimeAgo(tx.transacted_at)}
                    </td>
                    <td className="py-2 px-2 text-right">
                      {tx.tx_hash && (
                        <a
                          href={`https://testnet.monadvision.com/tx/${tx.tx_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-neutral-500 hover:text-neutral-400 font-mono"
                        >
                          {tx.tx_hash.slice(0, 6)}...
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Sell Modal */}
      {selectedHolding && (
        <SellModal
          isOpen={sellModalOpen}
          onClose={() => {
            setSellModalOpen(false);
            setSelectedHolding(null);
          }}
          onSuccess={() => {
            fetchPortfolio();
            fetchTransactionHistory();
          }}
          agentId={selectedHolding.agent_id}
          agentName={selectedHolding.agent_name}
          tokenSymbol={selectedHolding.token_symbol}
          tokenAddress={selectedHolding.token_address || ''}
          tokenBalance={Number(selectedHolding.token_balance)}
        />
      )}

      {/* Investment Modal (from empty state agent list) */}
      <InvestmentModal
        agent={investAgent}
        isOpen={showInvestModal}
        onClose={() => setShowInvestModal(false)}
        onSuccess={() => {
          setShowInvestModal(false);
          fetchPortfolio();
        }}
      />
    </div>
  );
}
