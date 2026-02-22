import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TASKS_DIR = path.join(__dirname, "tasks");
const LOGBOOK_DIR = path.join(__dirname, "logbook");
const LOGBOOK_FILE = path.join(LOGBOOK_DIR, "logbook.jsonl");
const PORT = Number(process.env.PORT || 3001);

const seedTasks = [
  {
    id: "t1",
    title: "Book dentist appointment",
    description: "Call the clinic and confirm an early-morning slot for next week.",
    tags: ["Personal"],
    done: false,
    order: 0,
  },
  {
    id: "t2",
    title: "Send invoice to Marco",
    description: "Include the revised hourly breakdown and payment due date in the email.",
    tags: ["Work"],
    done: false,
    order: 1,
  },
  {
    id: "t3",
    title: "Run 8km easy",
    description: "Keep it conversational pace and finish with 10 minutes of mobility work.",
    tags: ["Health"],
    done: true,
    order: 2,
  },
  {
    id: "t4",
    title: "Refactor navbar animation",
    description: "Separate transition timing from layout logic to reduce jank on mobile.",
    tags: ["Work"],
    done: false,
    order: 3,
  },
  {
    id: "t5",
    title: "Plan Sunday ride",
    description: "Pick route, weather window, and coffee stop before Saturday night.",
    tags: ["Personal"],
    done: false,
    order: 4,
  },
];

function inferDefaultTags(taskId) {
  const tags = seedTasks.find((task) => task.id === taskId)?.tags;
  return Array.isArray(tags) && tags.length > 0 ? tags : ["General"];
}

function normalizeTags(inputTags, fallbackTaskId) {
  const rawTags = Array.isArray(inputTags)
    ? inputTags
    : inputTags == null
      ? inferDefaultTags(fallbackTaskId)
      : String(inputTags).includes(",")
        ? String(inputTags).split(",")
        : [inputTags];

  const tags = [];
  const seen = new Set();
  for (const value of rawTags) {
    const tag = String(value ?? "").trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }

  return tags.length > 0 ? tags : ["General"];
}

function slugify(input) {
  return String(input)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "task";
}

function normalizeTask(task) {
  const id = String(task.id);
  return {
    id,
    title: String(task.title ?? "Untitled").trim() || "Untitled",
    description: String(task.description ?? ""),
    tags: normalizeTags(task.tags ?? task.tag, id),
    done: Boolean(task.done),
    order: Number.isFinite(task.order) ? Number(task.order) : 0,
    createdAt: task.createdAt || new Date().toISOString(),
    updatedAt: task.updatedAt || new Date().toISOString(),
  };
}

function taskFilename(task) {
  return `${task.id}--${slugify(task.title)}.md`;
}

function taskFilePath(task) {
  return path.join(TASKS_DIR, taskFilename(task));
}

function toFrontmatterValue(value) {
  return JSON.stringify(value);
}

function taskToMarkdown(rawTask) {
  const task = normalizeTask(rawTask);
  const lines = [
    "---",
    `id: ${toFrontmatterValue(task.id)}`,
    `title: ${toFrontmatterValue(task.title)}`,
    `tags: ${toFrontmatterValue(task.tags)}`,
    `done: ${toFrontmatterValue(task.done)}`,
    `order: ${toFrontmatterValue(task.order)}`,
    `createdAt: ${toFrontmatterValue(task.createdAt)}`,
    `updatedAt: ${toFrontmatterValue(task.updatedAt)}`,
    "---",
    "",
    task.description.trimEnd(),
    "",
  ];

  return lines.join("\n");
}

function parseMarkdownTask(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error("Missing frontmatter block.");
  }

  const metaText = match[1];
  const body = match[2] ?? "";
  const meta = {};

  for (const line of metaText.split("\n")) {
    if (!line.trim()) continue;
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    try {
      meta[key] = JSON.parse(rawValue);
    } catch {
      meta[key] = rawValue;
    }
  }

  return normalizeTask({
    ...meta,
    description: body.trim(),
  });
}

async function ensureTasksDir() {
  await mkdir(TASKS_DIR, { recursive: true });
}

async function ensureLogbookStorage() {
  await mkdir(LOGBOOK_DIR, { recursive: true });
  try {
    await readFile(LOGBOOK_FILE, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      await writeFile(LOGBOOK_FILE, "", "utf8");
      return;
    }
    throw error;
  }
}

async function readTaskFile(fileName) {
  const filePath = path.join(TASKS_DIR, fileName);
  const content = await readFile(filePath, "utf8");
  const task = parseMarkdownTask(content);
  return { fileName, filePath, task };
}

async function readAllTaskRecords() {
  await ensureTasksDir();
  const entries = await readdir(TASKS_DIR);
  const markdownFiles = entries.filter((name) => name.endsWith(".md"));

  const records = [];
  for (const fileName of markdownFiles) {
    try {
      records.push(await readTaskFile(fileName));
    } catch (error) {
      console.error(`Failed to parse ${fileName}:`, error);
    }
  }

  records.sort((a, b) => {
    if (a.task.order !== b.task.order) return a.task.order - b.task.order;
    return String(a.task.createdAt).localeCompare(String(b.task.createdAt));
  });

  return records;
}

