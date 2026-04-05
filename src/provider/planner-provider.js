import {
  createAssistantResponse,
  createToolCallResponse
} from "../core/protocol.js";

function stripQuotes(value) {
  return value.replace(/^['"]|['"]$/g, "").trim();
}

function extractPathFromRead(prompt) {
  const match = prompt.match(/(?:read|open|show)(?:\s+file)?\s+(.+)$/i);
  return match ? stripQuotes(match[1]) : "";
}

function extractPathFromList(prompt) {
  const match = prompt.match(/(?:list files|show files|ls)(?:\s+in)?\s+(.+)$/i);
  if (!match) {
    return ".";
  }

  return stripQuotes(match[1].replace(/\s+depth\s+\d+\s*$/i, ""));
}

function extractDepth(prompt) {
  const match = prompt.match(/\bdepth\s+(\d+)\b/i);
  return match ? Number(match[1]) : 2;
}

function extractWriteInstruction(prompt) {
  const match = prompt.match(
    /(?:write|create)(?:\s+file)?\s+([^\s]+)\s+:::\s+([\s\S]+)$/i
  );

  if (!match) {
    return null;
  }

  return {
    path: stripQuotes(match[1]),
    content: match[2]
  };
}

function extractDiffInstruction(prompt) {
  const match = prompt.match(/(?:diff|preview diff)\s+([^\s]+)\s+:::\s+([\s\S]+)$/i);

  if (!match) {
    return null;
  }

  return {
    path: stripQuotes(match[1]),
    content: match[2]
  };
}

function extractPatchInstruction(prompt) {
  const match = prompt.match(
    /(?:patch|replace)\s+([^\s]+)(?:\s+--all)?\s+:::\s+([\s\S]+?)\s+>>>\s+([\s\S]*)$/i
  );

  if (!match) {
    return null;
  }

  return {
    path: stripQuotes(match[1]),
    oldText: match[2].trim(),
    newText: match[3].trim(),
    replaceAll: /\s--all\s/i.test(prompt)
  };
}

function extractShellCommand(prompt) {
  const match = prompt.match(/(?:run|bash|shell)\s+([\s\S]+)$/i);
  return match ? match[1].trim() : "";
}

function extractBackgroundTaskPrompt(prompt) {
  const marker = ":::";
  const markerIndex = prompt.indexOf(marker);
  if (markerIndex !== -1) {
    return prompt.slice(markerIndex + marker.length).trim();
  }

  const match = prompt.match(
    /(?:start|launch|queue|run)(?:\s+a)?\s+background task(?:\s+\w+)?\s+(?:to\s+)?([\s\S]+)$/i
  );
  return match ? match[1].trim() : "";
}

function extractBackgroundTaskId(prompt) {
  const match = prompt.match(/\b(wctask-[a-z0-9-]+)\b/i);
  return match ? match[1] : "";
}

export class PlannerProvider {
  constructor() {
    this.name = "planner";
  }

  async generate({ messages, tools }) {
    const last = messages[messages.length - 1];

    if (!last) {
      return createAssistantResponse("No input received.");
    }

    if (last.role === "tool") {
      return createAssistantResponse(`Tool result received:\n\n${last.content}`);
    }

    const prompt = last.content.trim();
    const lowered = prompt.toLowerCase();

    if (
      lowered === "git status" ||
      lowered === "status" ||
      lowered.startsWith("show git status") ||
      lowered.startsWith("inspect git status")
    ) {
      return createToolCallResponse(
        "git_status",
        {},
        "Inspect the current Git branch and working tree"
      );
    }

    if (
      lowered === "git worktrees" ||
      lowered === "worktrees" ||
      lowered.startsWith("show git worktrees") ||
      lowered.startsWith("list git worktrees")
    ) {
      return createToolCallResponse(
        "git_worktrees",
        {},
        "Inspect known Git worktrees"
      );
    }

    if (
      lowered.startsWith("list background tasks") ||
      lowered.startsWith("show background tasks") ||
      lowered === "background tasks" ||
      lowered === "tasks"
    ) {
      return createToolCallResponse(
        "list_background_tasks",
        {
          limit: 20
        },
        "Inspect background task queue"
      );
    }

    if (
      lowered.startsWith("show background task") ||
      lowered.startsWith("background task ") ||
      lowered.startsWith("task status ")
    ) {
      const taskId = extractBackgroundTaskId(prompt);
      if (taskId) {
        return createToolCallResponse(
          "get_background_task",
          {
            taskId,
            lines: 40
          },
          "Inspect a background task"
        );
      }
    }

    if (
      lowered.startsWith("cancel background task") ||
      lowered.startsWith("stop background task")
    ) {
      const taskId = extractBackgroundTaskId(prompt);
      if (taskId) {
        return createToolCallResponse(
          "cancel_background_task",
          {
            taskId
          },
          "Cancel a background task"
        );
      }
    }

    if (
      lowered.startsWith("start background task") ||
      lowered.startsWith("launch background task") ||
      lowered.startsWith("queue background task") ||
      lowered.startsWith("run in background")
    ) {
      const taskPrompt = extractBackgroundTaskPrompt(prompt);

      if (!taskPrompt) {
        return createAssistantResponse(
          "Use syntax like: start background task ::: read README.md"
        );
      }

      return createToolCallResponse(
        "start_background_task",
        {
          prompt: taskPrompt
        },
        "Start a detached background task"
      );
    }

    if (
      lowered.startsWith("list files") ||
      lowered.startsWith("show files") ||
      lowered.startsWith("ls ")
    ) {
      return createToolCallResponse(
        "list_files",
        {
          path: extractPathFromList(prompt),
          depth: extractDepth(prompt)
        },
        "Inspect the repository tree"
      );
    }

    if (
      lowered.startsWith("read ") ||
      lowered.startsWith("open ") ||
      lowered.startsWith("show ")
    ) {
      return createToolCallResponse(
        "read_file",
        {
          path: extractPathFromRead(prompt),
          start: 1,
          lines: 200
        },
        "Read a requested file"
      );
    }

    if (lowered.startsWith("write ") || lowered.startsWith("create ")) {
      const writeInstruction = extractWriteInstruction(prompt);

      if (!writeInstruction) {
        return createAssistantResponse(
          "Use write syntax like: write notes.txt ::: your content here"
        );
      }

      return createToolCallResponse("write_file", writeInstruction, "Write requested content");
    }

    if (lowered.startsWith("diff ") || lowered.startsWith("preview diff ")) {
      const diffInstruction = extractDiffInstruction(prompt);

      if (!diffInstruction) {
        return createAssistantResponse(
          "Use diff syntax like: diff README.md ::: replacement content"
        );
      }

      return createToolCallResponse(
        "preview_diff",
        diffInstruction,
        "Preview file changes before writing"
      );
    }

    if (lowered.startsWith("patch ") || lowered.startsWith("replace ")) {
      const patchInstruction = extractPatchInstruction(prompt);

      if (!patchInstruction) {
        return createAssistantResponse(
          "Use patch syntax like: patch README.md ::: old text >>> new text"
        );
      }

      return createToolCallResponse(
        "patch_file",
        patchInstruction,
        "Apply an exact text replacement patch"
      );
    }

    if (
      lowered.startsWith("run ") ||
      lowered.startsWith("bash ") ||
      lowered.startsWith("shell ")
    ) {
      return createToolCallResponse(
        "bash",
        {
          command: extractShellCommand(prompt),
          timeoutMs: 10000
        },
        "Run a shell command"
      );
    }

    return createAssistantResponse(
        `I can already inspect and modify a project through a small agent loop.\n\n` +
        `Use /context if you want the current project snapshot directly.\n\n` +
        `Try prompts like:\n` +
        `- list files in src\n` +
        `- read README.md\n` +
        `- list background tasks\n` +
        `- start background task ::: read README.md\n` +
        `- diff README.md ::: updated content\n` +
        `- patch README.md ::: old text >>> new text\n` +
        `- run pwd\n` +
        `- write notes/todo.txt ::: first draft\n\n` +
        `Available tools:\n` +
        tools.map(tool => `- ${tool.name}`).join("\n")
    );
  }
}
