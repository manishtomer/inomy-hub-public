'use client';

import { useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

interface BidHistoryData {
  bids: Array<{
    id: string;
    amount: number;
    status: 'PENDING' | 'WON' | 'LOST';
    margin: number | null;
    task_cost: number | null;
    created_at: string;
    task_type: string | null;
  }>;
  balance_history: Array<{
    timestamp: string;
    balance: number;
    event_type: string;
  }>;
  summary: {
    total_bids: number;
    wins: number;
    losses: number;
    avg_bid: number;
    avg_margin: number;
    avg_win_bid: number;
    avg_loss_bid: number;
  };
}

interface MarketChartsProps {
  agentId: string;
}

export function MarketCharts({ agentId }: MarketChartsProps) {
  const [data, setData] = useState<BidHistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchBidHistory = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/agents/${agentId}/bid-history`);
        const json = await res.json();

        if (json.success) {
          setData(json.data);
        } else {
          setError(json.error || 'Failed to fetch bid history');
        }
      } catch (err) {
        setError('Failed to fetch bid history');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchBidHistory();
  }, [agentId]);

  if (loading) {
    return (
      <div className="bg-surface rounded-lg border border-neutral-800 p-8">
        <div className="text-center text-neutral-400">Loading market charts...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-surface rounded-lg border border-neutral-800 p-8">
        <div className="text-center text-red-400">{error || 'No data available'}</div>
      </div>
    );
  }

  // Downsample helper: keep every Nth point (always include first and last)
  function downsample<T>(arr: T[], maxPoints: number): T[] {
    if (arr.length <= maxPoints) return arr;
    const step = Math.ceil(arr.length / maxPoints);
    const result: T[] = [];
    for (let i = 0; i < arr.length; i += step) {
      result.push(arr[i]);
    }
    // Always include last point
    if (result[result.length - 1] !== arr[arr.length - 1]) {
      result.push(arr[arr.length - 1]);
    }
    return result;
  }

  const MAX_POINTS = 30;

  // Prepare bid amount data
  const bidAmountData = downsample(
    data.bids.map((bid, index) => ({
      index: index + 1,
      amount: bid.amount,
      status: bid.status,
    })),
    MAX_POINTS
  );

  // Prepare margin data (filter out null margins)
  const marginData = downsample(
    data.bids
      .map((bid, index) => ({
        index: index + 1,
        margin: bid.margin !== null ? bid.margin * 100 : null,
      }))
      .filter((item) => item.margin !== null),
    MAX_POINTS
  );

  // Prepare balance data
  const balanceData = downsample(
    data.balance_history.map((item, index) => ({
      index: index + 1,
      balance: item.balance,
      timestamp: new Date(item.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    })),
    MAX_POINTS
  );

  // Calculate win rate
  const winRate =
    data.summary.total_bids > 0
      ? ((data.summary.wins / data.summary.total_bids) * 100).toFixed(1)
      : '0.0';

  // Compute Y-axis domain for bid chart (zoom into actual range)
  const bidAmounts = bidAmountData.map((d: any) => d.amount).filter((v: number) => v > 0);
  const bidYMin = bidAmounts.length > 0 ? Math.max(0, Math.floor(Math.min(...bidAmounts) * 100 - 1) / 100) : 0;
  const bidYMax = bidAmounts.length > 0 ? Math.ceil(Math.max(...bidAmounts) * 100 + 1) / 100 : 'auto';

  // Custom dot for bid chart
  const CustomBidDot = (props: any) => {
    const { cx, cy, payload } = props;
    const color = payload.status === 'WON' ? '#10b981' : payload.status === 'LOST' ? '#f87171' : '#737373';
    return <circle cx={cx} cy={cy} r={4} fill={color} stroke="none" />;
  };

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-neutral-900 border border-neutral-700 rounded px-3 py-2">
          <p className="text-xs text-neutral-400 mb-1">#{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-xs text-neutral-200">
              {entry.name}: <span className="font-mono">{entry.value.toFixed(2)}</span>
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart 1: Bid Amount Over Time */}
        <div className="bg-surface rounded-lg border border-neutral-800 p-4">
          <h3 className="text-xs text-neutral-400 uppercase tracking-wider mb-3">
            Bid Amount Over Time
          </h3>
          {bidAmountData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={bidAmountData}>
                <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
                <XAxis
                  dataKey="index"
                  tick={{ fill: '#737373', fontSize: 11 }}
                  label={{ value: 'Bid #', position: 'insideBottom', offset: -5, fill: '#737373', fontSize: 11 }}
                />
                <YAxis
                  domain={[bidYMin, bidYMax]}
                  tick={{ fill: '#737373', fontSize: 11 }}
                  label={{ value: '$', angle: -90, position: 'insideLeft', fill: '#737373', fontSize: 11 }}
                />
                <Tooltip content={CustomTooltip} />
                {data.summary.avg_bid > 0 && (
                  <ReferenceLine
                    y={data.summary.avg_bid}
                    stroke="#06b6d4"
                    strokeDasharray="3 3"
                    label={{ value: 'Avg', fill: '#06b6d4', fontSize: 10 }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="amount"
                  stroke="#06b6d4"
                  strokeWidth={2}
                  dot={<CustomBidDot />}
                  name="Bid"
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-neutral-500 text-sm">
              No bid data available
            </div>
          )}
        </div>

        {/* Chart 2: Margin Over Time */}
        <div className="bg-surface rounded-lg border border-neutral-800 p-4">
          <h3 className="text-xs text-neutral-400 uppercase tracking-wider mb-3">
            Margin Over Time
          </h3>
          {marginData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={marginData}>
                <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
                <XAxis
                  dataKey="index"
                  tick={{ fill: '#737373', fontSize: 11 }}
                  label={{ value: 'Bid #', position: 'insideBottom', offset: -5, fill: '#737373', fontSize: 11 }}
                />
                <YAxis
                  tick={{ fill: '#737373', fontSize: 11 }}
                  label={{ value: '%', angle: -90, position: 'insideLeft', fill: '#737373', fontSize: 11 }}
                />
                <Tooltip content={CustomTooltip} />
                <Area
                  type="monotone"
                  dataKey="margin"
                  stroke="#06b6d4"
                  fill="#06b6d4"
                  fillOpacity={0.3}
                  strokeWidth={2}
                  name="Margin"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-neutral-500 text-sm">
              No margin data available
            </div>
          )}
        </div>

        {/* Chart 3: Balance Trajectory */}
        <div className="bg-surface rounded-lg border border-neutral-800 p-4">
          <h3 className="text-xs text-neutral-400 uppercase tracking-wider mb-3">
            Balance Trajectory
          </h3>
          {balanceData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={balanceData}>
                <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
                <XAxis
                  dataKey="index"
                  tick={{ fill: '#737373', fontSize: 11 }}
                  label={{ value: 'Event #', position: 'insideBottom', offset: -5, fill: '#737373', fontSize: 11 }}
                />
                <YAxis
                  tick={{ fill: '#737373', fontSize: 11 }}
                  label={{ value: '$', angle: -90, position: 'insideLeft', fill: '#737373', fontSize: 11 }}
                />
                <Tooltip content={CustomTooltip} />
                <Line
                  type="monotone"
                  dataKey="balance"
                  stroke="#06b6d4"
                  strokeWidth={2}
                  dot={{ fill: '#06b6d4', r: 3 }}
                  name="Balance"
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-neutral-500 text-sm">
              No balance history available
            </div>
          )}
        </div>

        {/* Chart 4: Win Rate Summary */}
        <div className="bg-surface rounded-lg border border-neutral-800 p-4">
          <h3 className="text-xs text-neutral-400 uppercase tracking-wider mb-3">
            Win Rate Summary
          </h3>
          <div className="space-y-4 h-[200px] flex flex-col justify-center">
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-400">Win Rate</span>
              <span className="text-2xl font-mono text-neutral-200">{winRate}%</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-400">Total Bids</span>
              <span className="text-lg font-mono text-neutral-200">{data.summary.total_bids}</span>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-neutral-800">
              <div>
                <div className="text-xs text-neutral-500 mb-1">Wins</div>
                <div className="text-lg font-mono text-emerald-500">{data.summary.wins}</div>
                {data.summary.avg_win_bid > 0 && (
                  <div className="text-xs text-neutral-600 font-mono">
                    ${data.summary.avg_win_bid.toFixed(2)} avg
                  </div>
                )}
              </div>
              <div>
                <div className="text-xs text-neutral-500 mb-1">Losses</div>
                <div className="text-lg font-mono text-red-400">{data.summary.losses}</div>
                {data.summary.avg_loss_bid > 0 && (
                  <div className="text-xs text-neutral-600 font-mono">
                    ${data.summary.avg_loss_bid.toFixed(2)} avg
                  </div>
                )}
              </div>
            </div>

            {data.summary.avg_margin !== null && (
              <div className="flex items-center justify-between pt-2 border-t border-neutral-800">
                <span className="text-sm text-neutral-400">Avg Margin</span>
                <span className="text-lg font-mono text-cyber-500">
                  {(data.summary.avg_margin * 100).toFixed(1)}%
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
