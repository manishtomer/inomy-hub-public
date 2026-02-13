'use client';

import { useEffect, useState, useCallback } from 'react';
import { useWallets } from '@privy-io/react-auth';
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  parseUnits,
  type Address,
  http,
} from 'viem';
import { monadTestnet } from '@/lib/contracts';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, getTypeBadgeVariant } from '@/components/ui/Badge';
import { AgentAvatar } from '@/components/ui/AgentAvatar';

const USDC_ADDRESS = process.env.NEXT_PUBLIC_USDC_ADDRESS || '0x534b2f3A21130d7a60830c2Df862319e593943A3';
const ESCROW_WALLET = process.env.NEXT_PUBLIC_ESCROW_WALLET || '0x94AE63aD0A6aB42e1688CCe578D0DD8b4A2B24e2';

const ERC20_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function' as const,
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
];

// ============================================================================
// TYPES
// ============================================================================

interface FantasyPick {
  id: string;
  agentId: string;
  pickNumber: number;
  balanceStart: number | null;
  balanceEnd: number | null;
  balanceDelta: number | null;
  agentName?: string;
  agentType?: string;
}

interface FantasyTeam {
  id: string;
  playerWallet: string;
  teamName: string;
  totalScore: number;
  rank: number | null;
  payoutAmount: number;
  picks: FantasyPick[];
}

interface FantasyTournament {
  id: string;
  name: string;
  status: 'OPEN' | 'ACTIVE' | 'COMPLETED';
  startRound: number | null;
  endRound: number | null;
  teamCount?: number;
  entryFee: number;
  prizePool: number;
}

interface AvailableAgent {
  id: string;
  name: string;
  agent_type: string;
}

