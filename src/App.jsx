import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = "/api/tasks";
const DEFAULT_TAG = "General";
const RESERVED_FILTER_TAG = "All";

function normalizeTaskTags(task) {
  const rawTags = Array.isArray(task?.tags)
    ? task.tags
    : task?.tag
      ? [task.tag]
      : [DEFAULT_TAG];

  const seen = new Set();
  const tags = [];
  for (const value of rawTags) {
    const tag = String(value ?? "").trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }

  return tags.length > 0 ? tags : [DEFAULT_TAG];
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Server returned invalid JSON.");
  }
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });

  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(data?.error || `Request failed (${response.status})`);
  }

  return data;
}

const tasksApi = {
  list() {
    return apiRequest(API_BASE);
  },
  create(payload) {
    return apiRequest(API_BASE, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  update(taskId, payload) {
    return apiRequest(`${API_BASE}/${encodeURIComponent(taskId)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  reorder(taskIds) {
    return apiRequest(`${API_BASE}/reorder`, {
      method: "POST",
      body: JSON.stringify({ taskIds }),
    });
  },
  deleteCompleted() {
    return apiRequest(`${API_BASE}/completed`, {
      method: "DELETE",
    });
  },
  deleteTagEverywhere(tag) {
    return apiRequest("/api/tags/delete", {
      method: "POST",
      body: JSON.stringify({ tag }),
    });
  },
  deleteTask(taskId) {
    return apiRequest(`${API_BASE}/${encodeURIComponent(taskId)}`, {
      method: "DELETE",
    });
  },
  listLogbook() {
    return apiRequest("/api/logbook");
  },
  clearLogbook() {
    return apiRequest("/api/logbook", {
      method: "DELETE",
    });
  },
};

function Sidebar({ isOpen, onClose, activeView, onSelectView }) {
  const items = ["Inbox", "Logbook", "Today", "Upcoming", "Anytime", "Someday"];
  return (
    <aside className={`sidebar ${isOpen ? "open" : ""}`}>
      <div className="appTitle">MiniThings</div>
      <nav className="nav">
        {items.map((label) => (
          <button
            key={label}
            className={`navItem ${label === activeView ? "active" : ""}`}
            onClick={() => {
              onSelectView(label);
              onClose();
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="sectionTitle">Projects</div>
      <div className="projects">
        <button className="projectItem" onClick={onClose}>Work</button>
        <button className="projectItem" onClick={onClose}>Personal</button>
      </div>
    </aside>
  );
}

function formatLogDate(isoString) {
  try {
    return new Date(isoString).toLocaleString();
  } catch {
    return String(isoString ?? "");
  }
}

function summarizeLogEntry(entry) {
  const data = entry?.data ?? {};
  switch (entry?.type) {
    case "task_completed":
      return `Completed: ${data.title ?? "Task"}`;
    case "task_reopened":
      return `Reopened: ${data.title ?? "Task"}`;
    case "task_deleted":
      return `Deleted task: ${data.title ?? "Task"}`;
    case "completed_tasks_deleted":
      return `Deleted ${data.count ?? 0} completed task${data.count === 1 ? "" : "s"}`;
    case "tag_removed_from_task":
      return `Removed tag "${data.tag ?? ""}" from ${data.title ?? "task"}`;
    case "tag_deleted_everywhere":
      return `Deleted tag "${data.tag ?? ""}" from ${data.changedCount ?? 0} task${data.changedCount === 1 ? "" : "s"}`;
    default:
      return entry?.type ?? "Log event";
  }
}

function renderLogEntryMeta(entry) {
  const data = entry?.data ?? {};
  if (entry?.type === "completed_tasks_deleted" && Array.isArray(data.tasks)) {
    return data.tasks.map((task) => task.title).join(", ");
  }
  if (entry?.type === "task_completed" || entry?.type === "task_reopened" || entry?.type === "task_deleted") {
    const tags = normalizeTaskTags(data.task ?? {});
    return tags.length ? `Tags: ${tags.join(", ")}` : "";
  }
  if (entry?.type === "tag_removed_from_task") {
    return `Before: ${(data.beforeTags ?? []).join(", ") || "none"} | After: ${(data.afterTags ?? []).join(", ") || "none"}`;
  }
  return "";
}

function LogbookView({ entries, isLoading, onRefresh, onClear }) {
  return (
    <section className="list">
      <header className="listHeader">
        <h1>Logbook</h1>
        <div className="listHeaderMetaRow">
          <div className="subtleMeta">{entries.length} event{entries.length === 1 ? "" : "s"}</div>
          <div className="logbookHeaderActions">
            <button type="button" className="secondaryButton" onClick={() => void onRefresh()} disabled={isLoading}>
              Refresh
            </button>
            <button type="button" className="dangerButton" onClick={() => void onClear()} disabled={isLoading || entries.length === 0}>
              Clear Log
            </button>
          </div>
        </div>
      </header>

      <div className="card">
        {isLoading && <div className="statusBanner">Loading logbook…</div>}
        {!isLoading && entries.length === 0 && (
          <div className="emptyLogbook">No log entries yet.</div>
        )}
        {entries.map((entry) => (
          <div key={entry.id} className="logEntry">
            <div className="logEntryTitle">{summarizeLogEntry(entry)}</div>
            <div className="logEntryTime">{formatLogDate(entry.createdAt)}</div>
            {renderLogEntryMeta(entry) && (
              <div className="logEntryMeta">{renderLogEntryMeta(entry)}</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function EditTaskModal({ task, onClose, onSave, onDeleteTask, tagOptions: _tagOptions }) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [tags, setTags] = useState(normalizeTaskTags(task));
  const [newTagInput, setNewTagInput] = useState("");
  const titleInputRef = useRef(null);

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? "");
    setTags(normalizeTaskTags(task));
    setNewTagInput("");
  }, [task]);

  useEffect(() => {
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, []);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function addTag(rawValue) {
    const nextTag = String(rawValue ?? "").trim();
    if (!nextTag) return;

    setTags((prev) => {
      const exists = prev.some((tag) => tag.toLowerCase() === nextTag.toLowerCase());
      if (exists) return prev;
      return [...prev, nextTag];
    });
    setNewTagInput("");
  }

  function removeTag(tagToRemove) {
    setTags((prev) => {
      const next = prev.filter((tag) => tag.toLowerCase() !== tagToRemove.toLowerCase());
      return next.length > 0 ? next : [DEFAULT_TAG];
    });
  }

  async function submit(event) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    await onSave(task.id, {
      title: trimmedTitle,
      description: description.trim(),
      tags: normalizeTaskTags({ tags }),
    });
  }

  return (
    <div className="modalBackdrop" onClick={onClose} role="presentation">
      <div
        className="modalCard"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-task-title"
      >
        <div className="modalHeader">
          <h2 id="edit-task-title">Edit Task</h2>
          <button type="button" className="iconButton" onClick={onClose} aria-label="Close edit task">
            ×
          </button>
        </div>

        <form className="editTaskForm" onSubmit={submit}>
          <label className="fieldLabel" htmlFor="task-title">Title</label>
          <input
            ref={titleInputRef}
            id="task-title"
            className="fieldInput"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Task title"
          />

          <label className="fieldLabel" htmlFor="task-description">Description</label>
          <textarea
            id="task-description"
            className="fieldTextarea"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Add details for this task"
            rows={5}
          />

          <div className="fieldLabel">Tags</div>
          <div className="tagEditor">
            <div className="tagChipList" aria-label="Selected tags">
              {tags.map((tag) => (
                <span key={tag} className="tagChip">
                  {tag}
                  <button
                    type="button"
                    className="tagChipRemove"
                    onClick={() => removeTag(tag)}
                    aria-label={`Remove tag ${tag}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            <div className="tagEditorRow">
              <input
                id="task-tag"
                className="fieldInput"
                value={newTagInput}
                onChange={(event) => setNewTagInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addTag(newTagInput);
                  }
                }}
                placeholder="Add a tag and press Enter"
              />
              <button
                type="button"
                className="secondaryButton"
                onClick={() => addTag(newTagInput)}
              >
                Add Tag
              </button>
            </div>

          </div>

          <div className="modalActions">
            <button type="submit" className="primaryButton">Save</button>
            <button type="button" className="dangerButton" onClick={() => void onDeleteTask(task.id)}>
              Delete Task
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TaskRow({
  task,
  onToggle,
  onOpenEdit,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  draggingId,
}) {
  const isDragging = draggingId === task.id;
  return (
    <div
      className={`taskRow ${isDragging ? "dragging" : ""}`}
      draggable
      onDragStart={(e) => onDragStart(e, task.id)}
      onDragOver={(e) => onDragOver(e, task.id)}
      onDrop={(e) => onDrop(e, task.id)}
      onDragEnd={onDragEnd}
    >
      <button
        type="button"
        className={`checkboxButton ${task.done ? "checked" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          void onToggle(task.id);
        }}
        role="checkbox"
        aria-checked={task.done}
        aria-label={`${task.done ? "Mark as incomplete" : "Mark as complete"}: ${task.title}`}
      >
        <span className={`checkbox ${task.done ? "checked" : ""}`} aria-hidden="true" />
      </button>

      <button
        type="button"
        className="taskContentButton"
        onClick={() => onOpenEdit(task.id)}
      >
        <span className="taskContent">
          <span className={`taskContentTitle ${task.done ? "done" : ""}`}>{task.title}</span>
          <span className="taskTagList">
            {normalizeTaskTags(task).map((tag) => (
              <span key={tag} className="taskTagBadge">{tag}</span>
            ))}
          </span>
          <span className={`taskContentDescription ${task.done ? "done" : ""}`}>
            {task.description?.trim() || "No description yet."}
          </span>
        </span>
      </button>
    </div>
  );
}

function TaskList({
  title,
  tasks,
  onAddTask,
  onToggleTask,
  onOpenEditTask,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  draggingId,
  isLoading,
  selectedTags,
  onToggleFilterTag,
  onClearFilterTags,
  onDeleteCompletedTasks,
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const availableTags = useMemo(() => {
    const tags = new Set();
    for (const task of tasks) {
      for (const tag of normalizeTaskTags(task)) {
        if (tag.toLowerCase() === RESERVED_FILTER_TAG.toLowerCase()) continue;
        tags.add(tag);
      }
    }
    return [RESERVED_FILTER_TAG, ...Array.from(tags).sort((a, b) => a.localeCompare(b))];
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    if (selectedTags.length === 0) return tasks;
    return tasks.filter((task) =>
      normalizeTaskTags(task).some((tag) =>
        selectedTags.some((selected) => selected.toLowerCase() === tag.toLowerCase())
      )
    );
  }, [tasks, selectedTags]);

  const remaining = useMemo(() => filteredTasks.filter((t) => !t.done).length, [filteredTasks]);
  const completedCount = useMemo(() => tasks.filter((t) => t.done).length, [tasks]);
  const sortedTasks = useMemo(() => {
    const incomplete = filteredTasks.filter((t) => !t.done);
    const done = filteredTasks.filter((t) => t.done);
    return [...incomplete, ...done];
  }, [filteredTasks]);

  async function submit(e) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;

    await onAddTask(trimmed);
    setValue("");
    inputRef.current?.focus();
  }

  return (
    <section className="list">
      <header className="listHeader">
        <h1>{title}</h1>
        <div className="listHeaderMetaRow">
          <div className="subtleMeta">{remaining} remaining</div>
          <div className="tagFilters" role="toolbar" aria-label="Filter tasks by tag">
            {availableTags.map((tag) => (
              tag === RESERVED_FILTER_TAG ? (
                <button
                  key={tag}
                  type="button"
                  className={`tagFilterButton ${selectedTags.length === 0 ? "active" : ""}`}
                  onClick={onClearFilterTags}
                  aria-pressed={selectedTags.length === 0}
                >
                  {tag}
                </button>
              ) : (
                <button
                  key={tag}
                  type="button"
                  className={`tagFilterButton ${selectedTags.some((value) => value.toLowerCase() === tag.toLowerCase()) ? "active" : ""}`}
                  onClick={() => onToggleFilterTag(tag)}
                  aria-pressed={selectedTags.some((value) => value.toLowerCase() === tag.toLowerCase())}
                >
                  {tag}
                </button>
              )
            ))}
          </div>
        </div>
      </header>

      <div
        className="card"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => onDrop(e, null)}
      >
        {isLoading && <div className="statusBanner">Loading tasks from markdown files…</div>}

        {sortedTasks.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            onToggle={onToggleTask}
            onOpenEdit={onOpenEditTask}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragEnd={onDragEnd}
            draggingId={draggingId}
          />
        ))}
        <div className="divider" />
        <div className="taskRow">
          <form className="quickEntry" onSubmit={submit}>
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="quickEntryInput"
              placeholder="Add a task…"
              aria-label="Add a task"
              disabled={isLoading}
            />
          </form>
        </div>
      </div>
      <div className="listFooterActions">
        <button
          type="button"
          className="dangerButton"
          onClick={() => void onDeleteCompletedTasks()}
          disabled={completedCount === 0 || isLoading}
        >
          Delete Completed ({completedCount})
        </button>
      </div>
    </section>
  );
}

function reorderTaskArray(tasks, draggedId, targetId) {
  const srcIndex = tasks.findIndex((task) => task.id === draggedId);
  if (srcIndex === -1) return tasks;

  const next = tasks.slice();
  const [moved] = next.splice(srcIndex, 1);

  if (!targetId) {
    next.push(moved);
    return next;
  }

  const dstIndex = next.findIndex((task) => task.id === targetId);
  const insertIndex = dstIndex === -1 ? next.length : dstIndex;
  next.splice(insertIndex, 0, moved);
  return next;
}

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [logEntries, setLogEntries] = useState([]);
  const [logbookLoading, setLogbookLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeView, setActiveView] = useState("Inbox");
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [selectedTags, setSelectedTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const draggedIdRef = useRef(null);
  const [draggingId, setDraggingId] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadTasks() {
      try {
        const data = await tasksApi.list();
        if (!cancelled) {
          setTasks(Array.isArray(data?.tasks) ? data.tasks : []);
          setErrorMessage("");
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error.message || "Failed to load tasks from the API.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadTasks();

    return () => {
      cancelled = true;
    };
  }, []);

  async function loadLogbook() {
    setLogbookLoading(true);
    try {
      const data = await tasksApi.listLogbook();
      setLogEntries(Array.isArray(data?.entries) ? data.entries : []);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error.message || "Failed to load logbook.");
    } finally {
      setLogbookLoading(false);
    }
  }

  useEffect(() => {
    if (activeView !== "Logbook") return;
    void loadLogbook();
  }, [activeView]);

  function handleDragStart(e, id) {
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", id); } catch {}
    draggedIdRef.current = id;
    setDraggingId(id);
  }

  function handleDragOver(e) {
    e.preventDefault();
  }

  async function handleDrop(e, targetId) {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData("text/plain") || draggedIdRef.current;
    if (!draggedId) return;

    let nextTasks = null;
    setTasks((prev) => {
      const reordered = reorderTaskArray(prev, draggedId, targetId);
      nextTasks = reordered;
      return reordered;
    });

    draggedIdRef.current = null;
    setDraggingId(null);

    if (!nextTasks) return;

    try {
      const data = await tasksApi.reorder(nextTasks.map((task) => task.id));
      if (Array.isArray(data?.tasks)) {
        setTasks(data.tasks);
      }
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error.message || "Failed to save task order.");
    }
  }

  function handleDragEnd() {
    draggedIdRef.current = null;
    setDraggingId(null);
  }

  async function addTask(title) {
    try {
      const data = await tasksApi.create({ title, description: "", tags: [DEFAULT_TAG] });
      if (data?.task) {
        setTasks((prev) => [data.task, ...prev]);
      }
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error.message || "Failed to create task.");
      throw error;
    }
  }

  async function toggleTask(taskId) {
    const currentTask = tasks.find((task) => task.id === taskId);
    if (!currentTask) return;

    const nextDone = !currentTask.done;
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, done: nextDone } : t)));

    try {
      const data = await tasksApi.update(taskId, { done: nextDone });
      if (data?.task) {
        setTasks((prev) => prev.map((t) => (t.id === taskId ? data.task : t)));
      }
      void loadLogbook();
      setErrorMessage("");
    } catch (error) {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, done: currentTask.done } : t)));
      setErrorMessage(error.message || "Failed to update task.");
    }
  }

  function openTaskEditor(taskId) {
    setEditingTaskId(taskId);
  }

  function closeTaskEditor() {
    setEditingTaskId(null);
  }

  async function saveTask(taskId, updates) {
    try {
      const data = await tasksApi.update(taskId, updates);
      if (data?.task) {
        setTasks((prev) => prev.map((task) => (task.id === taskId ? data.task : task)));
      }
      setEditingTaskId(null);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error.message || "Failed to save task.");
      throw error;
    }
  }

  async function deleteCompletedTasks() {
    const completedCount = tasks.filter((task) => task.done).length;
    if (completedCount === 0) return;

    const confirmed = window.confirm(`Delete ${completedCount} completed task${completedCount === 1 ? "" : "s"}?`);
    if (!confirmed) return;

    try {
      const data = await tasksApi.deleteCompleted();
      if (Array.isArray(data?.tasks)) {
        setTasks(data.tasks);
      } else {
        setTasks((prev) => prev.filter((task) => !task.done));
      }
      if (editingTaskId) {
        const stillExists = (data?.tasks ?? []).some((task) => task.id === editingTaskId);
        if (!stillExists) setEditingTaskId(null);
      }
      void loadLogbook();
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error.message || "Failed to delete completed tasks.");
    }
  }

  async function deleteTagEverywhere(tag) {
    try {
      const data = await tasksApi.deleteTagEverywhere(tag);
      if (Array.isArray(data?.tasks)) {
        setTasks(data.tasks);
      }
      void loadLogbook();
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error.message || "Failed to delete tag.");
      throw error;
    }
  }

  async function deleteTask(taskId) {
    const task = tasks.find((value) => value.id === taskId);
    if (!task) return;

    const confirmed = window.confirm(`Delete task "${task.title}"?`);
    if (!confirmed) return;

    try {
      await tasksApi.deleteTask(taskId);
      setTasks((prev) => prev.filter((value) => value.id !== taskId));
      setEditingTaskId(null);
      void loadLogbook();
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error.message || "Failed to delete task.");
      throw error;
    }
  }

  const editingTask = tasks.find((task) => task.id === editingTaskId) ?? null;
  const tagPool = useMemo(
    () => Array.from(new Set(tasks.flatMap((task) => normalizeTaskTags(task)))).sort((a, b) => a.localeCompare(b)),
    [tasks]
  );

  useEffect(() => {
    setSelectedTags((prev) =>
      prev.filter((selected) => tagPool.some((tag) => tag.toLowerCase() === selected.toLowerCase()))
    );
  }, [tagPool]);

  function toggleFilterTag(tag) {
    setSelectedTags((prev) => {
      const exists = prev.some((value) => value.toLowerCase() === tag.toLowerCase());
      if (exists) {
        return prev.filter((value) => value.toLowerCase() !== tag.toLowerCase());
      }
      return [...prev, tag];
    });
  }

  function clearFilterTags() {
    setSelectedTags([]);
  }

  async function clearLogbook() {
    const confirmed = window.confirm("Clear the logbook?");
    if (!confirmed) return;
    try {
      await tasksApi.clearLogbook();
      setLogEntries([]);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error.message || "Failed to clear logbook.");
    }
  }

  return (
    <div className="app">
      <button
        className={`hamburger ${sidebarOpen ? "open" : ""}`}
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label="Toggle sidebar"
        aria-expanded={sidebarOpen}
      >
        <span />
        <span />
        <span />
      </button>
      {sidebarOpen && <div className="overlay" onClick={() => setSidebarOpen(false)} />}
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        activeView={activeView}
        onSelectView={setActiveView}
      />
      <main className="main">
        {errorMessage && (
          <div className="errorBanner" role="status">
            {errorMessage}
          </div>
        )}
        {activeView === "Logbook" ? (
          <LogbookView
            entries={logEntries}
            isLoading={logbookLoading}
            onRefresh={loadLogbook}
            onClear={clearLogbook}
          />
        ) : (
          <TaskList
            title="Inbox"
            tasks={tasks}
            onAddTask={addTask}
            onToggleTask={toggleTask}
            onOpenEditTask={openTaskEditor}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            draggingId={draggingId}
            isLoading={loading}
            selectedTags={selectedTags}
            onToggleFilterTag={toggleFilterTag}
            onClearFilterTags={clearFilterTags}
            onDeleteCompletedTasks={deleteCompletedTasks}
          />
        )}
      </main>
      {editingTask && (
        <EditTaskModal
          task={editingTask}
          onClose={closeTaskEditor}
          onSave={saveTask}
          onDeleteTask={deleteTask}
          tagOptions={tagPool}
        />
      )}
    </div>
  );
}
