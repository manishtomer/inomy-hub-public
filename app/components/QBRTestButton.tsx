"use client";

/**
 * QBR Test Button Component
 *
 * Testing component to manually trigger QBR for debugging and development.
 * Shows:
 * - Button to trigger QBR
 * - Loading state during execution
 * - Response showing what happened
 * - Tool calls made
 * - Policy changes applied
 * - Costs incurred
 *
 * Only for testing and development - should be removed in production.
 */

import { useState } from "react";

interface QBRResponse {
  success: boolean;
  message: string;
  duration_ms?: number;
  agent?: {
    id: string;
    name: string;
    balance: number;
    reputation: number;
  };
  policy?: {
    version: number;
    trigger?: any;
    reasoning?: any;
    brain_cost: number;
  };
  qbr?: {
    qbr_number: number;
    period?: any;
    decisions?: any;
  };
  investor_update?: {
    trigger_type: string;
    trigger_details?: string;
    observations?: any;
    changes?: any;
    impacts?: any;
    survival_impact?: string;
    growth_impact?: string;
  };
  error?: string;
  note?: string;
}

interface QBRTestButtonProps {
  agentId: string;
  agentName?: string;
}

export function QBRTestButton({ agentId, agentName }: QBRTestButtonProps) {
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<QBRResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkReadiness = async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}/qbr/trigger`);
      const data = await res.json();
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Failed to check readiness: ${message}`);
      return null;
    }
  };

  const triggerQBR = async () => {
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      console.log("[QBR-TEST] Triggering QBR for agent:", agentId);

      const res = await fetch(`/api/agents/${agentId}/qbr/trigger`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data: QBRResponse = await res.json();

      console.log("[QBR-TEST] Response:", data);

      if (data.success) {
        setResponse(data);
      } else {
        setError(data.error || data.message || "Unknown error");
        setResponse(data);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[QBR-TEST] Error:", message);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">QBR Test Interface</h2>
        <p className="text-gray-600 mt-1">
          {agentName ? `Agent: ${agentName}` : `Agent ID: ${agentId}`}
        </p>
      </div>

      {/* Control Panel */}
      <div className="bg-gray-50 p-4 rounded-lg mb-6 border border-gray-200">
        <button
          onClick={triggerQBR}
          disabled={loading}
          className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
            loading
              ? "bg-gray-400 text-white cursor-not-allowed"
              : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          {loading ? "Running QBR..." : "Trigger QBR Test"}
        </button>

        <button
          onClick={checkReadiness}
          disabled={loading}
          className="ml-3 px-6 py-3 rounded-lg font-semibold bg-gray-600 text-white hover:bg-gray-700 transition-colors disabled:bg-gray-400"
        >
          Check Readiness
        </button>

        {loading && (
          <div className="mt-4 flex items-center">
            <div className="animate-spin h-5 w-5 text-blue-600 mr-3"></div>
            <span className="text-gray-600">Running QBR... (check console logs)</span>
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <h3 className="font-semibold text-red-900 mb-2">Error</h3>
          <p className="text-red-700 font-mono text-sm">{error}</p>
        </div>
      )}

      {/* Response Display */}
      {response && (
        <div className={`rounded-lg border-2 p-4 ${response.success ? "bg-green-50 border-green-200" : "bg-yellow-50 border-yellow-200"}`}>
          {/* Status */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-3 h-3 rounded-full ${response.success ? "bg-green-600" : "bg-yellow-600"}`}></span>
              <h3 className="font-bold text-lg">{response.success ? "✓ Success" : "⚠ Completed with Issues"}</h3>
            </div>
            <p className="text-gray-700">{response.message}</p>
            {response.duration_ms && (
              <p className="text-sm text-gray-600 mt-1">⏱️ Duration: {response.duration_ms}ms</p>
            )}
          </div>

          {/* Brain Reasoning Summary */}
          {response && response.investor_update?.trigger_details && (
            <div className="mb-4 p-3 bg-yellow-50 rounded border border-yellow-200">
              <h4 className="font-semibold text-yellow-900 mb-2">🧠 Brain Analysis Summary</h4>
              <p className="text-xs text-yellow-900">
                {response.investor_update.trigger_details}
              </p>
            </div>
          )}

          {/* Agent Info */}
          {response.agent && (
            <div className="mb-4 p-3 bg-white rounded border border-gray-200">
              <h4 className="font-semibold text-gray-900 mb-2">Agent State</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-gray-600">Name:</span>
                  <p className="font-mono">{response.agent.name}</p>
                </div>
                <div>
                  <span className="text-gray-600">Balance:</span>
                  <p className="font-mono">${response.agent.balance.toFixed(2)}</p>
                </div>
                <div>
                  <span className="text-gray-600">Reputation:</span>
                  <p className="font-mono">{response.agent.reputation.toFixed(1)}</p>
                </div>
              </div>
            </div>
          )}

          {/* Policy Changes */}
          {response.policy && (
            <div className="mb-4 p-3 bg-white rounded border border-gray-200">
              <h4 className="font-semibold text-gray-900 mb-2">Policy Update</h4>
              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-gray-600">Version:</span>
                  <p className="font-mono">v{response.policy.version}</p>
                </div>
                <div>
                  <span className="text-gray-600">Trigger:</span>
                  <p className="font-mono text-xs">
                    {JSON.stringify(response.policy.trigger, null, 2)}
                  </p>
                </div>
                {response.policy.brain_cost > 0 && (
                  <div>
                    <span className="text-gray-600">Brain Cost:</span>
                    <p className="font-mono">${response.policy.brain_cost.toFixed(4)}</p>
                  </div>
                )}
                {response.policy.reasoning !== undefined && response.policy.reasoning !== null && (
                  <div className="mt-2 p-2 bg-gray-100 rounded text-xs">
                    <span className="text-gray-600 block mb-1">Reasoning:</span>
                    <pre className="whitespace-pre-wrap font-mono text-xs">
                      {(JSON.stringify(response.policy.reasoning, null, 2) as unknown as string).substring(0, 200)}...
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* QBR Record - Period & Metrics */}
          {response.qbr && (
            <div className="mb-4 p-3 bg-white rounded border border-gray-200">
              <h4 className="font-semibold text-gray-900 mb-2">📋 QBR Record #{response.qbr.qbr_number}</h4>

              {/* Period Info */}
              <div className="mb-3 p-2 bg-gray-50 rounded">
                <p className="text-xs font-semibold text-gray-700 mb-1">Review Period:</p>
                <div className="text-xs text-gray-600 space-y-1">
                  {response.qbr.period && (
                    <>
                      <p>📊 Rounds Reviewed: {response.qbr.period.rounds_since_last || "N/A"}</p>
                      <p>🔵 Round Range: {response.qbr.period.start_round} to {response.qbr.period.end_round}</p>
                    </>
                  )}
                </div>
              </div>

              {/* Performance Metrics */}
              {response.qbr.decisions && (
                <div className="p-2 bg-indigo-50 rounded border border-indigo-200">
                  <p className="text-xs font-semibold text-indigo-900 mb-2">Performance Metrics:</p>
                  <div className="text-xs text-indigo-900 space-y-1 font-mono">
                    <p>📈 Policy Changes Applied: {JSON.stringify(response.qbr.decisions.policy_changes).length > 2 ? "✓ Yes" : "None"}</p>
                    <p>🤝 Partnership Actions: {response.qbr.decisions.partnership_actions?.length || 0}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* QBR Decisions & Analysis */}
          {response.investor_update && (
            <div className="mb-4 p-4 bg-blue-50 rounded border border-blue-200">
              <h4 className="font-semibold text-gray-900 mb-3">QBR Analysis & Decisions</h4>

              {/* Observations */}
              <div className="mb-4">
                <h5 className="font-semibold text-gray-800 text-sm mb-2">📊 Key Observations</h5>
                {Array.isArray(response.investor_update.observations) && response.investor_update.observations.length > 0 ? (
                  <ul className="ml-4 list-disc space-y-1">
                    {response.investor_update.observations.map((obs, i) => (
                      <li key={i} className="text-xs text-gray-700">
                        {obs}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-gray-600">No observations recorded</p>
                )}
              </div>

              {/* Changes */}
              {Array.isArray(response.investor_update.changes) && response.investor_update.changes.length > 0 && (
                <div className="mb-4">
                  <h5 className="font-semibold text-gray-800 text-sm mb-2">🔄 Policy Changes</h5>
                  <div className="space-y-2">
                    {response.investor_update.changes.map((change, i) => (
                      <div key={i} className="bg-white p-2 rounded border border-blue-100 text-xs">
                        <p className="font-semibold text-gray-800">
                          {change.category.toUpperCase()}: {change.description}
                        </p>
                        <p className="text-gray-600 mt-1">
                          <strong>Why:</strong> {change.reasoning}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Impact Analysis */}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-white p-2 rounded border border-green-200">
                  <p className="font-semibold text-green-700 text-xs mb-1">✓ Survival Impact</p>
                  <p className="text-xs text-gray-700">
                    {response.investor_update.survival_impact || "No impact"}
                  </p>
                </div>
                <div className="bg-white p-2 rounded border border-purple-200">
                  <p className="font-semibold text-purple-700 text-xs mb-1">📈 Growth Impact</p>
                  <p className="text-xs text-gray-700">
                    {response.investor_update.growth_impact || "No impact"}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Note */}
          {response.note && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-900">
              <strong>Note:</strong> {response.note}
            </div>
          )}
        </div>
      )}

      {/* Instructions */}
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h3 className="font-semibold text-blue-900 mb-2">How to Debug</h3>
        <ol className="text-sm text-blue-800 space-y-1 list-decimal ml-5">
          <li>Click "Trigger QBR Test" to manually run QBR</li>
          <li>Open browser console (F12) to see [QBR-TEST], [BRAIN], [EXECUTOR] logs</li>
          <li>Check server terminal for detailed Gemini and tool execution logs</li>
          <li>Response above shows what happened during execution</li>
          <li>Check database tables: agent_policies, qbr_history, investor_updates</li>
        </ol>
      </div>

      {/* Monitoring Guide */}
      <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
        <h3 className="font-semibold text-gray-900 mb-2">Server Logs to Watch</h3>
        <pre className="text-xs font-mono bg-gray-900 text-green-400 p-3 rounded overflow-auto max-h-40">
{`[QBR-TEST] Manual QBR trigger requested
[QBR-TEST] Agent found: Agent-1 (EXECUTOR)
[QBR-TEST] Starting QBR execution...
[BRAIN] Starting QBR decision for agent ...
[BRAIN] Sending QBR prompt to Gemini
[BRAIN] Tool call iteration 1: 3 tools to execute
[EXECUTOR] Executing tool: query_market
[EXECUTOR] Tool executed successfully: query_market
[EXECUTOR] Executing tool: get_my_stats
[EXECUTOR] Tool executed successfully: get_my_stats
[BRAIN] QBR decision complete
[QBR-TEST] QBR completed successfully in XXXms`}
        </pre>
      </div>
    </div>
  );
}
