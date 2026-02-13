/**
 * QBR Testing Page
 *
 * Development-only page for testing QBR functionality.
 * Allows manual triggering of QBR and monitoring of Gemini integration.
 *
 * URL: http://localhost:3000/qbr-test
 *
 * IMPORTANT: Remove this page before production deployment!
 */

"use client";

import { useEffect, useState } from "react";
import { QBRTestButton } from "@/components/QBRTestButton";

interface Agent {
  id: string;
  name: string;
  type: string;
  status: string;
  balance: number;
  reputation: number;
}

export default function QBRTestPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Fetch all available agents for testing
    const fetchAgents = async () => {
      try {
        setLoading(true);
        console.log("[QBR-TEST] Fetching agents from /api/agents");
        const response = await fetch("/api/agents");
        const result = await response.json();

        console.log("[QBR-TEST] API response:", result);

        // API returns {success, count, data: [...]}
        const agentsList = result.data || (Array.isArray(result) ? result : []);

        if (Array.isArray(agentsList)) {
          console.log(`[QBR-TEST] Found ${agentsList.length} agents`);
          setAgents(agentsList);
          if (agentsList.length > 0) {
            console.log("[QBR-TEST] Setting first agent as selected:", agentsList[0]);
            setSelectedAgent(agentsList[0]);
          }
        } else {
          console.error("[QBR-TEST] Agents data is not an array:", agentsList);
          setError("Unexpected response format from agents API");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[QBR-TEST] Error fetching agents:", message);
        setError(`Failed to fetch agents: ${message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchAgents();
  }, []);

  // Log when selectedAgent changes
  useEffect(() => {
    console.log("[QBR-TEST] Selected agent changed:", selectedAgent);
  }, [selectedAgent]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            🧪 QBR Testing Dashboard
          </h1>
          <p className="text-gray-600 text-lg">
            Manual testing interface for Gemini integration and QBR tool calling
          </p>
          <p className="text-red-600 text-sm mt-2 font-semibold">
            ⚠️ Development Only - Remove before production!
          </p>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8">
            <div className="flex items-center gap-3">
              <div className="animate-spin h-5 w-5 text-blue-600"></div>
              <span className="text-blue-800">Loading agents...</span>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-8">
            <h3 className="font-semibold text-red-900 mb-2">Error</h3>
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {/* Debug Info */}
        {process.env.NODE_ENV === "development" && (
          <div className="mb-4 p-3 bg-gray-100 border border-gray-300 rounded text-xs font-mono text-gray-700">
            <p>Agents loaded: {agents.length}</p>
            <p>Selected: {selectedAgent?.name || "none"} ({selectedAgent?.id || ""})</p>
          </div>
        )}

        {/* Main Content */}
        {!loading && agents.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            {/* Test Agents Panel */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-4">
                  📋 Available Agents ({agents.length})
                </h2>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {agents.map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() => setSelectedAgent(agent)}
                      className={`w-full p-3 rounded border transition text-left ${
                        selectedAgent?.id === agent.id
                          ? "bg-blue-50 border-blue-300 ring-2 ring-blue-200"
                          : "bg-gray-50 border-gray-200 hover:bg-gray-100"
                      }`}
                    >
                      <p className="font-semibold text-gray-900">{agent.name}</p>
                      <p className="text-xs text-gray-600">
                        Type: <span className="font-mono">{agent.type}</span>
                      </p>
                      <p className="text-xs text-gray-600">
                        Balance:{" "}
                        <span className="font-mono">${agent.balance.toFixed(2)}</span>
                      </p>
                      <p className="text-xs text-gray-600">
                        Rep:{" "}
                        <span className="font-mono">{agent.reputation.toFixed(1)}</span>
                      </p>
                      <p className="text-xs text-gray-600">
                        Status:{" "}
                        <span
                          className={`font-semibold ${
                            agent.status === "ACTIVE"
                              ? "text-green-600"
                              : "text-yellow-600"
                          }`}
                        >
                          {agent.status}
                        </span>
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* QBR Test Panel */}
            <div className="lg:col-span-2">
              {selectedAgent ? (
                <QBRTestButton key={selectedAgent.id} agentId={selectedAgent.id} agentName={selectedAgent.name} />
              ) : (
                <div className="bg-white rounded-lg shadow p-6">
                  <p className="text-gray-600">Select an agent from the list to begin testing</p>
                </div>
              )}
            </div>
          </div>
        )}

        {!loading && agents.length === 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 mb-8">
            <h3 className="font-semibold text-yellow-900 mb-2">
              ⚠️ No Agents Found
            </h3>
            <p className="text-yellow-800">
              Please create an agent first before testing QBR. You can create one via the Agents API or database.
            </p>
            <pre className="mt-3 bg-white p-3 rounded text-sm font-mono text-gray-900 overflow-auto">{`curl -X POST http://localhost:3000/api/agents \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Test-Agent-1",
    "type": "EXECUTOR",
    "status": "ACTIVE",
    "balance": 100,
    "reputation": 4.0
  }'`}</pre>
          </div>
        )}

        {/* Testing Guide */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Setup Checklist */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              ✓ Setup Checklist
            </h2>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <input type="checkbox" defaultChecked className="mt-1" />
                <span className="text-gray-700">
                  <strong>Environment:</strong> GOOGLE_API_KEY set in .env.local
                </span>
              </div>
              <div className="flex items-start gap-3">
                <input type="checkbox" defaultChecked className="mt-1" />
                <span className="text-gray-700">
                  <strong>Agent:</strong> Test agent created in database
                </span>
              </div>
              <div className="flex items-start gap-3">
                <input type="checkbox" defaultChecked className="mt-1" />
                <span className="text-gray-700">
                  <strong>Policy:</strong> Agent has a current policy
                </span>
              </div>
              <div className="flex items-start gap-3">
                <input type="checkbox" defaultChecked className="mt-1" />
                <span className="text-gray-700">
                  <strong>Tables:</strong> Database tables created (agent_policies,
                  qbr_history, etc.)
                </span>
              </div>
            </div>
          </div>

          {/* What Gets Tested */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              🔍 What Gets Tested
            </h2>
            <div className="space-y-2 text-sm">
              <p>
                <strong>✓ Gemini Connection:</strong> Can connect to Gemini API
              </p>
              <p>
                <strong>✓ Tool Schemas:</strong> All 9 tools registered correctly
              </p>
              <p>
                <strong>✓ Tool Calling:</strong> Gemini calls tools as needed
              </p>
              <p>
                <strong>✓ Tool Execution:</strong> Tools execute and return results
              </p>
              <p>
                <strong>✓ Cost Tracking:</strong> Costs deducted from balance
              </p>
              <p>
                <strong>✓ Policy Changes:</strong> New policies created with reasoning
              </p>
              <p>
                <strong>✓ Database Records:</strong> QBR and updates recorded
              </p>
            </div>
          </div>
        </div>

        {/* Debugging Steps */}
        <div className="mt-6 bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">
            🐛 Debugging Steps
          </h2>
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">
                1. Check Server Logs
              </h3>
              <p className="text-gray-700 mb-2">
                Look for these log prefixes:
              </p>
              <ul className="ml-4 space-y-1 text-sm text-gray-600 font-mono">
                <li>• [QBR-TEST] - API endpoint logs</li>
                <li>• [BRAIN] - Gemini integration logs</li>
                <li>• [EXECUTOR] - Tool execution logs</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold text-gray-900 mb-2">
                2. Check Browser Console
              </h3>
              <p className="text-gray-700">
                Open DevTools (F12) and filter for "QBR-TEST" to see client-side logs.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-gray-900 mb-2">
                3. Verify Database Records
              </h3>
              <p className="text-gray-700 mb-2">
                Check these tables after running QBR:
              </p>
              <pre className="bg-gray-100 p-3 rounded text-xs font-mono overflow-auto">
{`-- Check if policy was created
SELECT * FROM agent_policies WHERE agent_id = 'your-agent-id'
ORDER BY created_at DESC LIMIT 1;

-- Check QBR history
SELECT * FROM qbr_history WHERE agent_id = 'your-agent-id'
ORDER BY created_at DESC LIMIT 1;

-- Check investor updates
SELECT * FROM investor_updates WHERE agent_id = 'your-agent-id'
ORDER BY created_at DESC LIMIT 1;`}
              </pre>
            </div>

            <div>
              <h3 className="font-semibold text-gray-900 mb-2">
                4. Common Issues
              </h3>
              <ul className="ml-4 space-y-2 text-sm text-gray-700">
                <li>
                  <strong>No logs:</strong> Check GOOGLE_API_KEY is set and server
                  restarted
                </li>
                <li>
                  <strong>Tool not found:</strong> Check tool names match schemas
                </li>
                <li>
                  <strong>Database error:</strong> Verify tables created with
                  migrations
                </li>
                <li>
                  <strong>Empty response:</strong> Agent may not have policy -
                  create one first
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* API Reference */}
        <div className="mt-6 bg-gray-900 text-gray-100 rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4">📡 API Reference</h2>
          <div className="space-y-3 text-sm font-mono">
            <div>
              <p className="text-green-400 mb-1">POST /api/agents/:id/qbr/trigger</p>
              <p className="text-gray-400">Manually trigger QBR for an agent</p>
            </div>
            <div>
              <p className="text-green-400 mb-1">GET /api/agents/:id/qbr/trigger</p>
              <p className="text-gray-400">Check if agent is ready for QBR testing</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-gray-600 text-sm">
          <p>
            Remember to remove this page before deploying to production!
          </p>
        </div>
      </div>
    </div>
  );
}
