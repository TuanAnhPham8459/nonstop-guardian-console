import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseAnon } from "../supabase";

export default defineTool({
  name: "search_knowledge",
  title: "Search the knowledge base",
  description: "Search the ops playbook notes (HPE docs, past incidents, expert debriefs) by keyword; empty query lists all.",
  inputSchema: {
    query: z.string().max(200).optional().describe("Keywords to match in title, symptoms, cause or first checks."),
    source_type: z.enum(["hpe-doc", "past-incident", "expert-note"]).optional().describe("Only return notes of this type."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, source_type }) => {
    let q = supabaseAnon().from("knowledge_notes")
      .select("id, title, symptoms, cause, what_to_check_first, contributed_by, source_type")
      .order("id").limit(200);
    if (source_type) q = q.eq("source_type", source_type);
    const { data, error } = await q;
    if (error) throw new ToolError(`Knowledge base read failed: ${error.message}`);
    const words = (query ?? "").toLowerCase().split(/[^a-z0-9$]+/).filter((w) => w.length > 2);
    const notes = (data ?? [])
      .map((n) => ({ n, score: words.reduce((s, w) => s + (`${n.title} ${n.symptoms} ${n.cause} ${n.what_to_check_first}`.toLowerCase().includes(w) ? 1 : 0), 0) }))
      .filter((x) => !words.length || x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map(({ n }) => ({ id: n.id, title: n.title, source_type: n.source_type, contributed_by: n.contributed_by, symptoms: n.symptoms, cause: n.cause, what_to_check_first: n.what_to_check_first }));
    return {
      content: [{ type: "text", text: notes.length ? notes.map((n) => `${n.id} [${n.source_type}] ${n.title}\n  Check first: ${n.what_to_check_first}`).join("\n") : "No matching notes." }],
      structuredContent: { notes },
    };
  },
});
