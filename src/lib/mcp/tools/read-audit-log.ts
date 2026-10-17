import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseAnon } from "../supabase";

export default defineTool({
  name: "read_audit_log",
  title: "Read the audit log",
  description: "Read recent assistant audit entries (questions, proposals, approvals, outputs, interpretations), newest first, optionally filtered.",
  inputSchema: {
    search: z.string().max(200).optional().describe("Text to match in question, command, output, interpretation or detail."),
    event_type: z.string().max(40).optional().describe("Event type, e.g. question, proposed, approved, rejected, output, interpretation."),
    limit: z.number().int().min(1).max(100).optional().describe("Max entries (default 25)."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ search, event_type, limit }) => {
    let q = supabaseAnon().from("audit_log")
      .select("created_at, session_id, actor, event_type, question, command, risk, output, interpretation, detail")
      .order("created_at", { ascending: false }).limit(300);
    if (event_type) q = q.eq("event_type", event_type);
    const { data, error } = await q;
    if (error) throw new ToolError(`Audit log read failed: ${error.message}`);
    const needle = search?.trim().toLowerCase();
    const entries = (data ?? [])
      .filter((r) => !needle || [r.question, r.command, r.output, r.interpretation, r.detail].some((v) => v?.toLowerCase().includes(needle)))
      .slice(0, limit ?? 25)
      .map((r) => ({
        created_at: r.created_at, session_id: r.session_id, actor: r.actor, event_type: r.event_type,
        command: r.command ?? "", risk: r.risk ?? "",
        text: (r.question ?? r.interpretation ?? r.output ?? r.detail ?? "").slice(0, 500),
      }));
    return {
      content: [{ type: "text", text: entries.length ? entries.map((e) => `${e.created_at} ${e.actor} ${e.event_type}${e.command ? ` ${e.command}` : ""}${e.risk ? ` [${e.risk}]` : ""} — ${e.text.slice(0, 160)}`).join("\n") : "No matching entries." }],
      structuredContent: { entries },
    };
  },
});
