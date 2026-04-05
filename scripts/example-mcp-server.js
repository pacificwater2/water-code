import readline from "node:readline";
import process from "node:process";

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function reply(id, result) {
  send({
    jsonrpc: "2.0",
    id,
    result
  });
}

function replyError(id, message) {
  send({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32000,
      message
    }
  });
}

function listTools() {
  return [
    {
      name: "echo_note",
      description: "Echo a note back from the example MCP server.",
      inputSchema: {
        type: "object",
        properties: {
          note: {
            type: "string",
            description: "Text to echo."
          },
          uppercase: {
            type: "boolean",
            description: "Whether to uppercase the echoed note."
          }
        },
        required: ["note"]
      }
    }
  ];
}

function callTool(name, args) {
  if (name !== "echo_note") {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Unknown tool: ${name}`
        }
      ]
    };
  }

  const note = String(args?.note || "").trim();
  if (!note) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "echo_note requires a non-empty note"
        }
      ]
    };
  }

  const text = args?.uppercase ? note.toUpperCase() : note;
  return {
    content: [
      {
        type: "text",
        text: `Echo from local_echo: ${text}`
      }
    ]
  };
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

rl.on("line", line => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  let message = null;
  try {
    message = JSON.parse(trimmed);
  } catch (error) {
    return;
  }

  const { id, method, params } = message;

  if (method === "initialize") {
    reply(id, {
      protocolVersion: "2025-11-25",
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: "local_echo",
        version: "0.1.0"
      }
    });
    return;
  }

  if (method === "notifications/initialized") {
    return;
  }

  if (method === "tools/list") {
    reply(id, {
      tools: listTools()
    });
    return;
  }

  if (method === "tools/call") {
    reply(id, callTool(params?.name, params?.arguments || {}));
    return;
  }

  replyError(id, `Unsupported method: ${method}`);
});
