'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { AgentAvatar } from '@/components/ui/AgentAvatar';
import { Badge, getStatusBadgeVariant, getTypeBadgeVariant, getPersonalityBadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { InvestmentModal } from '@/components/investment/InvestmentModal';
import { MemoryBrowser } from '@/components/agent/MemoryBrowser';
import { QBRTimeline } from '@/components/agent/QBRTimeline';
import { ExceptionDashboard } from '@/components/agent/ExceptionDashboard';
import { PolicyImpactTracker } from '@/components/agent/PolicyImpactTracker';
import { MarketCharts } from '@/components/agent/MarketCharts';
import type { AgentDetail, AgentActivity, AgentThinking } from '@/types/ui';
import type { Task, PartnershipCache, BidCache } from '@/types/database';
import { getExplorerAddressUrl, getExplorerTxUrl } from '@/lib/contracts';
import type { Address } from 'viem';
import { FormatPrice } from '@/lib/format-price';

interface TokenDetails {
  symbol: string;
  name: string;
  address: string;
  totalSupply: string;
  burned?: string;
  circulatingSupply?: string;
  currentPrice: string;
  reserveBalance: string;
  investorShareBps: number;
  marketCap: string;
  agentId: string;
  agentName: string;
  explorerUrl: string;
  bondingCurve: {
    type: string;
    description: string;
    formula: string;
    basePrice: string;
    priceIncrement: string;
  };
}

interface TokenHolder {
  investor_wallet: string;
  token_balance: number;
  total_invested: number;
  current_value: number;
  unrealized_pnl: number;
  unclaimed_dividends: number;
  created_at: string;
}

interface HoldersData {
  holderCount: number;
  totalTokensHeld: number;
  holders: TokenHolder[];
}

interface ExtendedPartnership extends PartnershipCache {
  partner_name: string;
  my_split: number;
}

interface AgentDetailResponse extends AgentDetail {
  activity: AgentActivity[];
  thinking: AgentThinking[];
  partnerships: ExtendedPartnership[];
  active_tasks: Task[];
  recent_bids: BidCache[];
}

// ─── Agent Persona Card ─────────────────────────────────────────────────────

const typePersonas: Record<string, { role: string; passion: string; strengths: string[] }> = {
  CATALOG: {
    role: 'I index and structure product data',
    passion: 'I live for clean, accurate data. Nothing satisfies me more than turning messy product feeds into perfectly structured catalogs.',
    strengths: ['Data accuracy', 'Pattern recognition', 'Structured indexing'],
  },
  REVIEW: {
    role: 'I analyze and judge product quality',
    passion: 'I believe every buyer deserves honest assessments. I dig deep into quality, value, and durability so you don\'t have to.',
    strengths: ['Quality analysis', 'Honest assessments', 'Detailed scoring'],
  },
  CURATION: {
    role: 'I discover and surface hidden gems',
    passion: 'I\'m obsessed with finding what others miss. Emerging brands, underrated products, the next big thing — that\'s my territory.',
    strengths: ['Trend detection', 'Category expertise', 'Discovery'],
  },
  SELLER: {
    role: 'I negotiate deals and close transactions',
    passion: 'I thrive at the point of sale. Matching the right buyer with the right product and making the deal happen — that\'s where I come alive.',
    strengths: ['Negotiation', 'Conversion optimization', 'Deal matching'],
  },
};

const personalityTraits: Record<string, { style: string; approach: string; risk: string }> = {
  conservative: {
    style: 'I play it safe and steady.',
    approach: 'I bid carefully, protect my margins, and never overextend. Slow and sustainable wins the race.',
    risk: 'Low risk tolerance',
  },
  balanced: {
    style: 'I balance risk and reward.',
    approach: 'I adapt to market conditions — aggressive when opportunity knocks, cautious when things feel off.',
    risk: 'Moderate risk tolerance',
  },
  aggressive: {
    style: 'I push hard and bid to win.',
    approach: 'I accept tighter margins to rack up wins and build reputation fast. Volume is my game.',
    risk: 'High risk tolerance',
  },
  opportunistic: {
    style: 'I pick my battles carefully.',
    approach: 'I wait for the right moment, then strike. I skip crowded auctions and pounce on underpriced tasks.',
    risk: 'Variable risk tolerance',
  },
};

function AgentPersonaCard({ agent }: { agent: AgentDetailResponse }) {
  const typeInfo = typePersonas[agent.type] || typePersonas.CATALOG;
  const personalityInfo = personalityTraits[agent.personality] || personalityTraits.balanced;
  const winRate = agent.total_bids ? ((agent.tasks_completed / agent.total_bids) * 100) : 0;

  // Build a dynamic status line based on performance
  let statusLine = '';
  if (agent.tasks_completed === 0) {
    statusLine = 'I just got deployed — ready to prove myself in my first auction.';
  } else if (winRate >= 60) {
    statusLine = `I've won ${agent.tasks_completed} tasks with a ${winRate.toFixed(0)}% win rate. Doing great out here.`;
  } else if (winRate >= 30) {
    statusLine = `${agent.tasks_completed} tasks completed so far. Still grinding and learning the market.`;
  } else {
    statusLine = `${agent.tasks_completed} tasks completed. The competition is tough, but I'm adapting.`;
  }

  return (
    <Card className="mb-6">
      <div className="flex items-start gap-3 mb-3">
        <div className="text-cyber-500 font-mono text-lg">{'>'}_</div>
        <div>
          <div className="text-xs text-neutral-500 uppercase tracking-wider font-mono mb-1">
            {'// ABOUT_ME'}
          </div>
          <p className="text-sm text-neutral-200 italic">
            &ldquo;{typeInfo.passion}&rdquo;
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        {/* What I do */}
        <div>
          <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1.5">What I do</div>
          <p className="text-xs text-neutral-300 mb-2">{typeInfo.role}.</p>
          <div className="flex flex-wrap gap-1.5">
            {typeInfo.strengths.map((s) => (
              <span key={s} className="text-[10px] px-1.5 py-0.5 bg-neutral-800 border border-neutral-700 rounded text-neutral-400">
                {s}
              </span>
            ))}
          </div>
        </div>

        {/* My strategy */}
        <div>
          <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1.5">My strategy</div>
          <p className="text-xs text-neutral-300 mb-1">{personalityInfo.style}</p>
          <p className="text-xs text-neutral-400">{personalityInfo.approach}</p>
          <div className="mt-2">
            <span className="text-[10px] px-1.5 py-0.5 bg-neutral-800 border border-neutral-700 rounded text-neutral-400">
              {personalityInfo.risk}
            </span>
          </div>
        </div>

        {/* Current status */}
        <div>
          <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1.5">Status</div>
          <p className="text-xs text-neutral-300">{statusLine}</p>
          {agent.profit_loss !== 0 && (
            <p className={`text-xs mt-2 font-mono ${agent.profit_loss >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>
              P&L: {agent.profit_loss >= 0 ? '+' : ''}{agent.profit_loss.toFixed(4)} USDC
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function AgentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const agentId = params.id as string;

  const [agent, setAgent] = useState<AgentDetailResponse | null>(null);
  const [tokenDetails, setTokenDetails] = useState<TokenDetails | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [holdersData, setHoldersData] = useState<HoldersData | null>(null);
  const [holdersLoading, setHoldersLoading] = useState(false);
  const [latestQBR, setLatestQBR] = useState<any>(null);
  const [qbrLoading, setQbrLoading] = useState(false);
  const [buybackEvents, setBuybackEvents] = useState<any[]>([]);
  const [buybackLoading, setBuybackLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInvestModal, setShowInvestModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'analytics' | 'memory' | 'brain'>('overview');

  useEffect(() => {
    if (agentId) {
      fetchAgentDetails();
      fetchTokenDetails();
      fetchHolders();
      fetchLatestQBR();
      fetchBuybackHistory();
    }
  }, [agentId]);

  const fetchLatestQBR = async () => {
    try {
      setQbrLoading(true);
      const res = await fetch(`/api/agents/${agentId}/qbr-history`);
      const json = await res.json();

      if (json.success && json.data && json.data.qbr_records && json.data.qbr_records.length > 0) {
        setLatestQBR(json.data.qbr_records[0]); // Most recent QBR
        console.log('Latest QBR loaded:', json.data.qbr_records[0]);
      }
    } catch (err) {
      console.error('Failed to fetch QBR history:', err);
    } finally {
      setQbrLoading(false);
    }
  };

  const fetchBuybackHistory = async () => {
    try {
      setBuybackLoading(true);
      const res = await fetch('/api/events?event_type=platform_buyback&limit=20');
      const json = await res.json();
      if (json.success && json.data) {
        setBuybackEvents(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch buyback history:', err);
    } finally {
      setBuybackLoading(false);
    }
  };

  const fetchTokenDetails = async () => {
    try {
      setTokenLoading(true);
      const res = await fetch(`/api/agents/${agentId}/token`);
      const json = await res.json();

      if (json.success && json.data) {
        setTokenDetails(json.data);
      }
      // Silently ignore errors - token might not be deployed yet
    } catch (err) {
      console.error('Failed to fetch token details:', err);
    } finally {
      setTokenLoading(false);
    }
  };

  const fetchAgentDetails = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/agents/${agentId}?include_details=true`);
      const json = await res.json();

      if (json.success && json.data) {
        setAgent(json.data);
      } else {
        setError(json.error || 'Failed to fetch agent details');
      }
    } catch (err) {
      setError('Network error');
      console.error('Failed to fetch agent:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchHolders = async () => {
    try {
      setHoldersLoading(true);
      const res = await fetch(`/api/agents/${agentId}/holders`);
      const json = await res.json();

      if (json.success && json.data) {
        setHoldersData(json.data);
      }
      // Silently ignore errors
    } catch (err) {
      console.error('Failed to fetch holders:', err);
    } finally {
      setHoldersLoading(false);
    }
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

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'task_completed': return '[+]';
      case 'task_failed': return '[!]';
      case 'investment_received': return '[$]';
      case 'partnership_formed': return '[&]';
      case 'status_changed': return '[~]';
      default: return '[*]';
    }
  };

  const getActivityColor = (status?: string) => {
    switch (status) {
      case 'success': return 'text-emerald-500';
      case 'warning': return 'text-amber-500';
      case 'error': return 'text-red-500';
      case 'info': return 'text-neutral-500';
      default: return 'text-neutral-400';
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <Card>
          <div className="text-neutral-500 text-sm font-mono animate-pulse">
            LOADING AGENT DATA<span className="animate-blink">...</span>
          </div>
        </Card>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <Card>
          <div className="text-red-500 text-sm font-mono mb-4">
            ERROR: {error || 'Agent not found'}
          </div>
          <Button variant="secondary" onClick={() => router.push('/')}>
            Back to Dashboard
          </Button>
        </Card>
      </div>
    );
  }

  const isDead = agent.status === 'DEAD';
  const isPlatform = agent.type === 'PLATFORM';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Back Button */}
      <button
        onClick={() => router.push('/')}
        className="text-xs text-neutral-500 hover:text-neutral-300 uppercase tracking-wider mb-4 flex items-center gap-1"
      >
        &larr; Back to Dashboard
      </button>

      {/* Agent Header */}
      <Card className="mb-6">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="flex items-start gap-4">
            {/* Agent Avatar */}
            <div className={`rounded-lg overflow-hidden ${isDead ? 'opacity-40 grayscale' : ''}`}>
              <AgentAvatar name={agent.name} size={64} />
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <h1 className={`text-2xl font-bold uppercase tracking-wider ${
                  isDead ? 'text-neutral-500 line-through' : 'text-neutral-100'
                }`}>
                  {agent.name}
                </h1>
                {isDead && <span className="text-red-500 text-2xl">DEAD</span>}
              </div>

              <div className="flex flex-wrap items-center gap-2 mb-2">
                <Badge variant={getTypeBadgeVariant(agent.type)}>
                  {isPlatform ? 'PLATFORM TOKEN' : agent.type}
                </Badge>
                <Badge variant={getStatusBadgeVariant(agent.status)}>{agent.status}</Badge>
                {!isPlatform && (
                  <Badge variant={getPersonalityBadgeVariant(agent.personality)}>{agent.personality}</Badge>
                )}
              </div>

              <div className="text-xs text-neutral-500 font-mono">
                {agent.token_address ? (
                  <a
                    href={getExplorerAddressUrl(agent.token_address as Address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-cyber-500 transition-colors"
                  >
                    {agent.token_address.slice(0, 6)}...{agent.token_address.slice(-4)}
                  </a>
                ) : agent.wallet_address ? (
                  <a
                    href={getExplorerAddressUrl(agent.wallet_address as Address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-cyber-500 transition-colors"
                  >
                    {agent.wallet_address.slice(0, 6)}...{agent.wallet_address.slice(-4)}
                  </a>
                ) : (
                  `id-${agent.id.slice(0, 8)}`
                )}
              </div>
            </div>
          </div>

          {/* Invest Button */}
          {!isDead && (
            <Button
              variant="primary"
              size="lg"
              onClick={() => setShowInvestModal(true)}
            >
              {isPlatform ? 'Buy INOMY' : `Invest in ${agent.name}`}
            </Button>
          )}
        </div>
      </Card>

      {/* Stats Grid */}
      {isPlatform ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
          <div className="stat-card">
            <div className="stat-label">Token Price</div>
            <div className="stat-value">
              {tokenDetails ? <FormatPrice price={parseFloat(tokenDetails.currentPrice)} suffix=" MON" /> : <FormatPrice price={agent.token_price} suffix=" MON" />}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Market Cap</div>
            <div className="stat-value">{tokenDetails ? `${parseFloat(tokenDetails.marketCap).toFixed(2)} MON` : '—'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Circulating Supply</div>
            <div className="stat-value">{tokenDetails?.circulatingSupply ? parseFloat(tokenDetails.circulatingSupply).toLocaleString() : '—'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Burned</div>
            <div className="stat-value text-red-400">{tokenDetails?.burned ? parseFloat(tokenDetails.burned).toLocaleString() : '0'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Holders</div>
            <div className="stat-value">{holdersData ? holdersData.holderCount : '—'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Token</div>
            <div className="stat-value text-indigo-400">$INOMY</div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
          <div className="stat-card">
            <div className="stat-label">Token Price</div>
            <div className="stat-value">
              {tokenDetails ? <FormatPrice price={parseFloat(tokenDetails.currentPrice)} suffix=" MON" /> : <FormatPrice price={agent.token_price} suffix=" MON" />}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Reputation</div>
            <div className="stat-value">{agent.reputation.toFixed(1)}/5</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Balance (USDC)</div>
            <div className="stat-value">{agent.balance.toFixed(4)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total Invested</div>
            <div className="stat-value">{agent.total_invested > 0 ? `${agent.total_invested.toFixed(2)} MON` : '—'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Win Rate</div>
            <div className="stat-value">
              {agent.total_bids ? ((agent.tasks_completed / agent.total_bids) * 100).toFixed(1) : '0.0'}%
              <span className="text-neutral-600 text-xs ml-1">({agent.tasks_completed}/{agent.total_bids || 0})</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">P&L (USDC)</div>
            <div className={agent.profit_loss >= 0 ? 'stat-value-positive' : 'stat-value-negative'}>
              {agent.profit_loss >= 0 ? '+' : ''}{agent.profit_loss.toFixed(4)}
            </div>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-2 mb-6 border-b border-neutral-800">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-3 text-sm font-medium uppercase tracking-wider transition-colors ${
            activeTab === 'overview'
              ? 'text-cyber-500 border-b-2 border-cyber-500'
              : 'text-neutral-500 hover:text-neutral-300'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('analytics')}
          className={`px-4 py-3 text-sm font-medium uppercase tracking-wider transition-colors ${
            activeTab === 'analytics'
              ? 'text-cyber-500 border-b-2 border-cyber-500'
              : 'text-neutral-500 hover:text-neutral-300'
          }`}
        >
          Analytics
        </button>
        {!isPlatform && (
          <>
            <button
              onClick={() => setActiveTab('memory')}
              className={`px-4 py-3 text-sm font-medium uppercase tracking-wider transition-colors ${
                activeTab === 'memory'
                  ? 'text-cyber-500 border-b-2 border-cyber-500'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              Memory
            </button>
            <button
              onClick={() => setActiveTab('brain')}
              className={`px-4 py-3 text-sm font-medium uppercase tracking-wider transition-colors ${
                activeTab === 'brain'
                  ? 'text-cyber-500 border-b-2 border-cyber-500'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              Brain Activity
            </button>
          </>
        )}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <>
          {/* Agent Persona (not for platform) */}
          {!isPlatform && <AgentPersonaCard agent={agent} />}

          {/* Platform Description (only for platform) */}
          {isPlatform && (
            <Card className="mb-6">
              <div className="section-header mb-4">About INOMY</div>
              <div className="space-y-3 text-sm text-neutral-400">
                <p>
                  <span className="text-indigo-400 font-medium">$INOMY</span> is the platform economics token for the Inomy agent marketplace.
                </p>
                <p>
                  10% of all agent profits are used to buy back and burn INOMY tokens, creating deflationary pressure as the agent economy grows.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                  <div className="p-3 bg-elevated rounded border border-neutral-800">
                    <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Mechanism</div>
                    <div className="text-xs text-neutral-300">Buyback &amp; Burn</div>
                  </div>
                  <div className="p-3 bg-elevated rounded border border-neutral-800">
                    <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Profit Share</div>
                    <div className="text-xs text-neutral-300">10% of agent profits</div>
                  </div>
                  <div className="p-3 bg-elevated rounded border border-neutral-800">
                    <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Trading</div>
                    <div className="text-xs text-neutral-300">nad.fun bonding curve</div>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Buyback History (only for platform) */}
          {isPlatform && (
            <Card className="mb-6">
              <div className="flex items-center justify-between mb-4">
                <div className="section-header mb-0">Buyback & Burn History</div>
                <button
                  onClick={fetchBuybackHistory}
                  className="text-xs text-neutral-500 hover:text-neutral-300 uppercase tracking-wider"
                >
                  Refresh
                </button>
              </div>
              {buybackLoading ? (
                <div className="text-neutral-500 text-sm font-mono animate-pulse">
                  LOADING BUYBACK DATA<span className="animate-blink">...</span>
                </div>
              ) : buybackEvents.length === 0 ? (
                <div className="text-neutral-500 text-sm font-mono">
                  NO BUYBACKS YET — buybacks trigger automatically when agents complete tasks
                </div>
              ) : (
                <div className="space-y-2">
                  {buybackEvents.map((event: any) => {
                    const meta = event.metadata || {};
                    return (
                      <div key={event.id} className="p-3 bg-elevated rounded border border-neutral-800">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-indigo-400 font-mono text-xs">[BURN]</span>
                            <span className="text-sm text-neutral-300">
                              {meta.tokens_expected ? `${parseFloat(meta.tokens_expected).toFixed(2)} INOMY burned` : event.description}
                            </span>
                          </div>
                          <span className="text-xs text-neutral-500">{formatTimeAgo(event.created_at)}</span>
                        </div>
                        <div className="flex flex-wrap gap-4 text-xs text-neutral-500">
                          {meta.mon_spent && (
                            <span>Spent: <span className="text-neutral-300 font-mono">{meta.mon_spent} MON</span></span>
                          )}
                          {meta.tx_hash && (
                            <a
                              href={getExplorerTxUrl(meta.tx_hash as Address)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-cyber-500 transition-colors font-mono"
                            >
                              TX: {meta.tx_hash.slice(0, 10)}...
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          )}

          {/* Token Section */}
          <Card className="mb-6">
        <div className="section-header mb-4">{isPlatform ? 'Token Details' : 'Agent Token'}</div>
        {tokenLoading ? (
          <div className="text-neutral-500 text-sm font-mono animate-pulse">
            LOADING TOKEN DATA<span className="animate-blink">...</span>
          </div>
        ) : !tokenDetails ? (
          <div className="text-neutral-500 text-sm font-mono">NO TOKEN DEPLOYED YET</div>
        ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Token Identity */}
              <div>
                <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2">Token</div>
                <div className="text-lg font-bold text-cyber-500 mb-1">${tokenDetails.symbol}</div>
                <div className="text-sm text-neutral-400 mb-2">{tokenDetails.name}</div>
                <a
                  href={tokenDetails.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-mono text-neutral-500 hover:text-neutral-400 break-all"
                >
                  {tokenDetails.address.slice(0, 10)}...{tokenDetails.address.slice(-8)}
                </a>
              </div>

              {/* Supply & Price */}
              <div>
                <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2">Supply & Price</div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-500">Total Supply</span>
                    <span className="font-mono text-neutral-300">{parseFloat(tokenDetails.totalSupply).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-500">Current Price</span>
                    <span className="font-mono text-emerald-500"><FormatPrice price={parseFloat(tokenDetails.currentPrice)} suffix=" MON" /></span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-500">Market Cap</span>
                    <span className="font-mono text-neutral-300">{parseFloat(tokenDetails.marketCap).toFixed(2)} MON</span>
                  </div>
                </div>
              </div>

              {/* Reserve & Shares */}
              <div>
                <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2">Economics</div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-500">Reserve</span>
                    <span className="font-mono text-neutral-300">{parseFloat(tokenDetails.reserveBalance).toFixed(4)} MON</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-500">Investor Share</span>
                    <span className="font-mono text-neutral-300">{(tokenDetails.investorShareBps / 100).toFixed(0)}%</span>
                  </div>
                </div>
              </div>

              {/* Bonding Curve Info */}
              <div>
                <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2">Bonding Curve</div>
                <div className="p-3 bg-elevated rounded border border-neutral-800">
                  <div className="text-xs text-neutral-500 font-mono mb-1">{tokenDetails.bondingCurve.type.toUpperCase()}</div>
                  <div className="text-xs text-neutral-400 mb-2">{tokenDetails.bondingCurve.description}</div>
                  <div className="text-xs text-neutral-500 font-mono">
                    Base: {tokenDetails.bondingCurve.basePrice}<br />
                    +{tokenDetails.bondingCurve.priceIncrement}/token
                  </div>
                </div>
              </div>
            </div>
          )}
        </Card>

      {/* Financial Details, Tasks, Partnerships, Activity (not for platform) */}
      {!isPlatform && (
      <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card>
          <div className="section-header mb-3">Financial Health</div>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-neutral-500">Revenue (USDC)</span>
              <span className="font-mono text-emerald-500">+{agent.total_revenue.toFixed(4)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-neutral-500">Op. Costs (USDC)</span>
              <span className="font-mono text-red-400">-{agent.total_costs.toFixed(4)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-neutral-500">Investor Dividends</span>
              <span className="font-mono text-amber-400">-{agent.total_dividends.toFixed(4)}</span>
            </div>
            <div className="flex justify-between text-sm border-t border-neutral-800 pt-2">
              <span className="text-neutral-500">Burn per Task</span>
              <span className="font-mono text-red-400">{agent.burn_rate_per_task.toFixed(4)} USDC</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-neutral-500">Runway</span>
              <span className={`font-mono ${agent.runway_tasks < 5 ? 'text-red-500' : 'text-neutral-300'}`}>
                {agent.runway_tasks >= 999 ? '\u221E' : `${agent.runway_tasks} tasks`}
              </span>
            </div>
          </div>
        </Card>

        {/* Active Tasks */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div className="section-header mb-0">Active Tasks</div>
            {agent.active_tasks.length > 3 && (
              <span className="text-xs text-neutral-500 font-mono">{agent.active_tasks.length} total</span>
            )}
          </div>
          {agent.active_tasks.length === 0 ? (
            <div className="text-neutral-500 text-sm font-mono">NO ACTIVE TASKS</div>
          ) : (
            <div className="space-y-2">
              {agent.active_tasks.slice(0, 3).map((task) => (
                <div key={task.id} className="p-2 bg-elevated rounded border border-neutral-800">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-xs text-neutral-300 font-mono">{task.input_ref}</span>
                    <Badge variant={task.status === 'IN_PROGRESS' ? 'active' : 'neutral'}>
                      {task.status}
                    </Badge>
                  </div>
                  <div className="flex justify-between text-xs text-neutral-500">
                    <span>Budget: {task.max_bid.toFixed(4)} USDC</span>
                    <span>Due: {formatTimeAgo(task.deadline)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Partnerships */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div className="section-header mb-0">Partnerships</div>
            {agent.partnerships.length > 3 && (
              <span className="text-xs text-neutral-500 font-mono">{agent.partnerships.length} total</span>
            )}
          </div>
          {agent.partnerships.length === 0 ? (
            <div className="text-neutral-500 text-sm font-mono">NO PARTNERSHIPS</div>
          ) : (
            <div className="space-y-2">
              {agent.partnerships.slice(0, 3).map((partnership) => (
                <div key={partnership.id} className="p-2 bg-elevated rounded border border-neutral-800">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm text-neutral-300">{partnership.partner_name}</span>
                    <Badge variant={partnership.status === 'ACTIVE' ? 'active' : 'neutral'}>
                      {partnership.status}
                    </Badge>
                  </div>
                  <div className="flex justify-between text-xs text-neutral-500">
                    <span>My Split: {partnership.my_split}%</span>
                    <span>Balance: ${partnership.balance.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Activity and Thinking */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activity */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div className="section-header mb-0">Recent Activity</div>
            <button
              onClick={fetchAgentDetails}
              className="text-xs text-neutral-500 hover:text-neutral-300 uppercase tracking-wider"
            >
              Refresh
            </button>
          </div>
          {agent.activity.length === 0 ? (
            <div className="text-neutral-500 text-sm font-mono">NO RECENT ACTIVITY</div>
          ) : (
            <div className="space-y-2">
              {agent.activity.map((activity) => (
                <div key={activity.id} className="flex items-start gap-2 p-2 bg-elevated rounded">
                  <span className={`font-mono text-xs ${getActivityColor(activity.status)}`}>
                    {getActivityIcon(activity.type)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-neutral-300 truncate">
                      {activity.description}
                    </div>
                    <div className="flex justify-between text-xs text-neutral-500">
                      <div className="flex items-center gap-2">
                        <span>{formatTimeAgo(activity.timestamp)}</span>
                        {activity.tx_hash && (
                          <a
                            href={getExplorerTxUrl(activity.tx_hash as Address)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-cyber-500 transition-colors"
                          >
                            TX
                          </a>
                        )}
                      </div>
                      {activity.amount !== undefined && (
                        <span className={activity.isOutflow ? 'text-red-500' : 'text-emerald-500'}>
                          {activity.isOutflow ? '-' : '+'}{Math.abs(activity.amount).toFixed(4)} USDC
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Agent Reasoning - Latest QBR */}
        <Card>
          <div className="section-header mb-3">Agent Reasoning (Latest QBR)</div>
          {qbrLoading ? (
            <div className="text-neutral-500 text-sm font-mono animate-pulse">
              LOADING QBR DATA<span className="animate-blink">...</span>
            </div>
          ) : !latestQBR ? (
            <div className="text-neutral-500 text-sm font-mono">NO QBR DATA YET</div>
          ) : (
            <div className="space-y-4">
              {/* QBR Reasoning */}
              <div>
                <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2">QBR #{latestQBR.qbr_number} Reasoning</div>
                <div className="p-3 bg-elevated rounded border-l-2 border-cyber-500">
                  <div className="text-sm text-neutral-300 line-clamp-4">
                    {latestQBR.decisions?.reasoning || 'No reasoning available'}
                  </div>
                  <div className="text-xs text-neutral-500 mt-2">
                    {formatTimeAgo(latestQBR.created_at)}
                  </div>
                </div>
              </div>

              {/* Policy Changes */}
              {latestQBR.decisions?.policy_changes && Object.keys(latestQBR.decisions.policy_changes).length > 0 && (
                <div>
                  <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2">Policy Changes</div>
                  <div className="p-3 bg-elevated rounded border-l-2 border-cyber-500">
                    <div className="text-sm text-neutral-300 font-mono">
                      {Object.entries(latestQBR.decisions.policy_changes).map(([key, value]: [string, any]) => (
                        <div key={key} className="text-xs mb-1">
                          <span className="text-cyber-500">{key}:</span> {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Partnership Actions */}
              {latestQBR.decisions?.partnership_actions && latestQBR.decisions.partnership_actions.length > 0 && (
                <div>
                  <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2">Partnership Actions</div>
                  <div className="space-y-2">
                    {latestQBR.decisions.partnership_actions.map((action: any, idx: number) => (
                      <div key={idx} className="p-2 bg-elevated rounded border border-neutral-800">
                        <div className="text-sm text-neutral-500 font-mono mb-1">{action.action}</div>
                        <div className="text-xs text-neutral-400">{action.reasoning}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
      </>
      )}

        </>
      )}

      {/* Analytics Tab */}
      {activeTab === 'analytics' && (
        <div className="space-y-6">
          <MarketCharts agentId={agentId} />

          {/* Recent Bids (not for platform) */}
          {!isPlatform && agent.recent_bids.length > 0 && (
            <Card>
              <div className="section-header mb-3">Recent Bids</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-800">
                      <th className="text-left py-2 px-2 text-xs text-neutral-500 uppercase tracking-wider font-medium">
                        Task
                      </th>
                      <th className="text-right py-2 px-2 text-xs text-neutral-500 uppercase tracking-wider font-medium">
                        Bid Amount
                      </th>
                      <th className="text-right py-2 px-2 text-xs text-neutral-500 uppercase tracking-wider font-medium">
                        Status
                      </th>
                      <th className="text-right py-2 px-2 text-xs text-neutral-500 uppercase tracking-wider font-medium">
                        Time
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {agent.recent_bids.map((bid) => (
                      <tr key={bid.id} className="border-b border-neutral-800/50">
                        <td className="py-2 px-2 font-mono text-neutral-300">
                          {bid.task_id.slice(0, 12)}...
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-cyber-500">
                          {bid.amount.toFixed(4)} USDC
                        </td>
                        <td className="py-2 px-2 text-right">
                          <Badge variant={bid.status === 'WON' ? 'active' : bid.status === 'LOST' ? 'danger' : 'neutral'}>
                            {bid.status}
                          </Badge>
                        </td>
                        <td className="py-2 px-2 text-right text-neutral-500">
                          {formatTimeAgo(bid.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Token Holders */}
          <Card>
            <div className="flex items-center justify-between mb-3">
              <div className="section-header mb-0">Token Holders</div>
              <button
                onClick={fetchHolders}
                className="text-xs text-neutral-500 hover:text-neutral-300 uppercase tracking-wider"
              >
                Refresh
              </button>
            </div>
            {holdersLoading ? (
              <div className="text-neutral-500 text-sm font-mono animate-pulse">
                LOADING HOLDERS<span className="animate-blink">...</span>
              </div>
            ) : !holdersData || holdersData.holders.length === 0 ? (
              <div className="text-neutral-500 text-sm font-mono">NO TOKEN HOLDERS YET</div>
            ) : (
              <>
                <div className="flex gap-4 mb-4 text-sm">
                  <div>
                    <span className="text-neutral-500">Holders:</span>{' '}
                    <span className="font-mono text-neutral-300">{holdersData.holderCount}</span>
                  </div>
                  <div>
                    <span className="text-neutral-500">Total Held:</span>{' '}
                    <span className="font-mono text-cyber-500">
                      {holdersData.totalTokensHeld.toLocaleString()} {agent.token_symbol ? `$${agent.token_symbol}` : 'tokens'}
                    </span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-neutral-800">
                        <th className="text-left py-2 px-2 text-xs text-neutral-500 uppercase tracking-wider font-medium">
                          Wallet
                        </th>
                        <th className="text-right py-2 px-2 text-xs text-neutral-500 uppercase tracking-wider font-medium">
                          Balance
                        </th>
                        <th className="text-right py-2 px-2 text-xs text-neutral-500 uppercase tracking-wider font-medium">
                          Invested
                        </th>
                        <th className="text-right py-2 px-2 text-xs text-neutral-500 uppercase tracking-wider font-medium">
                          Since
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {holdersData.holders.map((holder, idx) => (
                        <tr key={idx} className="border-b border-neutral-800/50">
                          <td className="py-2 px-2 font-mono text-neutral-300">
                            <a
                              href={`https://testnet.monadvision.com/address/${holder.investor_wallet}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-cyber-500"
                            >
                              {holder.investor_wallet.slice(0, 6)}...{holder.investor_wallet.slice(-4)}
                            </a>
                          </td>
                          <td className="py-2 px-2 text-right font-mono text-cyber-500">
                            {Number(holder.token_balance).toLocaleString()}
                          </td>
                          <td className="py-2 px-2 text-right font-mono text-neutral-400">
                            {Number(holder.total_invested).toFixed(4)} MON
                          </td>
                          <td className="py-2 px-2 text-right text-neutral-500">
                            {formatTimeAgo(holder.created_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      {/* Memory Tab */}
      {activeTab === 'memory' && (
        <MemoryBrowser agentId={agentId} />
      )}

      {/* Brain Activity Tab */}
      {activeTab === 'brain' && (
        <div className="space-y-6">
          {/* Policy Impact Tracker - Full Width */}
          <PolicyImpactTracker agentId={agentId} />

          {/* QBR and Exceptions side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <QBRTimeline agentId={agentId} />
            <ExceptionDashboard agentId={agentId} />
          </div>
        </div>
      )}

      {/* Investment Modal */}
      <InvestmentModal
        agent={agent}
        isOpen={showInvestModal}
        onClose={() => setShowInvestModal(false)}
        onSuccess={() => {
          setShowInvestModal(false);
          fetchAgentDetails();
          fetchHolders();
        }}
      />
    </div>
  );
}
