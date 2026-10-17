import type { AuditAdapter, AuditEvent, KnowledgeAdapter, ModelAdapter } from "./types";
import { askAssistant, searchKnowledgeFn } from "@/lib/assistant.functions";

export const serverKnowledge: KnowledgeAdapter = {
  search: (query) => searchKnowledgeFn({ data: { query } }),
};

export const serverModel: ModelAdapter = {
  complete: (req) => askAssistant({ data: { question: req.question, state: req.state } }),
};

const log: AuditEvent[] = [];
export const mockAudit: AuditAdapter = {
  log(e) {
    log.push({ ...e, at: new Date().toISOString().slice(11, 19) });
  },
  entries: () => [...log],
};
