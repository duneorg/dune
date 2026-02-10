/**
 * Workflow panel — status selector, transition buttons, and schedule pickers.
 *
 * Renders as an inline panel within the page editor sidebar.
 */

import type { ContentStatus } from "../../workflow/types.ts";

interface WorkflowPanelData {
  sourcePath: string;
  currentStatus: ContentStatus;
  allowedTransitions: ContentStatus[];
  scheduledActions: Array<{
    id: string;
    action: string;
    scheduledAt: number;
  }>;
}

/**
 * Render the workflow panel HTML for the page editor sidebar.
 */
export function renderWorkflowPanel(prefix: string, data: WorkflowPanelData): string {
  const statusLabels: Record<ContentStatus, string> = {
    draft: "📝 Draft",
    in_review: "👀 In Review",
    published: "✅ Published",
    archived: "📦 Archived",
  };

  const statusColors: Record<ContentStatus, string> = {
    draft: "#f59e0b",
    in_review: "#3b82f6",
    published: "#10b981",
    archived: "#6b7280",
  };

  const transitionButtons = data.allowedTransitions.map((to) => `
    <button class="btn btn-sm btn-outline workflow-transition"
            data-from="${data.currentStatus}" data-to="${to}"
            onclick="transitionStatus('${data.sourcePath}', '${to}')">
      → ${statusLabels[to]}
    </button>
  `).join("");

  const scheduledItems = data.scheduledActions.map((a) => `
    <div class="scheduled-item">
      <span class="scheduled-action">${a.action}</span>
      <span class="scheduled-time">${new Date(a.scheduledAt).toLocaleString()}</span>
      <button class="btn btn-xs btn-outline" onclick="cancelScheduled('${a.id}')">✕</button>
    </div>
  `).join("");

  return `
  <div class="workflow-panel">
    <h4>Workflow</h4>

    <div class="workflow-status">
      <span class="status-badge" style="background: ${statusColors[data.currentStatus]}20; color: ${statusColors[data.currentStatus]}; border: 1px solid ${statusColors[data.currentStatus]}40;">
        ${statusLabels[data.currentStatus]}
      </span>
    </div>

    ${data.allowedTransitions.length > 0 ? `
    <div class="workflow-transitions">
      <label>Change status:</label>
      <div class="transition-buttons">
        ${transitionButtons}
      </div>
    </div>
    ` : ""}

    <div class="workflow-schedule">
      <label>Schedule action:</label>
      <div class="schedule-form">
        <select id="schedule-action" class="form-select-sm">
          <option value="publish">Publish</option>
          <option value="unpublish">Unpublish</option>
          <option value="archive">Archive</option>
        </select>
        <input type="datetime-local" id="schedule-datetime" class="form-input-sm">
        <button class="btn btn-xs btn-primary" onclick="scheduleAction('${data.sourcePath}')">Schedule</button>
      </div>
    </div>

    ${data.scheduledActions.length > 0 ? `
    <div class="workflow-scheduled">
      <label>Scheduled:</label>
      ${scheduledItems}
    </div>
    ` : ""}
  </div>
  `;
}

/**
 * Render the workflow panel inline scripts.
 */
export function renderWorkflowScripts(prefix: string): string {
  return `
  <script>
    async function transitionStatus(sourcePath, newStatus) {
      try {
        const res = await fetch(\`${prefix}/api/workflow/transition\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourcePath, status: newStatus })
        });
        const data = await res.json();
        if (data.error) {
          alert('Error: ' + data.error);
        } else {
          location.reload();
        }
      } catch (err) {
        alert('Failed to transition: ' + err.message);
      }
    }

    async function scheduleAction(sourcePath) {
      const action = document.getElementById('schedule-action').value;
      const datetime = document.getElementById('schedule-datetime').value;
      if (!datetime) { alert('Please select a date and time'); return; }

      try {
        const res = await fetch(\`${prefix}/api/workflow/schedule\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourcePath,
            action,
            scheduledAt: new Date(datetime).getTime()
          })
        });
        const data = await res.json();
        if (data.error) {
          alert('Error: ' + data.error);
        } else {
          location.reload();
        }
      } catch (err) {
        alert('Failed to schedule: ' + err.message);
      }
    }

    async function cancelScheduled(id) {
      try {
        const res = await fetch(\`${prefix}/api/workflow/schedule/\${id}\`, {
          method: 'DELETE'
        });
        const data = await res.json();
        if (data.error) {
          alert('Error: ' + data.error);
        } else {
          location.reload();
        }
      } catch (err) {
        alert('Failed to cancel: ' + err.message);
      }
    }
  </script>
  `;
}

/**
 * CSS for workflow panel.
 */
export function workflowPanelStyles(): string {
  return `
  .workflow-panel { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #e5e7eb; }
  .workflow-panel h4 { font-size: 0.85rem; color: #374151; margin-bottom: 0.5rem; }
  .workflow-status { margin-bottom: 0.75rem; }
  .status-badge { display: inline-block; padding: 0.25rem 0.6rem; border-radius: 9999px; font-size: 0.8rem; font-weight: 600; }
  .workflow-transitions { margin-bottom: 0.75rem; }
  .workflow-transitions label { display: block; font-size: 0.75rem; color: #6b7280; margin-bottom: 0.25rem; }
  .transition-buttons { display: flex; flex-wrap: wrap; gap: 0.25rem; }
  .workflow-transition { font-size: 0.75rem !important; }
  .workflow-schedule { margin-bottom: 0.75rem; }
  .workflow-schedule label { display: block; font-size: 0.75rem; color: #6b7280; margin-bottom: 0.25rem; }
  .schedule-form { display: flex; flex-direction: column; gap: 0.25rem; }
  .form-select-sm, .form-input-sm { padding: 0.25rem 0.4rem; border: 1px solid #d1d5db; border-radius: 4px; font-size: 0.8rem; }
  .workflow-scheduled { }
  .workflow-scheduled label { display: block; font-size: 0.75rem; color: #6b7280; margin-bottom: 0.25rem; }
  .scheduled-item { display: flex; align-items: center; gap: 0.35rem; padding: 0.2rem 0; font-size: 0.8rem; }
  .scheduled-action { font-weight: 500; text-transform: capitalize; }
  .scheduled-time { color: #6b7280; }
  `;
}
