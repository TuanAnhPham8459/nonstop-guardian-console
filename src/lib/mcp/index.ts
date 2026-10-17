import { defineMcp } from "@lovable.dev/mcp-js";
import getSystemStatus from "./tools/get-system-status";
import listScenarios from "./tools/list-scenarios";
import checkCommand from "./tools/check-command";
import searchKnowledge from "./tools/search-knowledge";
import readAuditLog from "./tools/read-audit-log";

export default defineMcp({
  name: "nonstop-guardian",
  title: "NonStop Guardian",
  version: "0.1.0",
  instructions:
    "Read-only tools for a SIMULATED HPE NonStop ops console (fictional data, no production access). Read system status and fault scenarios, check a command's allowlist risk tier, search the ops knowledge base, and read the audit log. Nothing here executes commands.",
  tools: [getSystemStatus, listScenarios, checkCommand, searchKnowledge, readAuditLog],
});
