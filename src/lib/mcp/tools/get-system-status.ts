import { defineTool } from "@lovable.dev/mcp-js";
import { getState } from "@/mock-env/engine.server";

export default defineTool({
  name: "get_system_status",
  title: "Get simulated system status",
  description: "Return the public default simulated NonStop example: scenario, incident, alerts, CPU loads, throughput and response time. Private browser simulation sessions are not exposed by this tool.",
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: () => {
    const s = getState();
    const status = {
      node: s.node,
      scenario: s.scenario?.label ?? "",
      incident: { id: s.incident.id, title: s.incident.title, severity: s.incident.severity },
      alerts: s.incident.alerts.map((a) => ({ time: a.time, source: a.source, text: a.text, level: a.level })),
      cpus: s.cpus.map((c) => ({ id: c.id, busy: c.busy, status: c.status })),
      tps: s.tps,
      responseMs: s.responseMs,
    };
    const text = [
      `PUBLIC DEFAULT EXAMPLE (not a private browser session) · SIMULATED ${status.node} · ${status.scenario} · ${status.incident.id} ${status.incident.title} (${status.incident.severity})`,
      `TPS ${status.tps} · response ${status.responseMs} ms`,
      `CPUs: ${status.cpus.map((c) => `${c.id}:${c.status === "down" ? "DOWN" : `${c.busy}%`}`).join(" ")}`,
      ...status.alerts.map((a) => `[${a.level}] ${a.time} ${a.source}: ${a.text}`),
    ].join("\n");
    return { content: [{ type: "text", text }], structuredContent: { status } };
  },
});
