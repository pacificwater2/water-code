import assert from "node:assert/strict";
import test from "node:test";
import { createBridgeClient } from "../src/bridge/client.js";

test("bridge client calls project, doctor, git, worktrees, and prompt endpoints", async t => {
  const calls = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      options
    });

    if (String(url).endsWith("/doctor")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async text() {
          return JSON.stringify({
            ok: true,
            report: {
              provider: "planner"
            }
          });
        }
      };
    }

    if (String(url).includes("/sessions?limit=")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async text() {
          return JSON.stringify({
            ok: true,
            activeSessionId: "wc-session-1",
            sessions: [{ id: "wc-session-1" }]
          });
        }
      };
    }

    if (String(url).includes("/sessions/wc-session-1?messages=10")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async text() {
          return JSON.stringify({
            ok: true,
            activeSessionId: "wc-session-1",
            session: {
              id: "wc-session-1",
              messages: [{ role: "user", content: "hello" }]
            }
          });
        }
      };
    }

    if (String(url).endsWith("/sessions") && options.method === "POST") {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async text() {
          return JSON.stringify({
            ok: true,
            activeSessionId: "wc-session-1",
            session: {
              id: "wc-session-1",
              messages: []
            }
          });
        }
      };
    }

    if (String(url).endsWith("/project") && (!options.method || options.method === "GET")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async text() {
          return JSON.stringify({
            ok: true,
            project: {
              cwd: "/tmp/project"
            }
          });
        }
      };
    }

    if (String(url).endsWith("/project") && options.method === "POST") {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async text() {
          return JSON.stringify({
            ok: true,
            report: {
              toCwd: "/tmp/next-project"
            },
            state: {
              cwd: "/tmp/next-project"
            }
          });
        }
      };
    }

    if (String(url).endsWith("/git")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async text() {
          return JSON.stringify({
            ok: true,
            git: {
              branch: "main"
            }
          });
        }
      };
    }

    if (String(url).endsWith("/worktrees")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async text() {
          return JSON.stringify({
            ok: true,
            worktrees: [
              {
                path: "/tmp/project"
              }
            ]
          });
        }
      };
    }

    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async text() {
        return JSON.stringify({
          ok: true,
          sessionId: "wc-session-1",
          output: "prompt:read README.md"
        });
      }
    };
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = createBridgeClient("http://127.0.0.1:8765");
  const project = await client.project();
  const switched = await client.switchProject("/tmp/next-project");
  const doctor = await client.doctor();
  const git = await client.git();
  const worktrees = await client.worktrees();
  const sessions = await client.sessions(10);
  const session = await client.getSession("wc-session-1", {
    messages: 10
  });
  const createdSession = await client.createSession();
  const selectedSession = await client.setSession("wc-session-1");
  const clearedSession = await client.clearSession();
  const prompt = await client.prompt("read README.md", {
    sessionId: "wc-session-1"
  });

  assert.equal(project.cwd, "/tmp/project");
  assert.equal(switched.report.toCwd, "/tmp/next-project");
  assert.equal(doctor.provider, "planner");
  assert.equal(git.branch, "main");
  assert.equal(worktrees[0].path, "/tmp/project");
  assert.equal(sessions.sessions[0].id, "wc-session-1");
  assert.equal(session.session.id, "wc-session-1");
  assert.equal(createdSession.session.id, "wc-session-1");
  assert.equal(selectedSession.session.id, "wc-session-1");
  assert.equal(clearedSession.session.id, "wc-session-1");
  assert.equal(prompt.output, "prompt:read README.md");
  assert.equal(calls[0].url, "http://127.0.0.1:8765/project");
  assert.equal(calls[1].url, "http://127.0.0.1:8765/project");
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[2].url, "http://127.0.0.1:8765/doctor");
  assert.equal(calls[3].url, "http://127.0.0.1:8765/git");
  assert.equal(calls[4].url, "http://127.0.0.1:8765/worktrees");
  assert.match(calls[5].url, /\/sessions\?limit=10$/);
  assert.match(calls[6].url, /\/sessions\/wc-session-1\?messages=10$/);
  assert.equal(calls[7].url, "http://127.0.0.1:8765/sessions");
  assert.equal(calls[8].url, "http://127.0.0.1:8765/sessions");
  assert.equal(calls[9].url, "http://127.0.0.1:8765/sessions");
  assert.equal(calls[10].url, "http://127.0.0.1:8765/prompt");
  assert.equal(calls[10].options.method, "POST");
  assert.match(String(calls[10].options.body), /wc-session-1/);
});

test("bridge client surfaces API errors", async t => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    return {
      ok: false,
      status: 404,
      statusText: "Not Found",
      async text() {
        return JSON.stringify({
          ok: false,
          error: "Unknown route"
        });
      }
    };
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = createBridgeClient("http://127.0.0.1:8765");
  await assert.rejects(async () => {
    await client.state();
  }, /GET \/state failed: 404 Unknown route/);
});

test("bridge client parses prompt stream events", async t => {
  const encoder = new TextEncoder();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              [
                "event: water-code",
                'data: {"type":"stream.started"}',
                "",
                "event: water-code",
                'data: {"type":"tool.call","toolCall":{"name":"read_file"}}',
                "",
                "event: water-code",
                'data: {"type":"completed","output":"done"}',
                "",
                "event: water-code",
                'data: {"type":"stream.finished"}',
                "",
              ].join("\n")
            )
          );
          controller.close();
        }
      })
    };
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = createBridgeClient("http://127.0.0.1:8765");
  const events = [];

  for await (const event of await client.promptStream("read README.md")) {
    events.push(event.type);
  }

  assert.deepEqual(events, ["stream.started", "tool.call", "completed", "stream.finished"]);
});

test("bridge client aborts timed-out requests and idle streams", async t => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (_url, options = {}) => {
    if (!options.method || options.method === "GET") {
      await new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
          reject(options.signal.reason);
        });
      });
    }

    return {
      ok: true,
      status: 200,
      statusText: "OK",
      body: new ReadableStream({
        start() {}
      })
    };
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = createBridgeClient("http://127.0.0.1:8765", {
    requestTimeoutMs: 5,
    streamIdleTimeoutMs: 5
  });

  await assert.rejects(async () => {
    await client.state();
  }, /timed out \(request\)/);

  await assert.rejects(async () => {
    for await (const _event of await client.promptStream("read README.md")) {
      break;
    }
  }, /timed out \(stream idle\)/);
});
