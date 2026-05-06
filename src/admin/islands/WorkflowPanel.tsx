/** @jsxImportSource preact */
/**
 * Island: workflow status panel — shows current status, transition buttons,
 * scheduled-publish control, and recent workflow history for a page.
 * Talks to /admin/api/workflow/*.
 */

import { h, Fragment } from "preact";
import { useState, useEffect } from "preact/hooks";

interface Stage {
  id: string;
  label: string;
  color?: string;
}

interface Transition {
  to: string;
  label: string;
}

interface ScheduledAction {
  id: string;
  action: string;
  scheduledAt: number;
}

interface WorkflowStatus {
  currentStatus: string;
  transitions: Transition[];
  stages: Stage[];
  scheduledActions: ScheduledAction[];
}

interface Props {
  pagePath: string;
  prefix: string;
}

const NAMED_COLORS: Record<string, string> = {
  amber: "#f59e0b",
  blue: "#3b82f6",
  green: "#10b981",
  gray: "#6b7280",
  orange: "#f97316",
  teal: "#14b8a6",
  red: "#ef4444",
  purple: "#8b5cf6",
};

const FALLBACK_COLORS: Record<string, string> = {
  draft: "#f59e0b",
  in_review: "#3b82f6",
  published: "#10b981",
  archived: "#6b7280",
};

function stageColor(stage: Stage | undefined, status: string): string {
  if (stage?.color) return NAMED_COLORS[stage.color] ?? stage.color;
  return FALLBACK_COLORS[status] ?? "#6b7280";
}

export default function WorkflowPanel({ pagePath, prefix }: Props) {
  const apiBase = `${prefix}/api`;
  const encoded = encodeURIComponent(pagePath);

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<WorkflowStatus | null>(null);
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Scheduling UI
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleAction, setScheduleAction] = useState("publish");
  const [scheduling, setScheduling] = useState(false);

  useEffect(() => {
    load();
  }, [pagePath]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [statusRes, scheduledRes] = await Promise.all([
        fetch(`${apiBase}/workflow/status/${encoded}`),
        fetch(`${apiBase}/workflow/scheduled/${encoded}`),
      ]);
      const s = await statusRes.json() as WorkflowStatus;
      const sch = await scheduledRes.json() as { items: ScheduledAction[] };
      setStatus({ ...s, scheduledActions: sch.items ?? [] });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function transition(to: string) {
    setTransitioning(to);
    setError("");
    try {
      const res = await fetch(`${apiBase}/workflow/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
        body: JSON.stringify({ path: pagePath, to }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError((err as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      await load();
    } finally {
      setTransitioning(null);
    }
  }

  async function scheduleAction_() {
    if (!scheduleDate) return;
    setScheduling(true);
    try {
      const res = await fetch(`${apiBase}/workflow/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
        body: JSON.stringify({
          path: pagePath,
          action: scheduleAction,
          scheduledAt: new Date(scheduleDate).getTime(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError((err as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      setShowSchedule(false);
      setScheduleDate("");
      await load();
    } finally {
      setScheduling(false);
    }
  }

  async function cancelSchedule(schedId: string) {
    if (!confirm("Cancel this scheduled action?")) return;
    await fetch(`${apiBase}/workflow/schedule/${schedId}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": getCsrf() },
    });
    await load();
  }

  if (loading) return <div style="color:#718096;font-size:0.9rem">Loading workflow…</div>;
  if (error) return <div style="color:#e53e3e;font-size:0.9rem">{error}</div>;
  if (!status) return null;

  const currentStage = status.stages.find((s) => s.id === status.currentStatus);
  const color = stageColor(currentStage, status.currentStatus);
  const statusLabel = currentStage?.label ?? status.currentStatus;

  return (
    <div class="workflow-panel">
      {/* Current status */}
      <div style="margin-bottom:1rem">
        <div style="font-size:0.8rem;color:#718096;margin-bottom:0.25rem">Status</div>
        <span
          style={`display:inline-block;padding:0.25rem 0.75rem;border-radius:999px;font-size:0.85rem;font-weight:600;color:white;background:${color}`}
        >
          {statusLabel}
        </span>
      </div>

      {/* Transitions */}
      {status.transitions.length > 0 && (
        <div style="margin-bottom:1rem">
          <div style="font-size:0.8rem;color:#718096;margin-bottom:0.5rem">Move to</div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
            {status.transitions.map((t) => {
              const targetStage = status.stages.find((s) => s.id === t.to);
              const tc = stageColor(targetStage, t.to);
              return (
                <button
                  key={t.to}
                  class="btn btn-sm"
                  style={`background:${tc};color:white;border:none`}
                  onClick={() => transition(t.to)}
                  disabled={transitioning === t.to}
                >
                  {transitioning === t.to ? "…" : t.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Scheduled actions */}
      {status.scheduledActions.length > 0 && (
        <div style="margin-bottom:1rem">
          <div style="font-size:0.8rem;color:#718096;margin-bottom:0.5rem">Scheduled</div>
          {status.scheduledActions.map((sa) => (
            <div
              key={sa.id}
              style="display:flex;align-items:center;gap:0.5rem;font-size:0.85rem;padding:0.25rem 0"
            >
              <span style="color:#f59e0b">⏰</span>
              <span>{sa.action}</span>
              <span style="color:#718096">{new Date(sa.scheduledAt).toLocaleString()}</span>
              <button
                class="btn btn-xs btn-outline"
                style="margin-left:auto"
                onClick={() => cancelSchedule(sa.id)}
              >
                Cancel
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Schedule button */}
      <button
        class="btn btn-xs btn-outline"
        style="margin-bottom:0.5rem"
        onClick={() => setShowSchedule((v) => !v)}
      >
        {showSchedule ? "Cancel" : "Schedule action…"}
      </button>

      {showSchedule && (
        <div style="background:#f7fafc;border:1px solid #e2e8f0;border-radius:6px;padding:0.75rem;margin-top:0.5rem">
          <div class="form-group" style="margin-bottom:0.5rem">
            <label style="font-size:0.85rem">Action</label>
            <select
              value={scheduleAction}
              onChange={(e) => setScheduleAction((e.target as HTMLSelectElement).value)}
            >
              <option value="publish">Publish</option>
              <option value="unpublish">Unpublish</option>
              <option value="archive">Archive</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom:0.75rem">
            <label style="font-size:0.85rem">When</label>
            <input
              type="datetime-local"
              value={scheduleDate}
              onInput={(e) => setScheduleDate((e.target as HTMLInputElement).value)}
              min={new Date().toISOString().slice(0, 16)}
            />
          </div>
          <button
            class="btn btn-sm btn-primary"
            onClick={scheduleAction_}
            disabled={scheduling || !scheduleDate}
          >
            {scheduling ? "Scheduling…" : "Schedule"}
          </button>
        </div>
      )}
    </div>
  );
}

function getCsrf(): string {
  return (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content ?? "";
}
