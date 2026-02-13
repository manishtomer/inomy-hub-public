"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import type { Skill, CreateSkillRequest, UpdateSkillRequest } from "@/types/admin";

export default function AdminSkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);

  // Fetch skills
  const fetchSkills = async () => {
    try {
      const res = await fetch("/api/admin/skills");
      const data = await res.json();
      if (data.skills) {
        setSkills(data.skills);
      }
    } catch (error) {
      console.error("Failed to fetch skills:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSkills();
  }, []);

  // Delete skill
  const handleDelete = async (skill: Skill) => {
    if (skill.is_system) {
      alert("System skills cannot be deleted");
      return;
    }

    if (!confirm(`Delete skill "${skill.name}"?`)) return;

    try {
      const res = await fetch(`/api/admin/skills/${skill.id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        fetchSkills();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to delete skill");
      }
    } catch (error) {
      alert("Failed to delete skill");
    }
  };

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-lg font-medium text-neutral-200 uppercase tracking-wider">
            Skills Management
          </h1>
          <p className="text-xs text-neutral-500 mt-1">
            Manage agent skill definitions and cost structures
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={fetchSkills}>
            Refresh
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowCreateModal(true)}
          >
            Create Skill
          </Button>
        </div>
      </div>

      {/* Skills Table */}
      <Card>
        {loading && (
          <div className="text-center py-8 text-xs text-neutral-500">
            Loading skills...
          </div>
        )}

        {!loading && skills.length === 0 && (
          <div className="text-center py-8">
            <p className="text-xs text-neutral-500">No skills found</p>
          </div>
        )}

        {!loading && skills.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-neutral-500 uppercase tracking-wider border-b border-neutral-800">
                  <th className="text-left py-3 pr-3">Code</th>
                  <th className="text-left py-3 pr-3">Name</th>
                  <th className="text-left py-3 pr-3">Category</th>
                  <th className="text-left py-3 pr-3">Cost Structure</th>
                  <th className="text-left py-3 pr-3">Task Types</th>
                  <th className="text-center py-3 pr-3">Status</th>
                  <th className="text-center py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {skills.map((skill) => (
                  <tr
                    key={skill.id}
                    className="border-b border-neutral-800/50 hover:bg-neutral-800/20 transition-colors"
                  >
                    <td className="py-3 pr-3">
                      <code className="text-cyber-500 font-mono">
                        {skill.code}
                      </code>
                      {skill.is_system && (
                        <Badge variant="neutral" className="ml-2">
                          SYSTEM
                        </Badge>
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      <div className="text-neutral-200">{skill.name}</div>
                      {skill.description && (
                        <div className="text-neutral-500 text-xs mt-0.5">
                          {skill.description}
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      <Badge variant="neutral">{skill.category}</Badge>
                    </td>
                    <td className="py-3 pr-3 font-mono text-xs">
                      <div className="space-y-0.5 text-neutral-400">
                        <div>LLM: {skill.cost_structure.llm_inference}</div>
                        <div>Data: {skill.cost_structure.data_retrieval}</div>
                        <div>Storage: {skill.cost_structure.storage}</div>
                        <div>Submit: {skill.cost_structure.submission}</div>
                      </div>
                    </td>
                    <td className="py-3 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {skill.task_types.map((type) => (
                          <Badge key={type} variant="catalog">
                            {type}
                          </Badge>
                        ))}
                        {skill.task_types.length === 0 && (
                          <span className="text-neutral-600">None</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 pr-3 text-center">
                      <Badge
                        variant={skill.is_active ? "active" : "neutral"}
                      >
                        {skill.is_active ? "ACTIVE" : "INACTIVE"}
                      </Badge>
                    </td>
                    <td className="py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => setEditingSkill(skill)}
                          className="text-xs text-neutral-400 hover:text-cyber-500 transition-colors"
                        >
                          Edit
                        </button>
                        {!skill.is_system && (
                          <button
                            onClick={() => handleDelete(skill)}
                            className="text-xs text-neutral-400 hover:text-red-400 transition-colors"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create/Edit Modal */}
      {(showCreateModal || editingSkill) && (
        <SkillModal
          skill={editingSkill}
          onClose={() => {
            setShowCreateModal(false);
            setEditingSkill(null);
          }}
          onSave={() => {
            setShowCreateModal(false);
            setEditingSkill(null);
            fetchSkills();
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
// SKILL MODAL COMPONENT
// ============================================================================

function SkillModal({
  skill,
  onClose,
  onSave,
}: {
  skill: Skill | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const isEdit = !!skill;

  const [code, setCode] = useState(skill?.code || "");
  const [name, setName] = useState(skill?.name || "");
  const [description, setDescription] = useState(skill?.description || "");
  const [category, setCategory] = useState(skill?.category || "general");
  const [llmCost, setLlmCost] = useState(
    skill?.cost_structure.llm_inference?.toString() || "0.03"
  );
  const [dataCost, setDataCost] = useState(
    skill?.cost_structure.data_retrieval?.toString() || "0.02"
  );
  const [storageCost, setStorageCost] = useState(
    skill?.cost_structure.storage?.toString() || "0.005"
  );
  const [submitCost, setSubmitCost] = useState(
    skill?.cost_structure.submission?.toString() || "0.002"
  );
  const [taskTypes, setTaskTypes] = useState(
    skill?.task_types.join(", ") || ""
  );
  const [isActive, setIsActive] = useState(skill?.is_active ?? true);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);

    try {
      const costStructure = {
        llm_inference: parseFloat(llmCost),
        data_retrieval: parseFloat(dataCost),
        storage: parseFloat(storageCost),
        submission: parseFloat(submitCost),
      };

      const taskTypesArray = taskTypes
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      if (isEdit) {
        const updateData: UpdateSkillRequest = {
          name,
          description: description || undefined,
          category,
          cost_structure: costStructure,
          task_types: taskTypesArray,
          is_active: isActive,
        };

        const res = await fetch(`/api/admin/skills/${skill.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updateData),
        });

        if (res.ok) {
          onSave();
        } else {
          const data = await res.json();
          alert(data.error || "Failed to update skill");
        }
      } else {
        const createData: CreateSkillRequest = {
          code,
          name,
          description: description || undefined,
          category,
          cost_structure: costStructure,
          task_types: taskTypesArray,
          is_active: isActive,
        };

        const res = await fetch("/api/admin/skills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(createData),
        });

        if (res.ok) {
          onSave();
        } else {
          const data = await res.json();
          alert(data.error || "Failed to create skill");
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
      <Card className="max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-200 uppercase tracking-wider">
              {isEdit ? "Edit Skill" : "Create Skill"}
            </h2>
            <button
              onClick={onClose}
              className="text-neutral-500 hover:text-neutral-300"
            >
              Close
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs text-neutral-500 mb-1">
                Code {!isEdit && <span className="text-red-400">*</span>}
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                disabled={isEdit}
                placeholder="e.g., CATALOG"
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
                placeholder="e.g., Catalog Extraction"
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
                placeholder="Brief description of this skill..."
                rows={2}
                className="w-full bg-void border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-cyber-700"
              />
            </div>

            <div>
              <label className="block text-xs text-neutral-500 mb-1">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-void border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-cyber-700"
              >
                <option value="general">General</option>
                <option value="data">Data</option>
                <option value="analysis">Analysis</option>
                <option value="commerce">Commerce</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-neutral-500 mb-2">
                Cost Structure (USDC)
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-neutral-600 mb-1">
                    LLM Inference
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    value={llmCost}
                    onChange={(e) => setLlmCost(e.target.value)}
                    className="w-full bg-void border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-cyber-700"
                  />
                </div>
                <div>
                  <label className="block text-xs text-neutral-600 mb-1">
                    Data Retrieval
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    value={dataCost}
                    onChange={(e) => setDataCost(e.target.value)}
                    className="w-full bg-void border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-cyber-700"
                  />
                </div>
                <div>
                  <label className="block text-xs text-neutral-600 mb-1">
                    Storage
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    value={storageCost}
                    onChange={(e) => setStorageCost(e.target.value)}
                    className="w-full bg-void border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-cyber-700"
                  />
                </div>
                <div>
                  <label className="block text-xs text-neutral-600 mb-1">
                    Submission
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    value={submitCost}
                    onChange={(e) => setSubmitCost(e.target.value)}
                    className="w-full bg-void border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-cyber-700"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs text-neutral-500 mb-1">
                Task Types (comma-separated)
              </label>
              <input
                type="text"
                value={taskTypes}
                onChange={(e) => setTaskTypes(e.target.value)}
                placeholder="e.g., CATALOG, REVIEW"
                className="w-full bg-void border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-cyber-700"
              />
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

          <div className="flex gap-2 pt-2">
            <Button
              variant="primary"
              onClick={handleSave}
              loading={saving}
              disabled={!code || !name}
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