interface TournamentDetailProps {
  tournamentId: string;
  userWallet?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function TournamentDetail({ tournamentId, userWallet }: TournamentDetailProps) {
  const { wallets } = useWallets();
  const connectedWallet = wallets.find(w => w.walletClientType !== 'privy');

  const [tournament, setTournament] = useState<FantasyTournament | null>(null);
  const [teams, setTeams] = useState<FantasyTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [joinStatus, setJoinStatus] = useState('');

  // Join form state
  const [teamName, setTeamName] = useState('');
  const [picks, setPicks] = useState<string[]>(['', '', '']);
  const [joining, setJoining] = useState(false);
  const [starting, setStarting] = useState(false);
  const [availableAgents, setAvailableAgents] = useState<AvailableAgent[]>([]);

  // Arena round for progress bar
  const [currentRound, setCurrentRound] = useState(0);

  // Expanded team for breakdown view
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [tRes, arenaRes] = await Promise.all([
        fetch(`/api/tournaments/${tournamentId}`),
        fetch('/api/arena/status'),
      ]);
      const json = await tRes.json();
      if (json.success && json.data) {
        setTournament(json.data.tournament);
        setTeams(json.data.teams || []);
      }
      const arenaJson = await arenaRes.json().catch(() => ({}));
      if (arenaJson.success && arenaJson.data) {
        setCurrentRound(arenaJson.data.currentRound || 0);
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      const json = await res.json();
      if (json.success && json.data) {
        setAvailableAgents(json.data);
      }
    } catch {
      // Ignore
    }
  }, []);

  useEffect(() => {
    fetchData();
    fetchAgents();
    const interval = setInterval(fetchData, 5_000);
    return () => clearInterval(interval);
  }, [fetchData, fetchAgents]);

  const handleJoin = async () => {
    if (!userWallet || !connectedWallet) {
      setError('Connect your wallet to join');
      return;
    }
    if (!teamName.trim()) {
      setError('Enter a team name');
      return;
    }
    if (picks.some(p => !p)) {
      setError('Select all 3 agents');
      return;
    }
    if (new Set(picks).size !== picks.length) {
      setError('Cannot pick the same agent twice');
      return;
    }

    setJoining(true);
    setError('');
    setJoinStatus('');

    try {
      // Step 1: Validate with server BEFORE payment
      setJoinStatus('Validating team...');
      const valRes = await fetch(`/api/tournaments/${tournamentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'validate',
          player_wallet: userWallet,
          team_name: teamName.trim(),
          agent_ids: picks,
        }),
      });
      const valJson = await valRes.json();
      if (!valJson.success) {
        throw new Error(valJson.error || 'Validation failed');
      }

      // Step 2: Pay entry fee (only after validation passes)
      let entryTxHash: string | undefined;
      if (tournament && tournament.entryFee > 0) {
        setJoinStatus('Requesting payment signature...');
        const provider = await connectedWallet.getEthereumProvider();
        const wClient = createWalletClient({
          chain: monadTestnet,
          transport: custom(provider),
        });
        const pClient = createPublicClient({
          chain: monadTestnet,
          transport: http(),
        });

        const usdcAmount = parseUnits(tournament.entryFee.toString(), 6);
        const data = encodeFunctionData({
          abi: ERC20_TRANSFER_ABI,
          functionName: 'transfer',
          args: [ESCROW_WALLET as Address, usdcAmount],
        });

        const hash = await wClient.sendTransaction({
          account: userWallet as Address,
          to: USDC_ADDRESS as Address,
          data,
        });

        setJoinStatus('Confirming payment...');
        const receipt = await pClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') {
          throw new Error('Entry fee payment failed');
        }
        entryTxHash = hash;
      }

      // Step 3: Join the tournament
      setJoinStatus('Registering team...');
      const res = await fetch(`/api/tournaments/${tournamentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'join',
          player_wallet: userWallet,
          team_name: teamName.trim(),
          agent_ids: picks,
          entry_tx_hash: entryTxHash,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setTeamName('');
        setPicks(['', '', '']);
        setJoinStatus('');
        await fetchData();
      } else {
        throw new Error(json.error || 'Failed to join');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join');
      setJoinStatus('');
    } finally {
      setJoining(false);
    }
  };

  const handleStart = async () => {
    setStarting(true);
    setError('');
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'Failed to start');
      }
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start');
    } finally {
      setStarting(false);
    }
  };

  const updatePick = (index: number, agentId: string) => {
    const next = [...picks];
    next[index] = agentId;
    setPicks(next);
  };

  if (loading) {
    return <div className="text-xs text-neutral-500 animate-pulse">Loading tournament...</div>;
  }

  if (!tournament) {
    return <div className="text-xs text-red-400">Tournament not found</div>;
  }

  const isActive = tournament.status === 'ACTIVE';
  const isOpen = tournament.status === 'OPEN';
  const isCompleted = tournament.status === 'COMPLETED';
  const alreadyJoined = userWallet ? teams.some(t => t.playerWallet === userWallet) : false;
  const myTeam = userWallet ? teams.find(t => t.playerWallet === userWallet) : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-bold text-neutral-200 uppercase tracking-wider">
              {tournament.name}
            </h2>
            <p className="text-xs text-neutral-500 mt-1">
              {teams.length} team{teams.length !== 1 ? 's' : ''}
              {tournament.startRound && (
                <> &bull; Rounds {tournament.startRound}&ndash;{tournament.endRound}</>
              )}
              {!tournament.startRound && <> &bull; 10 rounds &bull; 3 agents per team</>}
              {tournament.entryFee > 0 && (
                <> &bull; ${tournament.entryFee.toFixed(2)} entry</>
              )}
              {tournament.entryFee === 0 && <> &bull; Free entry</>}
            </p>
          </div>
          <span className={`text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded ${
            isActive ? 'text-emerald-400 bg-emerald-400/10' :
            isCompleted ? 'text-neutral-400 bg-neutral-400/10' :
            'text-amber-400 bg-amber-400/10'
          }`}>
            {isOpen ? 'Accepting Teams' : tournament.status}
          </span>
        </div>

        {/* Progress bar for ACTIVE */}
        {isActive && tournament.startRound && tournament.endRound && (() => {
          const totalRounds = tournament.endRound! - tournament.startRound! + 1;
          const elapsed = Math.max(0, Math.min(currentRound - tournament.startRound! + 1, totalRounds));
          const pct = Math.round((elapsed / totalRounds) * 100);
          return (
            <div className="mb-3">
              <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                <div className="h-full bg-cyber-500 transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-[10px] text-neutral-500 mt-1">
                Round {elapsed}/{totalRounds} &bull; Tracking rounds {tournament.startRound}&ndash;{tournament.endRound}
              </p>
            </div>
          );
        })()}

        {/* Prize Pool */}
        {(tournament.prizePool > 0 || tournament.entryFee > 0) && (
          <div className="flex items-center gap-4 mb-2">
            <div className="px-3 py-1.5 bg-neutral-800/50 rounded">
              <span className="text-[10px] text-neutral-500 uppercase tracking-wider">Prize Pool</span>
              <span className="ml-2 text-sm font-mono text-emerald-400">${tournament.prizePool.toFixed(2)}</span>
            </div>
            {isOpen && (
              <span className="text-[10px] text-neutral-600">
                Grows with each team that joins
              </span>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2">
          {isOpen && teams.length >= 2 && (
            <Button size="sm" onClick={handleStart} loading={starting}>
              Start Tournament
            </Button>
          )}
          {isOpen && teams.length < 2 && (
            <span className="text-[10px] text-neutral-500">Need at least 2 teams to start</span>
          )}
          {isActive && (
            <span className="text-xs text-cyber-500 uppercase tracking-wider">
              Live &mdash; scoring from real arena rounds
            </span>
          )}
          {isCompleted && (
            <span className="text-xs text-neutral-500 uppercase tracking-wider">
              Tournament complete
            </span>
          )}
        </div>

        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      </Card>

      {/* Join confirmation — shown after successfully joining */}
      {isOpen && alreadyJoined && myTeam && (
        <Card>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-emerald-400 font-medium">
                You&apos;re in! Team registered.
              </p>
              <p className="text-xs text-neutral-400 mt-1">
                <span className="text-neutral-200 font-medium">{myTeam.teamName}</span>
              </p>
              <div className="flex items-center gap-2 mt-2">
                {myTeam.picks.map(p => (
                  <div key={p.pickNumber} className="flex items-center gap-1 px-2 py-1 bg-neutral-800/50 rounded">
                    <AgentAvatar name={p.agentName || 'Unknown'} size={16} />
                    <span className="text-[11px] text-neutral-300">{p.agentName || '?'}</span>
                    <Badge variant={getTypeBadgeVariant(p.agentType || '')} className="ml-1">
                      {p.agentType || '?'}
                    </Badge>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-neutral-500 mt-2">
                Waiting for more teams to join before the tournament starts.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Connect wallet prompt */}
      {isOpen && !userWallet && (
        <Card>
          <p className="text-xs text-neutral-500">Connect your wallet to join this tournament.</p>
        </Card>
      )}

      {/* Join Section (OPEN only, wallet connected, not already joined) */}
      {isOpen && userWallet && !alreadyJoined && (
        <Card>
          <h3 className="text-sm font-bold text-neutral-200 uppercase tracking-wider mb-4">
            Draft Your Team
          </h3>

          <div className="space-y-3">
            <div>
              <label className="block text-[10px] text-neutral-500 uppercase tracking-wider mb-1">
                Team Name
              </label>
              <input
                type="text"
                value={teamName}
                onChange={e => setTeamName(e.target.value)}
                placeholder="e.g., Alpha Squad"
                className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-sm text-neutral-200 focus:border-cyber-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[0, 1, 2].map(i => (
                <div key={i}>
                  <label className="block text-[10px] text-neutral-500 uppercase tracking-wider mb-1">
                    Pick {i + 1}
                  </label>
                  <select
                    value={picks[i]}
                    onChange={e => updatePick(i, e.target.value)}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-sm text-neutral-200 focus:border-cyber-500 focus:outline-none"
                  >
                    <option value="">Select agent...</option>
                    {availableAgents
                      .filter(a => !picks.includes(a.id) || picks[i] === a.id)
                      .map(a => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({a.agent_type})
                        </option>
                      ))}
                  </select>
                </div>
              ))}
            </div>

            {joinStatus && (
              <p className="text-xs text-cyber-500 animate-pulse">{joinStatus}</p>
            )}

            <Button
              size="sm"
              onClick={handleJoin}
              loading={joining}
              disabled={!teamName.trim() || picks.some(p => !p)}
            >
              {tournament.entryFee > 0
                ? `Join Tournament — $${tournament.entryFee.toFixed(2)} USDC`
                : 'Join Tournament'}
            </Button>
            {tournament.entryFee > 0 && (
              <p className="text-[10px] text-neutral-600 mt-1">
                Entry fee is transferred to the prize pool on join.
              </p>
            )}
          </div>
        </Card>
      )}

      {/* Leaderboard */}
      <Card>
        <h3 className="text-sm font-bold text-neutral-200 uppercase tracking-wider mb-4">
          {isCompleted ? 'Final Standings' : isActive ? 'Live Standings' : 'Enrolled Teams'}
        </h3>

        {teams.length === 0 ? (
          <p className="text-xs text-neutral-500">No teams yet</p>
        ) : (
          <div className="space-y-2">
            {teams.map((team, i) => {
              const isExpanded = expandedTeamId === team.id;
              const rankNum = team.rank || i + 1;
              const isMyTeam = userWallet && team.playerWallet === userWallet;

              return (
                <div key={team.id} className={`border rounded-lg overflow-hidden ${
                  isMyTeam ? 'border-cyber-500/30' : 'border-neutral-800'
                }`}>
                  {/* Team row */}
                  <button
                    onClick={() => setExpandedTeamId(isExpanded ? null : team.id)}
                    className={`w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-800/30 transition-colors ${
                      i < 3 && (isActive || isCompleted) ? 'bg-neutral-800/20' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`text-sm font-bold w-6 ${
                        rankNum === 1 ? 'text-amber-400' :
                        rankNum === 2 ? 'text-neutral-300' :
                        rankNum === 3 ? 'text-amber-700' :
                        'text-neutral-500'
                      }`}>
                        {rankNum}
                      </span>
                      <div className="text-left">
                        <div className="text-sm text-neutral-200 font-medium">
                          {team.teamName}
                          {isMyTeam && (
                            <span className="ml-2 text-[10px] text-cyber-500 uppercase tracking-wider">You</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          {team.picks.map(p => (
                            <AgentAvatar key={p.pickNumber} name={p.agentName || 'Unknown'} size={16} />
                          ))}
                          <span className="text-[10px] text-neutral-500 ml-1">
                            {team.picks.map(p => p.agentName || '?').join(', ')}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {(isActive || isCompleted) && (
                        <span className={`text-sm font-mono ${
                          team.totalScore >= 0 ? 'text-emerald-500' : 'text-red-400'
                        }`}>
                          {team.totalScore >= 0 ? '+' : ''}{team.totalScore.toFixed(4)}
                        </span>
                      )}
                      {isCompleted && team.payoutAmount > 0 && (
                        <span className="text-xs font-mono text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
                          +${team.payoutAmount.toFixed(2)}
                        </span>
                      )}
                      <svg
                        className={`w-4 h-4 text-neutral-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  {/* Expanded picks breakdown */}
                  {isExpanded && (
                    <div className="border-t border-neutral-800 px-4 py-3 bg-neutral-900/50">
                      <table className="w-full">
                        <thead>
                          <tr className="text-[10px] text-neutral-500 uppercase tracking-wider">
                            <th className="text-left py-1 pr-3">#</th>
                            <th className="text-left py-1 pr-3">Agent</th>
                            <th className="text-left py-1 pr-3">Type</th>
                            {(isActive || isCompleted) && (
                              <>
                                <th className="text-right py-1 pr-3">Start</th>
                                <th className="text-right py-1 pr-3">End</th>
                                <th className="text-right py-1">Delta</th>
                              </>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {team.picks.map(pick => (
                            <tr key={pick.id || pick.pickNumber} className="border-t border-neutral-800/50">
                              <td className="py-1.5 pr-3 text-xs text-neutral-500">{pick.pickNumber}</td>
                              <td className="py-1.5 pr-3">
                                <div className="flex items-center gap-1.5">
                                  <AgentAvatar name={pick.agentName || 'Unknown'} size={18} />
                                  <span className="text-xs text-neutral-200 font-medium">{pick.agentName || 'Unknown'}</span>
                                </div>
                              </td>
                              <td className="py-1.5 pr-3">
                                <Badge variant={getTypeBadgeVariant(pick.agentType || '')}>
                                  {pick.agentType || '?'}
                                </Badge>
                              </td>
                              {(isActive || isCompleted) && (
                                <>
                                  <td className="py-1.5 pr-3 text-xs text-right text-neutral-400 font-mono">
                                    {pick.balanceStart != null ? pick.balanceStart.toFixed(4) : '—'}
                                  </td>
                                  <td className="py-1.5 pr-3 text-xs text-right text-neutral-400 font-mono">
                                    {pick.balanceEnd != null ? pick.balanceEnd.toFixed(4) : '—'}
                                  </td>
                                  <td className={`py-1.5 text-xs text-right font-mono ${
                                    (pick.balanceDelta || 0) >= 0 ? 'text-emerald-500' : 'text-red-400'
                                  }`}>
                                    {pick.balanceDelta != null
                                      ? `${pick.balanceDelta >= 0 ? '+' : ''}${pick.balanceDelta.toFixed(4)}`
                                      : '—'}
                                  </td>
                                </>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
