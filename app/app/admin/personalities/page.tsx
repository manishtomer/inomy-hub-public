"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import type {
  Personality,
  CreatePersonalityRequest,
  UpdatePersonalityRequest,
} from "@/types/admin";
import type { AgentPolicy } from "@/lib/agent-runtime/types";

export default function AdminPersonalitiesPage() {
  const [personalities, setPersonalities] = useState<Personality[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPersonality, setEditingPersonality] =
    useState<Personality | null>(null);

  // Fetch personalities
  const fetchPersonalities = async () => {
    try {
      const res = await fetch("/api/admin/personalities");
      const data = await res.json();
      if (data.personalities) {
        setPersonalities(data.personalities);
      }
    } catch (error) {
      console.error("Failed to fetch personalities:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPersonalities();
  }, []);

  // Delete personality
  const handleDelete = async (personality: Personality) => {
    if (personality.is_system) {
      alert("System personalities cannot be deleted");
      return;
    }

    if (!confirm(`Delete personality "${personality.name}"?`)) return;

    try {
      const res = await fetch(`/api/admin/personalities/${personality.id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        fetchPersonalities();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to delete personality");
      }
    } catch (error) {
      alert("Failed to delete personality");
    }
  };

  return (
    <div className="max-w-7xl mx-auto py-8 px-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-lg font-medium text-neutral-200 uppercase tracking-wider">
            Personalities Management
          </h1>
          <p className="text-xs text-neutral-500 mt-1">
            Manage agent personality types and their default policies
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={fetchPersonalities}>
            Refresh
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowCreateModal(true)}
          >
            Create Personality
          </Button>
        </div>
      </div>

      {/* Personalities Grid */}
      {loading && (
        <div className="text-center py-12 text-xs text-neutral-500">
          Loading personalities...
        </div>
      )}

      {!loading && personalities.length === 0 && (
        <Card className="text-center py-12">
          <p className="text-xs text-neutral-500">No personalities found</p>
        </Card>
      )}

      {!loading && personalities.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {personalities.map((personality) => (
            <PersonalityCard
              key={personality.id}
              personality={personality}
              onEdit={() => setEditingPersonality(personality)}
              onDelete={() => handleDelete(personality)}
            />
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {(showCreateModal || editingPersonality) && (
        <PersonalityModal
          personality={editingPersonality}
          onClose={() => {
            setShowCreateModal(false);
            setEditingPersonality(null);
          }}
          onSave={() => {
            setShowCreateModal(false);
            setEditingPersonality(null);
            fetchPersonalities();
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
// PERSONALITY CARD COMPONENT
// ============================================================================

function PersonalityCard({
  personality,
  onEdit,
  onDelete,
}: {
  personality: Personality;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const policy = personality.default_policy;

  return (
    <Card className="space-y-4">
      {/* Header with color */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm"
            style={{
              backgroundColor: personality.color + "20",
              color: personality.color,
            }}
          >
            {personality.icon === "flame" && "🔥"}
            {personality.icon === "shield" && "🛡️"}
            {personality.icon === "dollar-sign" && "💰"}
            {personality.icon === "trending-up" && "📈"}
            {personality.icon === "zap" && "⚡"}
            {personality.icon === "users" && "👥"}
          </div>
          <div>
            <h3
              className="font-medium"
              style={{ color: personality.color }}
            >
              {personality.name}
            </h3>
            <code className="text-xs text-neutral-500">
              {personality.code}
            </code>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {personality.is_system && (
            <Badge variant="neutral" className="text-xs">
              SYSTEM
            </Badge>
          )}
          <Badge
            variant={personality.is_active ? "active" : "neutral"}
            className="text-xs"
          >
            {personality.is_active ? "ACTIVE" : "INACTIVE"}
          </Badge>
        </div>
      </div>

      {/* Description */}
      {personality.description && (
        <p className="text-xs text-neutral-400">{personality.description}</p>
      )}

      {/* Policy Summary */}
      <div className="space-y-2 text-xs">
        <div className="flex justify-between py-1 border-b border-neutral-800/50">
          <span className="text-neutral-500">Target Margin</span>
          <span className="text-neutral-300">
            {(policy.bidding.target_margin * 100).toFixed(0)}%
          </span>
        </div>
        <div className="flex justify-between py-1 border-b border-neutral-800/50">
          <span className="text-neutral-500">Min Margin</span>
          <span className="text-neutral-300">
            {(policy.bidding.min_margin * 100).toFixed(0)}%
          </span>
        </div>
        <div className="flex justify-between py-1 border-b border-neutral-800/50">
          <span className="text-neutral-500">Quality Threshold</span>
          <span className="text-neutral-300">
            {(policy.execution.quality_threshold * 100).toFixed(0)}%
          </span>
        </div>
        <div className="flex justify-between py-1 border-b border-neutral-800/50">
          <span className="text-neutral-500">Partnership Min Rep</span>
          <span className="text-neutral-300">
            {policy.partnerships.auto_accept.min_reputation}
          </span>
        </div>
        <div className="flex justify-between py-1">
          <span className="text-neutral-500">QBR Frequency</span>
          <span className="text-neutral-300">
            {policy.qbr.base_frequency_rounds} rounds
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <Button variant="secondary" size="sm" fullWidth onClick={onEdit}>
          Edit
        </Button>
        {!personality.is_system && (
          <Button variant="danger" size="sm" onClick={onDelete}>
            Delete
          </Button>
        )}
      </div>
    </Card>
  );
}

// ============================================================================
// PERSONALITY MODAL COMPONENT
// ============================================================================

function PersonalityModal({
  personality,
  onClose,
  onSave,
}: {
  personality: Personality | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const isEdit = !!personality;

  const [code, setCode] = useState(personality?.code || "");
  const [name, setName] = useState(personality?.name || "");
  const [description, setDescription] = useState(
    personality?.description || ""
  );
  const [color, setColor] = useState(personality?.color || "#6366f1");
  const [icon, setIcon] = useState(personality?.icon || "zap");
  const [isActive, setIsActive] = useState(personality?.is_active ?? true);
  const [policyJSON, setPolicyJSON] = useState(
    JSON.stringify(
      personality?.default_policy || getDefaultPolicy(code),
      null,
      2
    )
  );
  const [behavioralPrompt, setBehavioralPrompt] = useState(
    personality?.behavioral_prompt || ""
  );
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"basic" | "policy" | "prompt">(
    "basic"
  );

  const handleSave = async () => {
    setSaving(true);

    try {
      let parsedPolicy: AgentPolicy;
      try {
        parsedPolicy = JSON.parse(policyJSON);
      } catch {
        alert("Invalid policy JSON");
        setSaving(false);
        return;
      }

      if (isEdit) {
        const updateData: UpdatePersonalityRequest = {
          name,
          description: description || undefined,
          color,
          icon,
          default_policy: parsedPolicy,
          behavioral_prompt: behavioralPrompt || undefined,
          is_active: isActive,
        };

        const res = await fetch(`/api/admin/personalities/${personality.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updateData),
        });

        if (res.ok) {
          onSave();
        } else {
          const data = await res.json();
          alert(data.error || "Failed to update personality");
        }
      } else {
        const createData: CreatePersonalityRequest = {
          code,
          name,
          description: description || undefined,
          color,
          icon,
          default_policy: parsedPolicy,
          behavioral_prompt: behavioralPrompt || undefined,
          is_active: isActive,
        };

        const res = await fetch("/api/admin/personalities", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(createData),
        });

        if (res.ok) {
          onSave();
        } else {
          const data = await res.json();
          alert(data.error || "Failed to create personality");
        }
      }
    } catch (error) {
      alert("An error occurred");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <Card className="max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-200 uppercase tracking-wider">
              {isEdit ? "Edit Personality" : "Create Personality"}
            </h2>
            <button
              onClick={onClose}
              className="text-neutral-500 hover:text-neutral-300"
            >
              Close
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-neutral-800">
            {(["basic", "policy", "prompt"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-xs uppercase tracking-wider transition-colors ${
                  activeTab === tab
                    ? "text-cyber-500 border-b-2 border-cyber-500"
                    : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Basic Tab */}
          {activeTab === "basic" && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-neutral-500 mb-1">
                  Code {!isEdit && <span className="text-red-400">*</span>}
                </label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toLowerCase())}
                  disabled={isEdit}
                  placeholder="e.g., risk-taker"
                  className="w-full bg-void border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-cyber-700 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-xs text-neutral-500 mb-1">
                  Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Risk-Taker"
                  className="w-full bg-void border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-cyber-700"
                />
              </div>

              <div>
                <label className="block text-xs text-neutral-500 mb-1">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description of this personality..."
                  rows={2}
                  className="w-full bg-void border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-cyber-700"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-neutral-500 mb-1">
                    Color (hex)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      className="w-12 h-10 rounded border border-neutral-700"
                    />
                    <input
                      type="text"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      placeholder="#6366f1"
                      className="flex-1 bg-void border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-cyber-700"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-neutral-500 mb-1">
                    Icon
                  </label>
                  <select
                    value={icon}
                    onChange={(e) => setIcon(e.target.value)}
                    className="w-full bg-void border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-cyber-700"
                  >
                    <option value="flame">🔥 flame</option>
                    <option value="shield">🛡️ shield</option>
                    <option value="dollar-sign">💰 dollar-sign</option>
                    <option value="trending-up">📈 trending-up</option>
                    <option value="zap">⚡ zap</option>
                    <option value="users">👥 users</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="rounded border-neutral-700 bg-void"
                />
                <label htmlFor="isActive" className="text-xs text-neutral-300">
                  Active (available for use)
                </label>
              </div>
            </div>
          )}

          {/* Policy Tab */}
          {activeTab === "policy" && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-neutral-500 mb-1">
                  Default Policy JSON <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={policyJSON}
                  onChange={(e) => setPolicyJSON(e.target.value)}
                  rows={20}
                  className="w-full bg-void border border-neutral-700 rounded px-3 py-2 text-xs font-mono text-neutral-200 focus:outline-none focus:border-cyber-700"
                />
                <p className="text-xs text-neutral-600 mt-1">
                  Must include: identity, bidding, partnerships, execution,
                  exceptions, qbr
                </p>
              </div>
            </div>
          )}

          {/* Prompt Tab */}
          {activeTab === "prompt" && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-neutral-500 mb-1">
                  Behavioral Prompt
                </label>
                <textarea
                  value={behavioralPrompt}
                  onChange={(e) => setBehavioralPrompt(e.target.value)}
                  placeholder="LLM system prompt describing this personality's behavior..."
                  rows={12}
                  className="w-full bg-void border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-cyber-700"
                />
                <p className="text-xs text-neutral-600 mt-1">
                  This prompt will be used to instruct the LLM on how to behave
                  with this personality.
                </p>
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              variant="primary"
              onClick={handleSave}
              loading={saving}
              disabled={!code || !name || !policyJSON}
            >
              {isEdit ? "Update" : "Create"}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getDefaultPolicy(code: string): AgentPolicy {
  return {
    identity: { personality: code as any },
    bidding: {
      target_margin: 0.12,
      min_margin: 0.05,
      skip_below: 0.04,
      formula: "percentage",
    },
    partnerships: {
      auto_accept: { min_reputation: 500, min_split: 48 },
      auto_reject: { max_reputation: 250, blocked_agents: [] },
      require_brain: { high_value_threshold: 800 },
      propose: {
        target_types: ["CATALOG", "REVIEW"],
        default_split: 50,
        min_acceptable_split: 40,
      },
    },
    execution: { max_cost_per_task: 0.08, quality_threshold: 0.75 },
    exceptions: {
      consecutive_losses: 5,
      balance_below: 0.2,
      reputation_drop: 10,
      win_rate_drop_percent: 18,
    },
    qbr: {
      base_frequency_rounds: 10,
      accelerate_if: { volatility_above: 0.25, losses_above: 4 },
      decelerate_if: { stable_rounds: 16 },
    },
  };
}
