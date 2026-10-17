import type { AuditAdapter, KnowledgeAdapter, ModelAdapter } from "./types";
import { readAudit, writeAudit } from "@/lib/audit.functions";
import { askAssistant, getKnowledgeNoteFn, searchKnowledgeFn, submitDebrief } from "@/lib/assistant.functions";

export const serverKnowledge: KnowledgeAdapter = {
  search: (query) => searchKnowledgeFn({ data: { query } }),
  get: (id) => getKnowledgeNoteFn({ data: { id } }),
  contribute: (d) => submitDebrief({ data: d }),
};

export const serverModel: ModelAdapter = {
  complete: (req) => askAssistant({ data: { question: req.question, state: req.state } }),
};

// Persists every step to the audit_log table.
const SESSION_ID = `S-${Date.now().toString(36).toUpperCase()}`;
export const dbAudit: AuditAdapter = {
  log(e) {
    void writeAudit({ data: { ...e, session_id: SESSION_ID } }).catch((err) => console.error("audit write failed", err));
  },
  list: () => readAudit(),
};
