import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { runAssistant } from "@/assistant/assistant.server";
import { addExpertNote, allNotes, getNote, searchKnowledge } from "@/knowledge/notes.server";
import { matchingPlaybooks } from "@/playbooks/playbooks.server";
import { executedOptionIds, optionGates } from "@/mock-env/engine.server";
import type { SystemState } from "@/adapters/types";

// "assistant" backend function. Proposes only; never executes.
export const askAssistant = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ question: z.string().trim().min(1).max(1000), state: z.unknown() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { hits, ids } = await searchKnowledge(data.question);
    // Approved playbooks whose triggers match the current state (drafts never used).
    const st = data.state as { state?: SystemState } | undefined;
    const sys = st?.state;
    const playbooks = sys && Array.isArray(sys.cpus) ? await matchingPlaybooks(sys) : [];
    const pb = { playbooks, catalog: optionGates(), executedIds: new Set(executedOptionIds()) };
    return runAssistant(data.question, data.state, hits, ids, undefined, pb);
  });

const snippet = (n: { id: string; title: string; body: string; source_type: string; contributed_by: string }) => ({
  id: n.id,
  title: n.title,
  snippet: `${n.body}\n— ${n.contributed_by} (${n.source_type})`,
});

export const searchKnowledgeFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ query: z.string().max(1000) }).parse(d))
  .handler(async ({ data }) => (await searchKnowledge(data.query)).hits.map(snippet));

export const getKnowledgeNoteFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().max(50) }).parse(d))
  .handler(async ({ data }) => {
    const n = await getNote(data.id);
    return n ? snippet(n) : null;
  });

export const submitDebrief = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        incident: z.string().trim().min(1).max(200),
        suspicion: z.string().trim().min(3).max(2000),
        checkedFirst: z.string().trim().min(3).max(2000),
        adviceNext: z.string().trim().min(3).max(2000),
        operator: z.string().trim().min(1).max(100),
      })
      .parse(d),
  )
  .handler(async ({ data }) =>
    addExpertNote({
      title: `Debrief: ${data.incident}`,
      symptoms: data.suspicion,
      cause: `Advice for the next operator: ${data.adviceNext}`,
      what_to_check_first: data.checkedFirst,
      contributed_by: `${data.operator} (operator debrief)`,
    }),
  );

// Read-only list of every knowledge note (the playbook the assistant retrieves from).
export const listKnowledgeFn = createServerFn({ method: "GET" }).handler(async () => allNotes());
