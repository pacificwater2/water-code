import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

function createSessionId() {
  return `wc-${randomUUID()}`;
}

function clampMessage(text, maxLength = 160) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength - 3)}...`;
}

export function isValidSessionId(sessionId) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(sessionId || ""));
}

export class SessionStore {
  constructor(baseDir) {
    this.baseDir = baseDir;
  }

  async loadOrCreate(sessionId) {
    await mkdir(this.baseDir, { recursive: true });

    if (!sessionId) {
      return {
        id: createSessionId(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: []
      };
    }

    this.#assertSessionId(sessionId);

    try {
      const payload = await readFile(this.#filePath(sessionId), "utf8");
      return JSON.parse(payload);
    } catch {
      return {
        id: sessionId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: []
      };
    }
  }

  async save(session) {
    await mkdir(this.baseDir, { recursive: true });
    this.#assertSessionId(session.id);
    const payload = {
      ...session,
      updatedAt: new Date().toISOString()
    };
    await writeFile(this.#filePath(session.id), JSON.stringify(payload, null, 2), "utf8");
  }

  async create() {
    const session = await this.loadOrCreate("");
    await this.save(session);
    return session;
  }

  async ensure(sessionId) {
    const session = await this.loadOrCreate(sessionId);
    await this.save(session);
    return session;
  }

  async get(sessionId, { messages = 50 } = {}) {
    if (!sessionId) {
      return null;
    }

    this.#assertSessionId(sessionId);

    try {
      const payload = JSON.parse(await readFile(this.#filePath(sessionId), "utf8"));
      const allMessages = Array.isArray(payload.messages) ? payload.messages : [];
      const messageLimit =
        Number.isInteger(messages) && messages >= 0 ? messages : allMessages.length;

      return {
        ...payload,
        messages: allMessages.slice(-messageLimit)
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async list(limit = 20) {
    await mkdir(this.baseDir, { recursive: true });

    const entries = await readdir(this.baseDir, { withFileTypes: true });
    const sessions = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      try {
        const payload = JSON.parse(await readFile(path.join(this.baseDir, entry.name), "utf8"));
        sessions.push(this.#summarize(payload));
      } catch {
        continue;
      }
    }

    sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return sessions.slice(0, Math.max(0, Number(limit) || 0));
  }

  #filePath(sessionId) {
    this.#assertSessionId(sessionId);
    return path.join(this.baseDir, `${sessionId}.json`);
  }

  #assertSessionId(sessionId) {
    if (!isValidSessionId(sessionId)) {
      throw new Error(`Invalid session id: ${sessionId}`);
    }
  }

  #summarize(session) {
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const lastMessage = messages[messages.length - 1] || null;

    return {
      id: String(session.id || ""),
      createdAt: session.createdAt || "",
      updatedAt: session.updatedAt || session.createdAt || "",
      messageCount: messages.length,
      lastRole: lastMessage?.role || "",
      lastMessage: clampMessage(lastMessage?.content || "")
    };
  }
}
