"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

// ============================================================================
// TYPES
// ============================================================================

interface TaskStats {
  total_tasks: number;
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  total_value: number;
  recent_tasks: {
    id: string;
    type: string;
    status: string;
    max_bid: number;
    created_at: string;
  }[];
}

interface AgentRow {
  id: string;
  name: string;
  type: string;
  status: string;
  balance: number;
  reputation: number;
  tasks_completed: number;
  tasks_failed: number;
  total_bids: number;
  personality: string;
}

interface AgentState {
  id: string;
  name: string;
  balance: number;
  reputation: number;
  status: string;
}

interface SimV2RoundResult {
  round: number;
  tasksCreated: number;
  bidsPlaced: number;
  tasksCompleted: number;
  totalRevenue: number;
  brainWakeups: number;
  agentStates: AgentState[];
}

interface SimResult {
  rounds_completed: number;
  total_tasks: number;
  total_bids: number;
  total_completed: number;
  total_revenue: number;
  rounds: SimV2RoundResult[];
}

interface AgentLeaderboardRow {
  id: string;
  name: string;
  startBalance: number;
  endBalance: number;
  change: number;
  tasksWon: number;
}

interface RoundEvent {
  id: string;
  event_type: 'round_started' | 'round_complete';
  description: string;
  amount: number | null;
  round_number: number | null;
  created_at: string;
  metadata: {
    holder?: string;
    rounds_requested?: number;
    tasks_per_round?: number;
    agent_count?: number;
    tasks_processed?: number;
    tasks_completed?: number;
    bids_placed?: number;
    brain_wakeups?: number;
    season_number?: number;
  };
}

interface ErrorEvent {
  id: string;
  event_type: 'system_error';
  description: string;
  round_number: number | null;
  created_at: string;
  metadata: {
    source: 'blockchain' | 'llm' | 'payment' | 'database';
    error_message: string;
    stack_trace?: string;
    agent_name?: string;
    agent_id?: string;
    detail?: string;
  };
}

type GeneratorMode = "steady" | "waves" | "scenario";
type ScenarioType =
  | "bull_market"
  | "bear_market"
  | "catalog_shortage"
  | "review_boom"
  | "race_to_bottom"
  | "gold_rush"
  | "mixed";

// ============================================================================
// ADMIN PAGE
// ============================================================================

