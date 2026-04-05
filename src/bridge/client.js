function normalizeBaseUrl(rawUrl) {
  const value = String(rawUrl || "").trim();

  if (!value) {
    throw new Error("Bridge client requires a remote URL");
  }

  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error(`Unsupported bridge protocol: ${url.protocol}`);
  }

  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = basePath ? `${basePath}/` : "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function createAbortError(method, pathname, kind, timeoutMs) {
  return new Error(`${method} ${pathname} timed out (${kind}) after ${timeoutMs}ms`);
}

function createBridgeError(method, pathname, response, payload) {
  const detail = payload?.error || payload?.message || response.statusText || "Unknown bridge error";
  return new Error(`${method} ${pathname} failed: ${response.status} ${detail}`);
}

async function* parseEventStream(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  function parseChunk(chunk) {
    const lines = chunk.split(/\r?\n/);
    const dataLines = [];

    for (const line of lines) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (dataLines.length === 0) {
      return null;
    }

    return JSON.parse(dataLines.join("\n"));
  }

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), {
      stream: !done
    });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const payload = parseChunk(chunk);

      if (payload) {
        yield payload;
      }

      boundary = buffer.indexOf("\n\n");
    }

    if (done) {
      const trailing = parseChunk(buffer.trim());
      if (trailing) {
        yield trailing;
      }
      break;
    }
  }
}

export function createBridgeClient(rawUrl, options = {}) {
  const baseUrl = normalizeBaseUrl(rawUrl);
  const requestTimeoutMs = Math.max(10, Number(options.requestTimeoutMs) || 30_000);
  const streamIdleTimeoutMs = Math.max(10, Number(options.streamIdleTimeoutMs) || 20_000);
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    throw new Error("Bridge client requires a fetch implementation");
  }

  async function request(pathname, { method = "GET", body } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(createAbortError(method, pathname, "request", requestTimeoutMs));
    }, requestTimeoutMs);

    let response;
    try {
      response = await fetchImpl(new URL(pathname.replace(/^\//, ""), baseUrl), {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timeout);
      if (controller.signal.aborted) {
        throw controller.signal.reason || createAbortError(method, pathname, "request", requestTimeoutMs);
      }
      throw error;
    }

    clearTimeout(timeout);

    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};

    if (!response.ok || payload.ok === false) {
      throw createBridgeError(method, pathname, response, payload);
    }

    return payload;
  }

  async function requestStream(pathname, { body } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(createAbortError("POST", pathname, "request", requestTimeoutMs));
    }, requestTimeoutMs);

    let response;
    try {
      response = await fetchImpl(new URL(pathname.replace(/^\//, ""), baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body || {}),
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timeout);
      if (controller.signal.aborted) {
        throw controller.signal.reason || createAbortError("POST", pathname, "request", requestTimeoutMs);
      }
      throw error;
    }

    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      throw createBridgeError("POST", pathname, response, payload);
    }

    if (!response.body) {
      throw new Error(`POST ${pathname} did not return a readable stream`);
    }

    const iterator = parseEventStream(response.body)[Symbol.asyncIterator]();

    return (async function* guardedStream() {
      while (true) {
        const next = iterator.next();
        const result = await Promise.race([
          next,
          new Promise((_, reject) => {
            const idle = setTimeout(() => {
              if (typeof response.body.cancel === "function") {
                response.body.cancel().catch(() => {});
              }
              reject(createAbortError("POST", pathname, "stream idle", streamIdleTimeoutMs));
            }, streamIdleTimeoutMs);

            next.finally(() => {
              clearTimeout(idle);
            });
          })
        ]);

        if (result.done) {
          return;
        }

        yield result.value;
      }
    })();
  }

  return {
    baseUrl,
    requestTimeoutMs,
    streamIdleTimeoutMs,
    async health() {
      return request("/health");
    },
    async state() {
      return request("/state");
    },
    async project() {
      const payload = await request("/project");
      return payload.project;
    },
    async switchProject(cwd) {
      return request("/project", {
        method: "POST",
        body: {
          cwd
        }
      });
    },
    async useWorktree(worktree) {
      return request("/project", {
        method: "POST",
        body: {
          worktree
        }
      });
    },
    async doctor() {
      const payload = await request("/doctor");
      return payload.report;
    },
    async git() {
      const payload = await request("/git");
      return payload.git;
    },
    async worktrees() {
      const payload = await request("/worktrees");
      return payload.worktrees;
    },
    async onboard() {
      const payload = await request("/onboard");
      return payload.report;
    },
    async sessions(limit = 20) {
      return request(`/sessions?limit=${Math.max(1, Number(limit) || 20)}`);
    },
    async getSession(sessionId, options = {}) {
      const messages = Math.max(1, Number(options.messages) || 50);
      return request(
        `/sessions/${encodeURIComponent(String(sessionId || "").trim())}?messages=${messages}`
      );
    },
    async createSession() {
      return request("/sessions", {
        method: "POST",
        body: {
          create: true
        }
      });
    },
    async setSession(sessionId) {
      return request("/sessions", {
        method: "POST",
        body: {
          sessionId
        }
      });
    },
    async clearSession() {
      return request("/sessions", {
        method: "POST",
        body: {
          clear: true
        }
      });
    },
    async init(options = {}) {
      const payload = await request("/init", {
        method: "POST",
        body: {
          force: options.force === true
        }
      });
      return payload.report;
    },
    async prompt(prompt, options = {}) {
      const payload = await request("/prompt", {
        method: "POST",
        body: {
          prompt,
          sessionId: options.sessionId || "",
          activate: options.activate !== false
        }
      });
      return payload;
    },
    promptStream(prompt, options = {}) {
      return requestStream("/prompt/stream", {
        body: {
          prompt,
          sessionId: options.sessionId || "",
          activate: options.activate !== false
        }
      });
    },
    async command(command) {
      return request("/command", {
        method: "POST",
        body: {
          command
        }
      });
    }
  };
}
