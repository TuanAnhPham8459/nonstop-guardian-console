import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { runAssistant } from "@/assistant/assistant.server";
import { KNOWLEDGE, searchKnowledge } from "@/knowledge/notes.server";

// "assistant" backend function. Proposes only; never executes.
export const askAssistant = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ question: z.string().trim().min(1).max(1000), state: z.unknown() }).parse(d),
  )
  .handler(async ({ data }) => {
    const notes = searchKnowledge(data.question);
    return runAssistant(data.question, data.state, notes);
  });

export const searchKnowledgeFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ query: z.string().max(1000) }).parse(d))
  .handler(async ({ data }) => searchKnowledge(data.query).map((n) => ({ id: n.id, title: n.title, snippet: n.body })));

export const getKnowledgeNoteFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().max(50) }).parse(d))
  .handler(async ({ data }) => {
    const n = KNOWLEDGE.find((k) => k.id === data.id);
    return n ? { id: n.id, title: n.title, snippet: n.body } : null;
  });
