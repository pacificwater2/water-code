function createMessage(role, content, extra = {}) {
  return {
    role,
    content,
    createdAt: new Date().toISOString(),
    ...extra
  };
}

function formatToolResult(result) {
  return result.rendered || result.content || (result.ok ? "OK" : "ERROR");
}

async function emitEvent(onEvent, event) {
  if (typeof onEvent !== "function") {
    return;
  }

  await onEvent({
    createdAt: new Date().toISOString(),
    ...event
  });
}

export class AgentLoop {
  constructor({
    provider,
    tools,
    sessionStore,
    cwd,
    systemPrompt,
    maxTurns,
    permissionMode
  }) {
    this.provider = provider;
    this.tools = tools;
    this.sessionStore = sessionStore;
    this.cwd = cwd;
    this.systemPrompt = systemPrompt;
    this.maxTurns = maxTurns;
    this.permissionMode = permissionMode;
    this.confirmToolCall = null;
    this.getToolContext = null;
  }

  setConfirmToolCall(confirmToolCall) {
    this.confirmToolCall = confirmToolCall;
  }

  setSystemPrompt(systemPrompt) {
    this.systemPrompt = systemPrompt;
  }

  setCwd(cwd) {
    this.cwd = cwd;
  }

  setSessionStore(sessionStore) {
    this.sessionStore = sessionStore;
  }

  setPermissionMode(permissionMode) {
    this.permissionMode = permissionMode;
  }

  setToolContextProvider(getToolContext) {
    this.getToolContext = getToolContext;
  }

  async run(prompt, { sessionId, onEvent } = {}) {
    const session = await this.sessionStore.loadOrCreate(sessionId);
    const messages = [...session.messages, createMessage("user", prompt)];

    await this.sessionStore.save({
      ...session,
      messages
    });
    await emitEvent(onEvent, {
      type: "session.started",
      sessionId: session.id,
      prompt
    });

    for (let turn = 1; turn <= this.maxTurns; turn += 1) {
      await emitEvent(onEvent, {
        type: "turn.started",
        sessionId: session.id,
        turn
      });

      const response = await this.provider.generate({
        cwd: this.cwd,
        systemPrompt: this.systemPrompt,
        tools: this.tools.describe(),
        messages
      });

      if (response.type === "assistant") {
        messages.push(createMessage("assistant", response.message));
        await this.sessionStore.save({
          ...session,
          messages
        });
        await emitEvent(onEvent, {
          type: "assistant.message",
          sessionId: session.id,
          turn,
          message: response.message
        });
        return {
          sessionId: session.id,
          output: response.message,
          turns: turn
        };
      }

      if (response.type === "tool_call") {
        const { toolCall } = response;
        messages.push(
          createMessage(
            "assistant", 
            `Tool call: ${toolCall.name}${toolCall.reason ? ` (${toolCall.reason})` : ""}`,
            {
              toolCall: {
                id: toolCall.id,
                name: toolCall.name,
                input: toolCall.input,
                reason: toolCall.reason
              }
            }
          )
        );
        await emitEvent(onEvent, {
          type: "tool.call",
          sessionId: session.id,
          turn,
          toolCall: {
            id: toolCall.id,
            name: toolCall.name,
            input: toolCall.input,
            reason: toolCall.reason || ""
          }
        });

        const extraToolContext =
          typeof this.getToolContext === "function" ? this.getToolContext() || {} : {};

        const result = await this.tools.execute(toolCall.name, toolCall.input, {
          cwd: this.cwd,
          permissionMode: this.permissionMode,
          confirmToolCall: this.confirmToolCall,
          ...extraToolContext
        });

        messages.push(
          createMessage("tool", formatToolResult(result), {
            name: toolCall.name,
            toolCallId: toolCall.id,
            toolResult: {
              ok: result.ok,
              title: result.title,
              summary: result.summary,
              sections: result.sections,
              data: result.data
            }
          })
        );
        await emitEvent(onEvent, {
          type: "tool.result",
          sessionId: session.id,
          turn,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result: {
            ok: result.ok,
            title: result.title,
            summary: result.summary,
            rendered: formatToolResult(result),
            data: result.data
          }
        });

        await this.sessionStore.save({
          ...session,
          messages
        });
        continue;
      }

      throw new Error(`Unknown provider response type: ${response.type}`);
    }

    const fallback = `Reached max turns (${this.maxTurns}) before a final answer.`;
    messages.push(createMessage("assistant", fallback));
    await this.sessionStore.save({
      ...session,
      messages
    });
    await emitEvent(onEvent, {
      type: "assistant.message",
      sessionId: session.id,
      turn: this.maxTurns,
      message: fallback
    });

    return {
      sessionId: session.id,
      output: fallback,
      turns: this.maxTurns
    };
  }
}
