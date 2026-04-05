import { createAssistantResponse } from "../core/protocol.js";

export class MockProvider {
  constructor() {
    this.name = "mock";
  }

  async generate({ tools }) {
    return createAssistantResponse(
      `Water Code mock provider is active.\n\n` +
        `Available tools:\n` +
        tools.map(tool => `- ${tool.name}: ${tool.description}`).join("\n")
    );
  }
}
