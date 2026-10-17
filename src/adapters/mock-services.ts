import type { AuditAdapter, AuditEvent, KnowledgeAdapter, ModelAdapter } from "./types";
import { askAssistant, getKnowledgeNoteFn, searchKnowledgeFn, submitDebrief } from "@/lib/assistant.functions";

export const serverKnowledge: KnowledgeAdapter = {
  search: (query) => searchKnowledgeFn({ data: { query } }),
  get: (id) => getKnowledgeNoteFn({ data: { id } }),
  contribute: (d) => submitDebrief({ data: d }),
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
