import { defineTool } from "@lovable.dev/mcp-js";
import { currentScenarioId, listScenarios } from "@/mock-env/engine.server";

export default defineTool({
  name: "list_scenarios",
  title: "List fault scenarios",
  description: "List the simulated fault scenarios and the public example default. Private browser session selection is not exposed.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: () => {
    const active = currentScenarioId();
    const scenarios = listScenarios().map((s) => ({ ...s, active: s.id === active }));
    return {
      content: [{ type: "text", text: scenarios.map((s) => `${s.active ? "* " : "  "}${s.id} — ${s.label}: ${s.title}`).join("\n") }],
      structuredContent: { scenarios },
    };
  },
});