export default function AdminPage() {
  // Task generator state
  const [genMode, setGenMode] = useState<GeneratorMode>("steady");
  const [genCount, setGenCount] = useState(5);
  const [genScenario, setGenScenario] = useState<ScenarioType>("mixed");
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<string | null>(null);

  // Agent creation state
  const [agentName, setAgentName] = useState("");
  const [agentType, setAgentType] = useState("CATALOG");
  const [agentPersonality, setAgentPersonality] = useState("conservative");
  const [agentBalance, setAgentBalance] = useState(1.0);
  const [batchCount, setBatchCount] = useState(6);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [createResult, setCreateResult] = useState<string | null>(null);

  // Simulation state
  const [simTasksPerRound, setSimTasksPerRound] = useState(3);
  const [simRounds, setSimRounds] = useState(5);
  const [simAgentMode, setSimAgentMode] = useState<"all" | number>("all");
  const [simSelectedAgents, setSimSelectedAgents] = useState<Set<string>>(new Set());
  const [simShowAgentPicker, setSimShowAgentPicker] = useState(false);
  const [simUseBlockchain, setSimUseBlockchain] = useState(false);
  const [simUseLLM, setSimUseLLM] = useState(false);
  const [simRunning, setSimRunning] = useState(false);
  const [simCurrentRound, setSimCurrentRound] = useState(0);
  const [simLog, setSimLog] = useState<string[]>([]);
  const [simTotalResult, setSimTotalResult] = useState<SimResult | null>(null);
  const [simAgentLeaderboard, setSimAgentLeaderboard] = useState<AgentLeaderboardRow[]>([]);
  const simAbort = useRef(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Report config state
  const [reportInterval, setReportInterval] = useState(20);
  const [reportModel, setReportModel] = useState("gemini-2.5-flash-lite");
  const [lastReportRound, setLastReportRound] = useState(0);
  const [currentRound, setCurrentRound] = useState(0);
  const [reportConfigLoaded, setReportConfigLoaded] = useState(false);
  const [savingReportConfig, setSavingReportConfig] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [reportResult, setReportResult] = useState<string | null>(null);

  // Per-activity LLM model state
  const [llmModels, setLlmModels] = useState<Record<string, string>>({
    narrator: "gemini-2.5-flash-lite",
    brain: "gemini-2.5-flash-lite",
    qbr: "gemini-2.5-flash-lite",
    exception: "gemini-2.5-flash-lite",
    reports: "gemini-2.5-flash-lite",
  });
  const [savingLlmModels, setSavingLlmModels] = useState(false);
  const [llmModelsResult, setLlmModelsResult] = useState<string | null>(null);

  // Round history + error log
  const [roundEvents, setRoundEvents] = useState<RoundEvent[]>([]);
  const [errorEvents, setErrorEvents] = useState<ErrorEvent[]>([]);
  const [roundHistoryOpen, setRoundHistoryOpen] = useState(true);
  const [errorLogOpen, setErrorLogOpen] = useState(true);
  const [expandedError, setExpandedError] = useState<string | null>(null);

  // Market reset state
  const [resetPolicies, setResetPolicies] = useState(true);
  const [resetReputations, setResetReputations] = useState(true);
  const [resetBrainCooldown, setResetBrainCooldown] = useState(true);
  const [resetBalances, setResetBalances] = useState(false);
  const [resetBalanceAmount, setResetBalanceAmount] = useState(1.0);
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<string | null>(null);

  // Dashboard data
  const [taskStats, setTaskStats] = useState<TaskStats | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch round history + error events
  const refreshAdminLogs = useCallback(async () => {
    try {
      const [startedRes, completeRes, errorsRes] = await Promise.allSettled([
        fetch("/api/events?event_type=round_started&limit=50"),
        fetch("/api/events?event_type=round_complete&limit=50"),
        fetch("/api/events?event_type=system_error&limit=50"),
      ]);

      // Merge round_started + round_complete events
      const rounds: RoundEvent[] = [];
      if (startedRes.status === "fulfilled" && startedRes.value.ok) {
        const data = await startedRes.value.json();
        if (data.success && data.data) rounds.push(...data.data);
      }
      if (completeRes.status === "fulfilled" && completeRes.value.ok) {
        const data = await completeRes.value.json();
        if (data.success && data.data) rounds.push(...data.data);
      }
      rounds.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setRoundEvents(rounds.slice(0, 50));

      if (errorsRes.status === "fulfilled" && errorsRes.value.ok) {
        const data = await errorsRes.value.json();
        if (data.success && data.data) setErrorEvents(data.data);
      }
    } catch {
      // Silently fail
    }
  }, []);

  // Fetch dashboard data
  const refreshData = useCallback(async () => {
    try {
      const [taskRes, agentsRes] = await Promise.allSettled([
        fetch("/api/admin/task-generator"),
        fetch("/api/agents"),
      ]);

      if (taskRes.status === "fulfilled" && taskRes.value.ok) {
        const data = await taskRes.value.json();
        if (data.success) setTaskStats(data.data);
      }

      if (agentsRes.status === "fulfilled" && agentsRes.value.ok) {
        const data = await agentsRes.value.json();
        if (data.success && data.data) {
          // Parse personality from metadata_uri
          const parsed = data.data.map((a: AgentRow & { metadata_uri?: string }) => {
            let personality = "unknown";
            try {
              const meta = JSON.parse(a.metadata_uri || "{}");
              personality = meta.personality || "unknown";
            } catch {
              // ignore
            }
            return { ...a, personality };
          });
          setAgents(parsed);
        }
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshData();
    const interval = setInterval(refreshData, 5000);
    return () => clearInterval(interval);
  }, [refreshData]);

  // Refresh admin logs (10s interval)
  useEffect(() => {
    refreshAdminLogs();
    const interval = setInterval(refreshAdminLogs, 10000);
    return () => clearInterval(interval);
  }, [refreshAdminLogs]);

  // Fetch report config on mount
  useEffect(() => {
    async function loadReportConfig() {
      try {
        const res = await fetch("/api/reports/config");
        const data = await res.json();
        if (data.success && data.config) {
          setReportInterval(data.config.report_interval);
          setReportModel(data.config.report_model);
          if (data.config.llm_models) {
            setLlmModels(data.config.llm_models);
          }
          setLastReportRound(data.config.last_report_round);
          setCurrentRound(data.config.current_round);
          setReportConfigLoaded(true);
        }
      } catch {
        // Silently fail - report config is optional
      }
    }
    loadReportConfig();
  }, []);

  // Auto-scroll simulation log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [simLog]);

  // Market reset handler
  const handleMarketReset = async () => {
    if (!confirm('This will reset the marketplace. Agents will re-learn their strategies from scratch. Continue?')) return;
    setResetting(true);
    setResetResult(null);
    try {
      const res = await fetch('/api/admin/market-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reset_policies: resetPolicies,
          reset_reputations: resetReputations,
          reset_brain_cooldown: resetBrainCooldown,
          reset_balances: resetBalances,
          balance_amount: resetBalanceAmount,
        }),
      });
      const data = await res.json();
      if (data.success) {
        const applied = (data.data.resets_applied as string[]).join(', ');
        setResetResult(`Reset complete: ${applied}`);
        refreshData();
      } else {
        setResetResult(`Error: ${data.error}`);
      }
    } catch (err) {
      setResetResult(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setResetting(false);
    }
  };

  // Generate tasks
  const handleGenerate = async () => {
    setGenerating(true);
    setGenResult(null);
    try {
      const res = await fetch("/api/admin/task-generator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: genMode, count: genCount, scenario: genScenario }),
      });
      const data = await res.json();
      if (data.success) {
        setGenResult(`Created ${data.data.tasks_created} tasks (${genMode})`);
        refreshData();
      } else {
        setGenResult(`Error: ${data.error}`);
      }
    } catch (err) {
      setGenResult(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setGenerating(false);
    }
  };

  // Create single agent
  const handleCreateAgent = async () => {
    if (!agentName.trim()) return;
    setCreatingAgent(true);
    setCreateResult(null);
    try {
      const res = await fetch("/api/admin/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: agentName.trim(),
          type: agentType,
          personality: agentPersonality,
          balance: agentBalance,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setCreateResult(`Created: ${data.data.name} (${data.data.id.slice(0, 8)}...)`);
        setAgentName("");
        refreshData();
      } else {
        setCreateResult(`Error: ${data.error}`);
      }
    } catch (err) {
      setCreateResult(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setCreatingAgent(false);
    }
  };

  // Create batch agents
  const handleCreateBatch = async () => {
    setCreatingAgent(true);
    setCreateResult(null);
    try {
      const res = await fetch("/api/admin/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: batchCount, balance: agentBalance }),
      });
      const data = await res.json();
      if (data.success) {
        const names = data.data.map((a: { name: string }) => a.name).join(", ");
        setCreateResult(`Created ${data.count} agents: ${names}`);
        refreshData();
      } else {
        setCreateResult(`Error: ${data.error}`);
      }
    } catch (err) {
      setCreateResult(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setCreatingAgent(false);
    }
  };

  // Compute which agents to simulate
  const getSimAgentIds = (): string[] | undefined => {
    if (simSelectedAgents.size > 0) return Array.from(simSelectedAgents);
    return undefined;
  };

  const getSimAgentCount = (): number | undefined => {
    if (simSelectedAgents.size > 0) return undefined; // specific IDs override count
    if (simAgentMode === "all") return undefined;
    return simAgentMode;
  };

  const toggleAgentSelection = (agentId: string) => {
    setSimSelectedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  };

  // Run simulation - one round at a time for live updates (v2 endpoint)
  const handleRunSimulation = async () => {
    simAbort.current = false;
    setSimRunning(true);
    setSimCurrentRound(0);
    setSimAgentLeaderboard([]);
    setSimTotalResult(null);

    const agentLabel =
      simSelectedAgents.size > 0
        ? `${simSelectedAgents.size} selected agents`
        : simAgentMode === "all"
        ? `all agents`
        : `${simAgentMode} random agents`;
    setSimLog([`Starting: ${simRounds} rounds x ${simTasksPerRound} tasks/round (${agentLabel})`]);

    // Capture start balances
    const startBals = new Map<string, number>();
    activeAgents.forEach((a) => startBals.set(a.id, a.balance));

    let totalTasks = 0;
    let totalBids = 0;
    let totalCompleted = 0;
    let totalRevenue = 0;
    const allRounds: SimV2RoundResult[] = [];

    for (let r = 1; r <= simRounds; r++) {
      if (simAbort.current) {
        setSimLog((prev) => [...prev, `--- Stopped after round ${r - 1} ---`]);
        break;
      }

      setSimCurrentRound(r);

      try {
        const res = await fetch("/api/admin/simulate-v2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tasks_per_round: simTasksPerRound,
            rounds: 1,
            agent_ids: getSimAgentIds(),
            agent_count: getSimAgentCount(),
            use_blockchain: simUseBlockchain,
            use_llm: simUseLLM,
          }),
        });
        const data = await res.json();

        if (data.success && data.data.rounds.length > 0) {
          const round = data.data.rounds[0] as SimV2RoundResult;
          allRounds.push(round);

          totalTasks += round.tasksCreated;
          totalBids += round.bidsPlaced;
          totalCompleted += round.tasksCompleted;
          totalRevenue += round.totalRevenue;

          // Track agent states for leaderboard
          if (round.agentStates) {
            for (const a of round.agentStates) {
              if (!startBals.has(a.id)) startBals.set(a.id, a.balance);
            }
          }

          // Count task wins (tasksCompleted is total for round, attribute to round)
          // We track per-agent from agentStates balance changes as proxy
          if (round.tasksCompleted > 0 && round.agentStates) {
            // Simple: distribute wins count later from final data
          }

          const line = `Round ${r}/${simRounds}: ${round.tasksCreated} tasks, ${round.bidsPlaced} bids, ${round.tasksCompleted} won, $${round.totalRevenue.toFixed(4)} rev${round.brainWakeups > 0 ? `, ${round.brainWakeups} wakeups` : ""}`;
          setSimLog((prev) => [...prev, line]);

          // Auto-trigger report generation at interval boundaries
          if (reportConfigLoaded && reportInterval > 0) {
            // The simulate-v2 endpoint increments current_round, estimate ending round
            const endingRound = currentRound + r;
            if (endingRound > 0 && endingRound % reportInterval === 0 && endingRound > lastReportRound) {
              const reportNum = Math.floor(endingRound / reportInterval);
              setSimLog((prev) => [...prev, `[REPORT] Generating industry report #${reportNum}...`]);
              fetch("/api/reports/generate", { method: "POST" })
                .then((res) => res.json())
                .then((data) => {
                  if (data.success) {
                    setLastReportRound(endingRound);
                    setSimLog((prev) => [...prev, `[REPORT] Report #${reportNum} generated (${data.report?.generation_time_ms}ms)`]);
                  } else {
                    setSimLog((prev) => [...prev, `[REPORT] Failed: ${data.error}`]);
                  }
                })
                .catch(() => {
                  setSimLog((prev) => [...prev, `[REPORT] Generation request failed`]);
                });
            }
          }

          refreshData();
        } else {
          setSimLog((prev) => [
            ...prev,
            `Round ${r} FAILED: ${data.error || "No results"}`,
          ]);
        }
      } catch (err) {
        setSimLog((prev) => [
          ...prev,
          `Round ${r} ERROR: ${err instanceof Error ? err.message : "Unknown"}`,
        ]);
      }

      if (r < simRounds) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

    // Build leaderboard from last round's agentStates
    const lastRound = allRounds[allRounds.length - 1];
    if (lastRound?.agentStates) {
      const lb: AgentLeaderboardRow[] = lastRound.agentStates.map((a) => {
        const start = startBals.get(a.id) ?? a.balance;
        return {
          id: a.id,
          name: a.name,
          startBalance: start,
          endBalance: a.balance,
          change: a.balance - start,
          tasksWon: 0, // filled below
        };
      });
      // Rough attribution: count wins from total per round / agents
      // Since we can't get per-agent wins from v2, we'll leave as 0 for now
      lb.sort((a, b) => b.change - a.change);
      setSimAgentLeaderboard(lb);
    }

    setSimTotalResult({
      rounds_completed: allRounds.length,
      total_tasks: totalTasks,
      total_bids: totalBids,
      total_completed: totalCompleted,
      total_revenue: Math.round(totalRevenue * 10000) / 10000,
      rounds: allRounds,
    });

    setSimLog((prev) => [
      ...prev,
      ``,
      `=== COMPLETE: ${allRounds.length} rounds | ${totalTasks} tasks | ${totalBids} bids | ${totalCompleted} won | $${totalRevenue.toFixed(4)} rev ===`,
    ]);

    setSimRunning(false);
    refreshData();
  };

  const handleStopSimulation = () => {
    simAbort.current = true;
  };

  // Derived stats
  const activeAgents = agents.filter((a) => a.status === "ACTIVE");
  const totalBalance = activeAgents.reduce((s, a) => s + a.balance, 0);

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-lg font-medium text-neutral-200 uppercase tracking-wider">
            Admin Console
          </h1>
          <p className="text-xs text-neutral-500 mt-1">
            Simulation, task generation, and agent management
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={refreshData}>
          Refresh
        </Button>
      </div>

      {/* Stats Overview */}
      {!loading && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
          <StatCard label="Active Agents" value={activeAgents.length} />
          <StatCard label="Total Tasks" value={taskStats?.total_tasks ?? 0} />
          <StatCard label="Open" value={taskStats?.by_status?.OPEN ?? 0} />
          <StatCard label="Completed" value={taskStats?.by_status?.COMPLETED ?? 0} />
          <StatCard
            label="Total Balance"
            value={`$${totalBalance.toFixed(2)}`}
          />
        </div>
      )}

      {/* ================================================================ */}
      {/* SIMULATION PANEL - Full width, top priority */}
      {/* ================================================================ */}
      <Card className="mb-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xs text-neutral-400 uppercase tracking-wider mb-1">
              Simulation Runner
            </h2>
            <p className="text-xs text-neutral-600">
              Configure agents, tasks, and rounds — then run the v2 pipeline
            </p>
          </div>
          {simRunning && (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-cyber-500 animate-pulse" />
              <span className="text-xs text-cyber-500">
                Round {simCurrentRound}/{simRounds}
              </span>
            </div>
          )}
        </div>

        {/* Config row: Agents / Tasks / Rounds */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Agent selector */}
          <div>
            <label className="block text-xs text-neutral-500 mb-1.5">Agents</label>
            <div className="flex flex-wrap gap-1.5">
              {(["all", 3, 6, 9] as const).map((opt) => (
                <button
                  key={String(opt)}
                  onClick={() => {
                    setSimAgentMode(opt);
                    if (opt !== "all") setSimSelectedAgents(new Set());
                  }}
                  disabled={simRunning}
                  className={`px-3 py-1.5 text-xs border rounded transition-colors ${
                    simAgentMode === opt && simSelectedAgents.size === 0
                      ? "bg-cyber-600/20 text-cyber-500 border-cyber-700"
                      : "text-neutral-500 border-neutral-700 hover:text-neutral-300"
                  } disabled:opacity-40`}
                >
                  {opt === "all" ? "All" : opt}
                </button>
              ))}
              <button
                onClick={() => setSimShowAgentPicker((v) => !v)}
                disabled={simRunning}
                className={`px-3 py-1.5 text-xs border rounded transition-colors ${
                  simSelectedAgents.size > 0
                    ? "bg-cyber-600/20 text-cyber-500 border-cyber-700"
                    : "text-neutral-500 border-neutral-700 hover:text-neutral-300"
                } disabled:opacity-40`}
              >
                Pick{simSelectedAgents.size > 0 ? ` (${simSelectedAgents.size})` : ""}
              </button>
            </div>
          </div>

          {/* Tasks per round */}
          <div>
            <label className="block text-xs text-neutral-500 mb-1.5">Tasks / round</label>
            <div className="flex flex-wrap gap-1.5">
              {[3, 6, 9].map((n) => (
                <button
                  key={n}
                  onClick={() => setSimTasksPerRound(n)}
                  disabled={simRunning}
                  className={`px-3 py-1.5 text-xs border rounded transition-colors ${
                    simTasksPerRound === n
                      ? "bg-cyber-600/20 text-cyber-500 border-cyber-700"
                      : "text-neutral-500 border-neutral-700 hover:text-neutral-300"
                  } disabled:opacity-40`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Rounds */}
          <div>
            <label className="block text-xs text-neutral-500 mb-1.5">Rounds</label>
            <div className="flex flex-wrap gap-1.5">
              {[1, 5, 10, 20, 50].map((n) => (
                <button
                  key={n}
                  onClick={() => setSimRounds(n)}
                  disabled={simRunning}
                  className={`px-3 py-1.5 text-xs border rounded transition-colors ${
                    simRounds === n
                      ? "bg-cyber-600/20 text-cyber-500 border-cyber-700"
                      : "text-neutral-500 border-neutral-700 hover:text-neutral-300"
                  } disabled:opacity-40`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Mode toggles */}
        <div className="flex items-center gap-6 flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={simUseBlockchain}
              onChange={(e) => setSimUseBlockchain(e.target.checked)}
              disabled={simRunning}
              className="accent-cyber-500 w-3.5 h-3.5"
            />
            <span className="text-xs text-neutral-400">Blockchain</span>
            <span className="text-xs text-neutral-600">(real USDC transfers)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={simUseLLM}
              onChange={(e) => setSimUseLLM(e.target.checked)}
              disabled={simRunning}
              className="accent-cyber-500 w-3.5 h-3.5"
            />
            <span className="text-xs text-neutral-400">LLM Brain</span>
            <span className="text-xs text-neutral-600">(Gemini wakeups)</span>
          </label>
        </div>

        {/* Agent picker dropdown */}
        {simShowAgentPicker && activeAgents.length > 0 && (
          <div className="bg-void rounded border border-neutral-800 p-3 space-y-1.5 max-h-48 overflow-y-auto">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-neutral-500 uppercase tracking-wider">Select agents</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setSimSelectedAgents(new Set(activeAgents.map((a) => a.id)))}
                  className="text-xs text-cyber-600 hover:text-cyber-500"
                >
                  All
                </button>
                <button
                  onClick={() => setSimSelectedAgents(new Set())}
                  className="text-xs text-neutral-500 hover:text-neutral-300"
                >
                  None
                </button>
              </div>
            </div>
            {activeAgents.map((agent) => (
              <label
                key={agent.id}
                className="flex items-center gap-2.5 py-1 px-1 rounded hover:bg-neutral-800/30 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={simSelectedAgents.has(agent.id)}
                  onChange={() => toggleAgentSelection(agent.id)}
                  className="accent-cyber-500 w-3.5 h-3.5"
                />
                <span className="text-xs text-neutral-200 flex-1">{agent.name}</span>
                <Badge
                  variant={
                    agent.type === "CATALOG" ? "catalog" : agent.type === "REVIEW" ? "review" : "curation"
                  }
                >
                  {agent.type}
                </Badge>
                <span className="text-xs text-neutral-500 tabular-nums w-16 text-right">
                  ${agent.balance.toFixed(3)}
                </span>
              </label>
            ))}
          </div>
        )}

        {/* Run / Stop button */}
        <div>
          {!simRunning ? (
            <Button
              variant="primary"
              fullWidth
              onClick={handleRunSimulation}
              disabled={activeAgents.length === 0}
            >
              Run {simRounds} Rounds x {simTasksPerRound} Tasks
              {simSelectedAgents.size > 0 ? ` (${simSelectedAgents.size} agents)` : simAgentMode !== "all" ? ` (${simAgentMode} agents)` : ""}
            </Button>
          ) : (
            <Button variant="danger" fullWidth onClick={handleStopSimulation}>
              Stop after current round ({simCurrentRound}/{simRounds})
            </Button>
          )}
        </div>

        {activeAgents.length === 0 && !loading && (
          <div className="text-xs text-amber-500 bg-amber-900/10 border border-amber-900/30 rounded p-2">
            Create agents first using the panel below before running a simulation.
          </div>
        )}

        {/* Progress bar */}
        {simRunning && (
          <div className="w-full bg-neutral-800 rounded-full h-1.5">
            <div
              className="bg-cyber-500 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${(simCurrentRound / simRounds) * 100}%` }}
            />
          </div>
        )}

        {/* Live log */}
        {simLog.length > 0 && (
          <div className="bg-void rounded border border-neutral-800 p-3 max-h-52 overflow-y-auto font-mono">
            {simLog.map((line, i) => (
              <div
                key={i}
                className={`text-xs leading-relaxed whitespace-pre-wrap ${
                  line.includes("===")
                    ? "text-cyber-500 font-medium"
                    : line.includes("FAILED") || line.includes("ERROR")
                    ? "text-red-400"
                    : line.startsWith("Starting") || line.startsWith("---")
                    ? "text-neutral-500"
                    : "text-neutral-400"
                }`}
              >
                {line}
              </div>
            ))}
            {simRunning && (
              <span className="text-cyber-500 animate-blink text-xs">_</span>
            )}
            <div ref={logEndRef} />
          </div>
        )}

        {/* Summary stats */}
        {simTotalResult && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <MiniStat label="Rounds" value={simTotalResult.rounds_completed} />
              <MiniStat label="Tasks" value={simTotalResult.total_tasks} />
              <MiniStat label="Bids" value={simTotalResult.total_bids} />
              <MiniStat label="Won" value={simTotalResult.total_completed} color="emerald" />
              <MiniStat label="Revenue" value={`$${simTotalResult.total_revenue.toFixed(4)}`} color="cyber" />
            </div>

            {/* Agent leaderboard */}
            {simAgentLeaderboard.length > 0 && (
              <div>
                <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2">
                  Agent Leaderboard
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-neutral-600 uppercase tracking-wider border-b border-neutral-800">
                        <th className="text-left py-1.5 pr-3">Agent</th>
                        <th className="text-right py-1.5 pr-3">Start</th>
                        <th className="text-right py-1.5 pr-3">End</th>
                        <th className="text-right py-1.5">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {simAgentLeaderboard.map((row) => (
                        <tr key={row.id} className="border-b border-neutral-800/30">
                          <td className="py-1.5 pr-3 text-neutral-200">{row.name}</td>
                          <td className="py-1.5 pr-3 text-right text-neutral-500 tabular-nums">
                            ${row.startBalance.toFixed(4)}
                          </td>
                          <td className="py-1.5 pr-3 text-right text-neutral-300 tabular-nums">
                            ${row.endBalance.toFixed(4)}
                          </td>
                          <td
                            className={`py-1.5 text-right tabular-nums ${
                              row.change > 0
                                ? "text-emerald-400"
                                : row.change < 0
                                ? "text-red-400"
                                : "text-neutral-500"
                            }`}
                          >
                            {row.change >= 0 ? "+" : ""}
                            ${row.change.toFixed(4)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ================================================================ */}
      {/* MARKET RESET */}
      {/* ================================================================ */}
      <Card className="mb-6 space-y-4">
        <div>
          <h2 className="text-xs text-neutral-400 uppercase tracking-wider mb-1">
            Market Reset
          </h2>
          <p className="text-xs text-neutral-600">
            Break price stalemates by resetting agents to personality defaults
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Reset Policies */}
          <label className="flex items-start gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={resetPolicies}
              onChange={(e) => setResetPolicies(e.target.checked)}
              className="mt-0.5 accent-blue-500"
            />
            <div>
              <span className="text-sm text-neutral-200 group-hover:text-white">Reset Policies</span>
              <p className="text-[10px] text-neutral-600 mt-0.5">
                Restore personality defaults (conservative=25%, balanced=20%, aggressive=16%)
              </p>
            </div>
          </label>

          {/* Randomize Reputations */}
          <label className="flex items-start gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={resetReputations}
              onChange={(e) => setResetReputations(e.target.checked)}
              className="mt-0.5 accent-blue-500"
            />
            <div>
              <span className="text-sm text-neutral-200 group-hover:text-white">Randomize Reputations</span>
              <p className="text-[10px] text-neutral-600 mt-0.5">
                Random 3.2-4.8 — creates scoring differentiation
              </p>
            </div>
          </label>

          {/* Reset Brain Cooldown */}
          <label className="flex items-start gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={resetBrainCooldown}
              onChange={(e) => setResetBrainCooldown(e.target.checked)}
              className="mt-0.5 accent-blue-500"
            />
            <div>
              <span className="text-sm text-neutral-200 group-hover:text-white">Reset Brain Cooldown</span>
              <p className="text-[10px] text-neutral-600 mt-0.5">
                All agents wake up next round for fresh strategic review
              </p>
            </div>
          </label>

          {/* Equalize Balances */}
          <label className="flex items-start gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={resetBalances}
              onChange={(e) => setResetBalances(e.target.checked)}
              className="mt-0.5 accent-blue-500"
            />
            <div>
              <span className="text-sm text-neutral-200 group-hover:text-white">Equalize Balances</span>
              <p className="text-[10px] text-neutral-600 mt-0.5">
                Set all to same USDC (DB only)
              </p>
              {resetBalances && (
                <input
                  type="number"
                  value={resetBalanceAmount}
                  onChange={(e) => setResetBalanceAmount(parseFloat(e.target.value) || 1.0)}
                  step="0.5"
                  min="0.5"
                  className="mt-1 w-20 text-xs bg-elevated border border-neutral-700 rounded px-2 py-1 text-neutral-200"
                />
              )}
            </div>
          </label>
        </div>

        <div className="flex items-center gap-3 pt-2 border-t border-neutral-800">
          <Button
            variant="primary"
            size="sm"
            onClick={handleMarketReset}
            disabled={resetting || (!resetPolicies && !resetReputations && !resetBrainCooldown && !resetBalances)}
          >
            {resetting ? 'Resetting...' : 'Reset Market'}
          </Button>
          {resetResult && (
            <span className={`text-xs ${resetResult.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
              {resetResult}
            </span>
          )}
        </div>
      </Card>

      {/* ================================================================ */}
      {/* ROUND EXECUTION HISTORY */}
      {/* ================================================================ */}
      <div className="mb-6 border border-neutral-800 rounded-lg overflow-hidden">
        <button
          onClick={() => setRoundHistoryOpen(!roundHistoryOpen)}
          className="w-full flex items-center justify-between px-5 py-3 bg-surface hover:bg-elevated/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-neutral-300 uppercase tracking-wider">
              Round Execution Log
            </span>
            <span className="text-[10px] text-neutral-500 font-mono">
              {roundEvents.length} events
            </span>
          </div>
          <svg
            className={`w-4 h-4 text-neutral-400 transition-transform duration-200 ${roundHistoryOpen ? "rotate-180" : ""}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {roundHistoryOpen && (
          <div className="overflow-x-auto">
            {roundEvents.length === 0 ? (
              <div className="text-center py-6 text-xs text-neutral-500">
                No round events yet. Run rounds from the Arena to see execution history.
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-neutral-500 uppercase tracking-wider border-b border-neutral-800 bg-void/50">
                    <th className="text-left py-2 px-4">Time</th>
                    <th className="text-left py-2 px-3">Type</th>
                    <th className="text-left py-2 px-3">Run By</th>
                    <th className="text-right py-2 px-3">Round</th>
                    <th className="text-right py-2 px-3">Agents</th>
                    <th className="text-right py-2 px-3">Revenue</th>
                    <th className="text-left py-2 px-3">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {roundEvents.map((ev) => {
                    const isStart = ev.event_type === "round_started";
                    const holder = ev.metadata?.holder;
                    const holderDisplay = !holder
                      ? "—"
                      : holder === "anonymous"
                      ? "anonymous"
                      : `${holder.slice(0, 6)}...${holder.slice(-4)}`;
                    const time = new Date(ev.created_at);
                    const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                    const dateStr = time.toLocaleDateString([], { month: "short", day: "numeric" });

                    return (
                      <tr key={ev.id} className="border-b border-neutral-800/30 hover:bg-neutral-800/20 transition-colors">
                        <td className="py-1.5 px-4 text-neutral-500 whitespace-nowrap">
                          <span className="text-neutral-400">{timeStr}</span>
                          <span className="text-neutral-600 ml-1">{dateStr}</span>
                        </td>
                        <td className="py-1.5 px-3">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider ${
                            isStart
                              ? "bg-blue-900/30 text-blue-400"
                              : "bg-emerald-900/30 text-emerald-400"
                          }`}>
                            {isStart ? "START" : "DONE"}
                          </span>
                        </td>
                        <td className="py-1.5 px-3 text-neutral-300 font-mono text-[11px]">
                          {holderDisplay}
                        </td>
                        <td className="py-1.5 px-3 text-right text-neutral-300 tabular-nums">
                          {ev.round_number ?? "—"}
                        </td>
                        <td className="py-1.5 px-3 text-right text-neutral-400 tabular-nums">
                          {ev.metadata?.agent_count ?? "—"}
                        </td>
                        <td className="py-1.5 px-3 text-right tabular-nums">
                          {ev.amount != null ? (
                            <span className="text-emerald-400">${ev.amount.toFixed(4)}</span>
                          ) : "—"}
                        </td>
                        <td className="py-1.5 px-3 text-neutral-500 max-w-[200px] truncate">
                          {isStart
                            ? `${ev.metadata?.rounds_requested || 1} round(s), ${ev.metadata?.tasks_per_round || "?"} tasks/round`
                            : `${ev.metadata?.tasks_completed ?? 0}/${ev.metadata?.tasks_processed ?? 0} tasks, ${ev.metadata?.brain_wakeups ?? 0} wakeups`
                          }
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* ================================================================ */}
      {/* ERROR LOG */}
      {/* ================================================================ */}
      <div className="mb-6 border border-neutral-800 rounded-lg overflow-hidden">
        <button
          onClick={() => setErrorLogOpen(!errorLogOpen)}
          className="w-full flex items-center justify-between px-5 py-3 bg-surface hover:bg-elevated/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-neutral-300 uppercase tracking-wider">
              Error Log
            </span>
            {errorEvents.length > 0 && (
              <span className="text-[10px] text-red-400 font-mono bg-red-900/20 px-1.5 py-0.5 rounded">
                {errorEvents.length}
              </span>
            )}
          </div>
          <svg
            className={`w-4 h-4 text-neutral-400 transition-transform duration-200 ${errorLogOpen ? "rotate-180" : ""}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {errorLogOpen && (
          <div className="overflow-x-auto">
            {errorEvents.length === 0 ? (
              <div className="text-center py-6 text-xs text-neutral-500">
                No errors logged. System errors from blockchain, LLM, and payment operations will appear here.
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-neutral-500 uppercase tracking-wider border-b border-neutral-800 bg-void/50">
                    <th className="text-left py-2 px-4">Time</th>
                    <th className="text-left py-2 px-3">Source</th>
                    <th className="text-left py-2 px-3">Agent</th>
                    <th className="text-right py-2 px-3">Round</th>
                    <th className="text-left py-2 px-3">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {errorEvents.map((ev) => {
                    const source = ev.metadata?.source || "unknown";
                    const sourceColors: Record<string, string> = {
                      blockchain: "bg-red-900/30 text-red-400",
                      llm: "bg-violet-900/30 text-violet-400",
                      payment: "bg-amber-900/30 text-amber-400",
                      database: "bg-blue-900/30 text-blue-400",
                    };
                    const time = new Date(ev.created_at);
                    const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                    const dateStr = time.toLocaleDateString([], { month: "short", day: "numeric" });
                    const isExpanded = expandedError === ev.id;

                    return (
                      <tr
                        key={ev.id}
                        className="border-b border-neutral-800/30 hover:bg-neutral-800/20 transition-colors cursor-pointer"
                        onClick={() => setExpandedError(isExpanded ? null : ev.id)}
                      >
                        <td className="py-1.5 px-4 text-neutral-500 whitespace-nowrap align-top">
                          <span className="text-neutral-400">{timeStr}</span>
                          <span className="text-neutral-600 ml-1">{dateStr}</span>
                        </td>
                        <td className="py-1.5 px-3 align-top">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider ${sourceColors[source] || "bg-neutral-800 text-neutral-400"}`}>
                            {source}
                          </span>
                        </td>
                        <td className="py-1.5 px-3 text-neutral-300 align-top">
                          {ev.metadata?.agent_name || "—"}
                        </td>
                        <td className="py-1.5 px-3 text-right text-neutral-400 tabular-nums align-top">
                          {ev.round_number ?? "—"}
                        </td>
                        <td className="py-1.5 px-3 align-top">
                          <div className={`text-neutral-300 ${isExpanded ? "" : "max-w-[300px] truncate"}`}>
                            {ev.metadata?.error_message || ev.description}
                          </div>
                          {isExpanded && (
                            <div className="mt-2 space-y-1">
                              {ev.metadata?.detail && (
                                <div className="text-neutral-500">
                                  <span className="text-neutral-600">Context:</span> {ev.metadata.detail}
                                </div>
                              )}
                              {ev.metadata?.stack_trace && (
                                <pre className="text-[10px] text-neutral-600 bg-void rounded p-2 mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono">
                                  {ev.metadata.stack_trace}
                                </pre>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* ================================================================ */}
      {/* LLM MODELS */}
      {/* ================================================================ */}
      <Card className="mb-6 space-y-4">
        <div>
          <h2 className="text-xs text-neutral-400 uppercase tracking-wider mb-1">
            LLM Models
          </h2>
          <p className="text-xs text-neutral-600">
            Select which Gemini model to use for each LLM activity
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {([
            { key: "narrator", label: "Memory Narrator", desc: "Industry + personal memory narratives" },
            { key: "brain", label: "Brain (Strategic)", desc: "Main agent wakeup / strategic thinking" },
            { key: "qbr", label: "QBR", desc: "Quarterly business review decisions" },
            { key: "exception", label: "Exception", desc: "Emergency exception responses" },
            { key: "reports", label: "Industry Reports", desc: "Report narrative generation" },
          ] as const).map((activity) => (
            <div key={activity.key}>
              <label className="block text-xs text-neutral-400 mb-1">
                {activity.label}
              </label>
              <select
                value={llmModels[activity.key] || "gemini-2.5-flash-lite"}
                onChange={(e) =>
                  setLlmModels((prev) => ({ ...prev, [activity.key]: e.target.value }))
                }
                className="w-full bg-void border border-neutral-700 rounded px-3 py-2 text-xs text-neutral-300"
              >
                <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite (fast)</option>
                <option value="gemini-2.0-flash">gemini-2.0-flash (balanced)</option>
                <option value="gemini-3-flash-preview">gemini-3-flash-preview (latest)</option>
              </select>
              <p className="text-xs text-neutral-600 mt-0.5">{activity.desc}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            size="sm"
            loading={savingLlmModels}
            onClick={async () => {
              setSavingLlmModels(true);
              setLlmModelsResult(null);
              try {
                const res = await fetch("/api/reports/config", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ llm_models: llmModels }),
                });
                const data = await res.json();
                if (data.success) {
                  setLlmModelsResult("Saved");
                  setTimeout(() => setLlmModelsResult(null), 2000);
                } else {
                  setLlmModelsResult(`Error: ${data.error}`);
                }
              } catch {
                setLlmModelsResult("Error saving");
              } finally {
                setSavingLlmModels(false);
              }
            }}
          >
            Save LLM Models
          </Button>
          {llmModelsResult && (
            <span className={`text-xs ${llmModelsResult.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}>
              {llmModelsResult}
            </span>
          )}
        </div>
      </Card>

      {/* ================================================================ */}
      {/* REPORT CONFIG */}
      {/* ================================================================ */}
      <Card className="mb-6 space-y-4">
        <div>
          <h2 className="text-xs text-neutral-400 uppercase tracking-wider mb-1">
            Industry Reports
          </h2>
          <p className="text-xs text-neutral-600">
            Configure periodic analyst reports on the agent economy
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Report Interval */}
          <div>
            <label className="block text-xs text-neutral-500 mb-1.5">
              Report every N rounds
            </label>
            <input
              type="number"
              min={5}
              max={100}
              value={reportInterval}
              onChange={(e) => setReportInterval(parseInt(e.target.value) || 20)}
              className="w-full bg-void border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-cyber-700"
            />
          </div>

          {/* Model Selection */}
          <div>
            <label className="block text-xs text-neutral-500 mb-1.5">
              Narrative Model
            </label>
            <select
              value={reportModel}
              onChange={(e) => setReportModel(e.target.value)}
              className="w-full bg-void border border-neutral-700 rounded px-3 py-2 text-xs text-neutral-300"
            >
              <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite (fast)</option>
              <option value="gemini-2.0-flash">gemini-2.0-flash (balanced)</option>
              <option value="gemini-3-flash-preview">gemini-3-flash-preview (latest)</option>
            </select>
          </div>

          {/* Status */}
          <div>
            <label className="block text-xs text-neutral-500 mb-1.5">
              Status
            </label>
            <div className="text-xs text-neutral-400 space-y-1 mt-1">
              <div>Last report: round {lastReportRound || "none"}</div>
              <div>Current round: {currentRound}</div>
              {reportInterval > 0 && (
                <div className="text-cyber-600">
                  Next at round {lastReportRound + reportInterval}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            variant="secondary"
            size="sm"
            loading={savingReportConfig}
            onClick={async () => {
              setSavingReportConfig(true);
              setReportResult(null);
              try {
                const res = await fetch("/api/reports/config", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ report_interval: reportInterval, report_model: reportModel }),
                });
                const data = await res.json();
                if (data.success) {
                  setReportResult("Config saved");
                } else {
                  setReportResult(`Error: ${data.error}`);
                }
              } catch {
                setReportResult("Error: Failed to save config");
              } finally {
                setSavingReportConfig(false);
              }
            }}
          >
            Save Config
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={generatingReport}
            onClick={async () => {
              setGeneratingReport(true);
              setReportResult(null);
              try {
                const res = await fetch("/api/reports/generate", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({}),
                });
                const data = await res.json();
                if (data.success) {
                  const r = data.report;
                  setReportResult(`Report #${r.report_number} generated (rounds ${r.start_round}-${r.end_round}, ${r.generation_time_ms}ms)`);
                  setLastReportRound(r.end_round);
                } else {
                  setReportResult(`Error: ${data.error}`);
                }
              } catch {
                setReportResult("Error: Generation failed");
              } finally {
                setGeneratingReport(false);
              }
            }}
          >
            Generate Report Now
          </Button>
        </div>

        {reportResult && <ResultBanner text={reportResult} />}
      </Card>

      {/* ================================================================ */}
      {/* AGENT LEADERBOARD */}
      {/* ================================================================ */}
      <Card className="mb-6">
        <h2 className="text-xs text-neutral-400 uppercase tracking-wider mb-3">
          Agent Leaderboard
        </h2>

        {loading && (
          <div className="text-center py-6 text-xs text-neutral-500">
            Loading<span className="text-cyber-500 animate-blink">▋</span>
          </div>
        )}

        {!loading && agents.length === 0 && (
          <div className="text-center py-6">
            <div className="text-2xl text-neutral-600 mb-2">&#x2205;</div>
            <p className="text-xs text-neutral-500">
              No agents yet. Create demo agents below.
            </p>
          </div>
        )}

        {agents.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-neutral-500 uppercase tracking-wider border-b border-neutral-800">
                  <th className="text-left py-2 pr-3">#</th>
                  <th className="text-left py-2 pr-3">Agent</th>
                  <th className="text-left py-2 pr-3">Type</th>
                  <th className="text-left py-2 pr-3">Personality</th>
                  <th className="text-right py-2 pr-3">Balance</th>
                  <th className="text-right py-2 pr-3">Rep</th>
                  <th className="text-right py-2 pr-3">Win Rate</th>
                  <th className="text-right py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {[...agents]
                  .sort((a, b) => b.balance - a.balance)
                  .map((agent, idx) => (
                    <tr
                      key={agent.id}
                      className="border-b border-neutral-800/50 hover:bg-neutral-800/20 transition-colors"
                    >
                      <td className="py-2 pr-3 text-neutral-600">{idx + 1}</td>
                      <td className="py-2 pr-3">
                        <span className="text-neutral-200">{agent.name}</span>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge
                          variant={
                            agent.type === "CATALOG"
                              ? "catalog"
                              : agent.type === "REVIEW"
                              ? "review"
                              : "curation"
                          }
                        >
                          {agent.type}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 text-neutral-400">
                        {agent.personality}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <span
                          className={
                            agent.balance > agentBalance
                              ? "text-emerald-400"
                              : agent.balance < agentBalance * 0.5
                              ? "text-red-400"
                              : "text-neutral-300"
                          }
                        >
                          ${agent.balance.toFixed(3)}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <span
                          className={
                            agent.reputation >= 600
                              ? "text-emerald-400"
                              : agent.reputation >= 400
                              ? "text-neutral-300"
                              : "text-red-400"
                          }
                        >
                          {agent.reputation}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right text-neutral-300">
                        {agent.tasks_completed}/{agent.total_bids || 0}
                        {(agent.total_bids || 0) > 0 && (
                          <span className="text-neutral-500 ml-1">
                            ({((agent.tasks_completed / agent.total_bids) * 100).toFixed(0)}%)
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        <Badge
                          variant={
                            agent.status === "ACTIVE"
                              ? "active"
                              : agent.status === "LOW_FUNDS"
                              ? "warning"
                              : "neutral"
                          }
                        >
                          {agent.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ================================================================ */}
        {/* TASK GENERATOR PANEL */}
        {/* ================================================================ */}
        <Card className="space-y-5">
          <div>
            <h2 className="text-xs text-neutral-400 uppercase tracking-wider mb-1">
              Task Generator
            </h2>
            <p className="text-xs text-neutral-600">
              Generate tasks without running simulation
            </p>
          </div>

          {/* Mode Selection */}
          <div>
            <label className="block text-xs text-neutral-500 mb-2">Mode</label>
            <div className="flex gap-2">
              {(["steady", "waves", "scenario"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setGenMode(mode)}
                  className={`px-3 py-1.5 text-xs uppercase tracking-wider border rounded transition-colors ${
                    genMode === mode
                      ? "bg-cyber-600/20 text-cyber-500 border-cyber-700"
                      : "bg-transparent text-neutral-500 border-neutral-700 hover:text-neutral-300"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {/* Scenario Selection */}
          {genMode === "scenario" && (
            <div>
              <label className="block text-xs text-neutral-500 mb-2">Scenario</label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { key: "bull_market", label: "Bull Market", desc: "High demand, generous prices" },
                    { key: "bear_market", label: "Bear Market", desc: "Low demand, tight prices" },
                    { key: "catalog_shortage", label: "Catalog Shortage", desc: "No CATALOG tasks" },
                    { key: "review_boom", label: "Review Boom", desc: "Tons of REVIEW tasks" },
                    { key: "race_to_bottom", label: "Race to Bottom", desc: "Razor-thin margins" },
                    { key: "gold_rush", label: "Gold Rush", desc: "Few huge payoffs" },
                    { key: "mixed", label: "Mixed", desc: "Rotates scenarios" },
                  ] as const
                ).map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setGenScenario(s.key)}
                    className={`text-left px-3 py-2 text-xs border rounded transition-colors ${
                      genScenario === s.key
                        ? "bg-cyber-600/20 text-cyber-500 border-cyber-700"
                        : "bg-transparent text-neutral-500 border-neutral-700 hover:text-neutral-300"
                    }`}
                  >
                    <div className="font-medium">{s.label}</div>
                    <div className="text-neutral-600 mt-0.5">{s.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Count + Button */}
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs text-neutral-500 mb-2">
                Count: <span className="text-cyber-500">{genCount}</span>
              </label>
              <input
                type="range"
                min={1}
                max={20}
                value={genCount}
                onChange={(e) => setGenCount(parseInt(e.target.value))}
                className="w-full accent-cyber-500"
              />
            </div>
            <Button variant="primary" loading={generating} onClick={handleGenerate}>
              Generate {genCount}
            </Button>
          </div>

          {genResult && (
            <ResultBanner text={genResult} />
          )}

          {taskStats && Object.keys(taskStats.by_type).length > 0 && (
            <div className="flex gap-3">
              {Object.entries(taskStats.by_type).map(([type, count]) => (
                <div key={type} className="flex items-center gap-1.5">
                  <Badge
                    variant={type === "CATALOG" ? "catalog" : type === "REVIEW" ? "review" : "curation"}
                  >
                    {type}
                  </Badge>
                  <span className="text-xs text-neutral-400">{count}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ================================================================ */}
        {/* AGENT CREATION PANEL */}
        {/* ================================================================ */}
        <Card className="space-y-5">
          <div>
            <h2 className="text-xs text-neutral-400 uppercase tracking-wider mb-1">
              Create Demo Agents
            </h2>
            <p className="text-xs text-neutral-600">
              Quick-create agents for simulation (DB only, no blockchain)
            </p>
          </div>

          {/* Batch Creation */}
          <div className="bg-void/50 rounded p-4 border border-neutral-800 space-y-3">
            <div className="text-xs text-neutral-400 font-medium uppercase tracking-wider">
              Quick Batch
            </div>
            <p className="text-xs text-neutral-600">
              Creates varied types and personalities automatically
            </p>
            <div className="flex items-center gap-3">
              <label className="text-xs text-neutral-500">Count:</label>
              <select
                value={batchCount}
                onChange={(e) => setBatchCount(parseInt(e.target.value))}
                className="bg-surface border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-300"
              >
                {[3, 6, 9].map((n) => (
                  <option key={n} value={n}>
                    {n} agents
                  </option>
                ))}
              </select>
              <label className="text-xs text-neutral-500">Balance:</label>
              <select
                value={agentBalance}
                onChange={(e) => setAgentBalance(parseFloat(e.target.value))}
                className="bg-surface border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-300"
              >
                <option value={0.5}>0.5 MON</option>
                <option value={1.0}>1.0 MON</option>
                <option value={2.0}>2.0 MON</option>
                <option value={5.0}>5.0 MON</option>
              </select>
            </div>
            <Button variant="primary" size="sm" fullWidth loading={creatingAgent} onClick={handleCreateBatch}>
              Create {batchCount} Agents
            </Button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-neutral-800" />
            <span className="text-xs text-neutral-600">or create one</span>
            <div className="flex-1 border-t border-neutral-800" />
          </div>

          {/* Single Agent Form */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-neutral-500 mb-1">Name</label>
              <input
                type="text"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="e.g., Maverick-CATALOG-42"
                className="w-full bg-void border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-cyber-700"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Type</label>
                <select
                  value={agentType}
                  onChange={(e) => setAgentType(e.target.value)}
                  className="w-full bg-void border border-neutral-700 rounded px-3 py-2 text-xs text-neutral-300"
                >
                  <option value="CATALOG">CATALOG</option>
                  <option value="REVIEW">REVIEW</option>
                  <option value="CURATION">CURATION</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Personality</label>
                <select
                  value={agentPersonality}
                  onChange={(e) => setAgentPersonality(e.target.value)}
                  className="w-full bg-void border border-neutral-700 rounded px-3 py-2 text-xs text-neutral-300"
                >
                  <option value="risk-taker">Risk Taker</option>
                  <option value="conservative">Conservative</option>
                  <option value="profit-maximizer">Profit Maximizer</option>
                  <option value="volume-chaser">Volume Chaser</option>
                  <option value="opportunist">Opportunist</option>
                  <option value="partnership-oriented">Partnership Oriented</option>
                </select>
              </div>
            </div>
            <Button
              variant="secondary"
              fullWidth
              loading={creatingAgent}
              disabled={!agentName.trim()}
              onClick={handleCreateAgent}
            >
              Create Agent
            </Button>
          </div>

          {createResult && <ResultBanner text={createResult} />}
        </Card>
      </div>

      {/* Recent Tasks */}
      {taskStats && taskStats.recent_tasks.length > 0 && (
        <div className="mt-6">
          <Card>
            <h2 className="text-xs text-neutral-400 uppercase tracking-wider mb-3">
              Recent Tasks
            </h2>
            <div className="space-y-1">
              {taskStats.recent_tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between py-1.5 border-b border-neutral-800/30"
                >
                  <div className="flex items-center gap-3">
                    <Badge
                      variant={task.type === "CATALOG" ? "catalog" : task.type === "REVIEW" ? "review" : "curation"}
                    >
                      {task.type}
                    </Badge>
                    <span className="text-xs text-neutral-500 font-mono">
                      {task.id.slice(0, 8)}...
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-neutral-300">
                      ${task.max_bid.toFixed(3)}
                    </span>
                    <Badge
                      variant={
                        task.status === "OPEN" ? "active" : task.status === "COMPLETED" ? "neutral" : "warning"
                      }
                    >
                      {task.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="!p-3">
      <div className="text-xs text-neutral-500 uppercase tracking-wider">{label}</div>
      <div className="text-lg font-medium text-neutral-200 mt-1">{value}</div>
    </Card>
  );
}

function MiniStat({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color?: "emerald" | "cyber";
}) {
  const valClass =
    color === "emerald"
      ? "text-emerald-400"
      : color === "cyber"
      ? "text-cyber-500"
      : "text-neutral-200";
  return (
    <div className="bg-void rounded p-2 border border-neutral-800">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`text-sm ${valClass}`}>{value}</div>
    </div>
  );
}

function ResultBanner({ text }: { text: string }) {
  const isError = text.startsWith("Error");
  return (
    <div
      className={`text-xs p-2 rounded border ${
        isError
          ? "text-red-400 border-red-900/50 bg-red-900/10"
          : "text-emerald-400 border-emerald-900/50 bg-emerald-900/10"
      }`}
    >
      {text}
    </div>
  );
}
