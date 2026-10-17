import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { validateCommand } from "@/mock-env/validate.server";

export default defineTool({
  name: "check_command",
  title: "Check a command against the allowlist",
  description: "Check whether a command is on the server allowlist and return its risk tier, description and blast radius. Does not run anything.",
  inputSchema: { command: z.string().min(1).max(200).describe("Command text, e.g. 'SCF STATUS CPU *'.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: ({ command }) => {
    const v = validateCommand(command);
    if (!v.ok) return { content: [{ type: "text", text: `Not allowed: ${v.reason}` }], structuredContent: { allowed: false, reason: v.reason } };
    const e = v.entry;
    const result = { allowed: true, pattern: e.pattern, risk: e.risk, description: e.description, blastRadius: e.blastRadius ?? "" };
    return {
      content: [{ type: "text", text: `${e.pattern} — ${e.risk}: ${e.description}${e.blastRadius ? `\nBlast radius: ${e.blastRadius}` : ""}` }],
      structuredContent: result,
    };
  },
});