async function writeTask(task, previousFileName = null) {
  const normalized = normalizeTask(task);
  const nextFileName = taskFilename(normalized);
  const nextPath = path.join(TASKS_DIR, nextFileName);

  await writeFile(nextPath, taskToMarkdown(normalized), "utf8");

  if (previousFileName && previousFileName !== nextFileName) {
    const previousPath = path.join(TASKS_DIR, previousFileName);
    try {
      await rm(previousPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  return { fileName: nextFileName, filePath: nextPath, task: normalized };
}

async function ensureSeedTasks() {
  await ensureTasksDir();
  const entries = await readdir(TASKS_DIR);
  const hasMarkdown = entries.some((name) => name.endsWith(".md"));
  if (hasMarkdown) return;

  const now = new Date().toISOString();
  for (const seed of seedTasks) {
    await writeTask({ ...seed, createdAt: now, updatedAt: now });
  }
}

async function getTaskRecords() {
  await ensureSeedTasks();
  return readAllTaskRecords();
}

async function findTaskRecordById(taskId) {
  const records = await getTaskRecords();
  return records.find((record) => record.task.id === taskId) ?? null;
}

async function appendLogEntry(type, data) {
  await ensureLogbookStorage();
  const entry = {
    id: randomUUID(),
    type,
    createdAt: new Date().toISOString(),
    data,
  };

  const line = `${JSON.stringify(entry)}\n`;
  let current = "";
  try {
    current = await readFile(LOGBOOK_FILE, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeFile(LOGBOOK_FILE, current + line, "utf8");
  return entry;
}

async function readLogbookEntries() {
  await ensureLogbookStorage();
  const raw = await readFile(LOGBOOK_FILE, "utf8");
  const entries = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch (error) {
      console.error("Failed to parse logbook entry:", error);
    }
  }
  entries.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return entries;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body.");
  }
}

async function handleListTasks(_req, res) {
  const records = await getTaskRecords();
  sendJson(res, 200, { tasks: records.map((record) => record.task) });
}

async function handleListLogbook(_req, res) {
  const entries = await readLogbookEntries();
  sendJson(res, 200, { entries });
}

async function handleClearLogbook(_req, res) {
  await ensureLogbookStorage();
  await writeFile(LOGBOOK_FILE, "", "utf8");
  sendJson(res, 200, { ok: true, entries: [] });
}

async function handleCreateTask(req, res) {
  const body = await readRequestBody(req);
  const title = String(body.title ?? "").trim();
  if (!title) {
    sendJson(res, 400, { error: "Title is required." });
    return;
  }

  const records = await getTaskRecords();
  const order = records.length;
  const now = new Date().toISOString();
  const task = normalizeTask({
    id: randomUUID(),
    title,
    description: String(body.description ?? ""),
    tags: Array.isArray(body.tags) ? body.tags : ("tag" in body ? [body.tag] : ["General"]),
    done: Boolean(body.done),
    order,
    createdAt: now,
    updatedAt: now,
  });

  const record = await writeTask(task);
  sendJson(res, 201, { task: record.task });
}

async function handleUpdateTask(req, res, taskId) {
  const body = await readRequestBody(req);
  const record = await findTaskRecordById(taskId);
  if (!record) {
    sendJson(res, 404, { error: "Task not found." });
    return;
  }

  const nextTitle = body.title === undefined ? record.task.title : String(body.title).trim();
  if (!nextTitle) {
    sendJson(res, 400, { error: "Title is required." });
    return;
  }

  const updatedTask = normalizeTask({
    ...record.task,
    ...("done" in body ? { done: Boolean(body.done) } : null),
    ...("description" in body ? { description: String(body.description ?? "") } : null),
    ...("tags" in body ? { tags: body.tags } : null),
    ...(!("tags" in body) && "tag" in body ? { tags: [body.tag] } : null),
    ...("order" in body ? { order: Number(body.order) } : null),
    title: nextTitle,
    updatedAt: new Date().toISOString(),
  });

  const saved = await writeTask(updatedTask, record.fileName);
  if ("done" in body && saved.task.done !== record.task.done) {
    await appendLogEntry(saved.task.done ? "task_completed" : "task_reopened", {
      taskId: saved.task.id,
      title: saved.task.title,
      task: saved.task,
    });
  }
  sendJson(res, 200, { task: saved.task });
}

async function handleDeleteTask(_req, res, taskId) {
  const record = await findTaskRecordById(taskId);
  if (!record) {
    sendJson(res, 404, { error: "Task not found." });
    return;
  }

  await appendLogEntry("task_deleted", {
    taskId: record.task.id,
    title: record.task.title,
    task: record.task,
  });
  await rm(record.filePath);
  sendJson(res, 200, { ok: true });
}

async function handleDeleteCompletedTasks(_req, res) {
  const records = await getTaskRecords();
  const completed = records.filter((record) => record.task.done);

  if (completed.length > 0) {
    await appendLogEntry("completed_tasks_deleted", {
      count: completed.length,
      tasks: completed.map((record) => record.task),
    });
  }

  for (const record of completed) {
    await rm(record.filePath);
  }

  const remaining = await getTaskRecords();
  sendJson(res, 200, {
    deletedCount: completed.length,
    tasks: remaining.map((record) => record.task),
  });
}

async function handleDeleteTagEverywhere(req, res) {
  const body = await readRequestBody(req);
  const tagToDelete = String(body.tag ?? "").trim();
  if (!tagToDelete) {
    sendJson(res, 400, { error: "Tag is required." });
    return;
  }

  const records = await getTaskRecords();
  let changedCount = 0;

  for (const record of records) {
    const beforeTags = [...(record.task.tags ?? [])];
    const nextTags = (record.task.tags ?? []).filter(
      (tag) => String(tag).toLowerCase() !== tagToDelete.toLowerCase()
    );
    const changed = nextTags.length !== (record.task.tags ?? []).length;
    if (!changed) continue;

    const updatedTask = normalizeTask({
      ...record.task,
      tags: nextTags,
      updatedAt: new Date().toISOString(),
    });
    await writeTask(updatedTask, record.fileName);
    await appendLogEntry("tag_removed_from_task", {
      tag: tagToDelete,
      taskId: updatedTask.id,
      title: updatedTask.title,
      beforeTags,
      afterTags: updatedTask.tags,
    });
    changedCount += 1;
  }

  if (changedCount > 0) {
    await appendLogEntry("tag_deleted_everywhere", {
      tag: tagToDelete,
      changedCount,
    });
  }

  const nextRecords = await getTaskRecords();
  sendJson(res, 200, {
    deletedTag: tagToDelete,
    changedCount,
    tasks: nextRecords.map((record) => record.task),
  });
}

async function handleReorderTasks(req, res) {
  const body = await readRequestBody(req);
  if (!Array.isArray(body.taskIds)) {
    sendJson(res, 400, { error: "taskIds must be an array." });
    return;
  }

  const records = await getTaskRecords();
  const byId = new Map(records.map((record) => [record.task.id, record]));

  const incomingIds = body.taskIds.filter((value) => typeof value === "string");
  const seen = new Set();
  const orderedIds = [];

  for (const id of incomingIds) {
    if (!byId.has(id) || seen.has(id)) continue;
    seen.add(id);
    orderedIds.push(id);
  }

  for (const record of records) {
    if (!seen.has(record.task.id)) {
      orderedIds.push(record.task.id);
    }
  }

  for (let index = 0; index < orderedIds.length; index += 1) {
    const id = orderedIds[index];
    const record = byId.get(id);
    if (!record) continue;
    const updatedTask = {
      ...record.task,
      order: index,
      updatedAt: new Date().toISOString(),
    };
    const saved = await writeTask(updatedTask, record.fileName);
    byId.set(id, saved);
  }

  const nextRecords = await getTaskRecords();
  sendJson(res, 200, { tasks: nextRecords.map((record) => record.task) });
}

function matchTaskRoute(urlPathname) {
  if (urlPathname === "/api/tasks") return { type: "collection" };
  if (urlPathname === "/api/logbook") return { type: "logbook" };
  if (urlPathname === "/api/tasks/completed") return { type: "completed" };
  if (urlPathname === "/api/tasks/reorder") return { type: "reorder" };
  if (urlPathname === "/api/tags/delete") return { type: "delete-tag" };
  const match = urlPathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (!match) return null;
  return { type: "item", taskId: decodeURIComponent(match[1]) };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    const route = matchTaskRoute(url.pathname);
    if (!route) {
      sendJson(res, 404, { error: "Not found." });
      return;
    }

    if (route.type === "collection") {
      if (req.method === "GET") return void (await handleListTasks(req, res));
      if (req.method === "POST") return void (await handleCreateTask(req, res));
    }

    if (route.type === "logbook") {
      if (req.method === "GET") return void (await handleListLogbook(req, res));
      if (req.method === "DELETE") return void (await handleClearLogbook(req, res));
    }

    if (route.type === "completed") {
      if (req.method === "DELETE") return void (await handleDeleteCompletedTasks(req, res));
    }

    if (route.type === "reorder") {
      if (req.method === "POST") return void (await handleReorderTasks(req, res));
    }

    if (route.type === "delete-tag") {
      if (req.method === "POST") return void (await handleDeleteTagEverywhere(req, res));
    }

    if (route.type === "item") {
      if (req.method === "PUT") return void (await handleUpdateTask(req, res, route.taskId));
      if (req.method === "DELETE") return void (await handleDeleteTask(req, res, route.taskId));
    }

    sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error?.message || "Internal server error." });
  }
});

async function start() {
  await ensureTasksDir();
  await ensureLogbookStorage();
  try {
    await stat(TASKS_DIR);
  } catch {
    await mkdir(TASKS_DIR, { recursive: true });
  }

  server.listen(PORT, () => {
    console.log(`Markdown task API listening on http://localhost:${PORT}`);
    console.log(`Tasks directory: ${TASKS_DIR}`);
  });
}

start();
