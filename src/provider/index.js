import { AnthropicProvider } from "./anthropic-provider.js";
import { MockProvider } from "./mock-provider.js";
import { PlannerProvider } from "./planner-provider.js";

export function createProvider(requestedName = "auto") {
  const name = requestedName === "auto" ? chooseAutoProvider() : requestedName;

  if (name === "planner") {
    return new PlannerProvider();
  }

  if (name === "mock") {
    return new MockProvider();
  }

  if (name === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const model = process.env.WATER_CODE_ANTHROPIC_MODEL;

    if (!apiKey || !model) {
      throw new Error(
        "Anthropic provider requires ANTHROPIC_API_KEY and WATER_CODE_ANTHROPIC_MODEL"
      );
    }

    return new AnthropicProvider({
      apiKey,
      model
    });
  }

  throw new Error(`Unknown provider: ${requestedName}`);
}

function chooseAutoProvider() {
  if (process.env.ANTHROPIC_API_KEY && process.env.WATER_CODE_ANTHROPIC_MODEL) {
    return "anthropic";
  }

  return "planner";
}
