import type { AuditAdapter, Classification, KnowledgeAdapter, ModelAdapter, ModelResponse, PolicyAdapter } from "@/adapters/types";

// The plugin <-> host contract. The panel sees nothing else of the host.
export interface SessionContext {
  recentOutput: string[];
  state: unknown;
}
export interface HostBridge {
  getSessionContext(): SessionContext;
  sendCommand(cmd: string): Promise<string[]>;
}

export interface Adapters {
  knowledge: KnowledgeAdapter;
  model: ModelAdapter;
  audit: AuditAdapter;
  policy: PolicyAdapter;
}

// Core pipeline: talks to backends only via adapter interfaces.
export function createPipeline(a: Adapters) {
  return {
    async ask(question: string, host: HostBridge): Promise<ModelResponse & { classification?: Classification }> {
      a.audit.log({ actor: "operator", action: "question", detail: question });
      const ctx = host.getSessionContext();
      const knowledge = await a.knowledge.search(question);
      const res = await a.model.complete({
        question,
        context: JSON.stringify(ctx).slice(0, 4000),
        knowledge,
      });
      a.audit.log({ actor: "assistant", action: "response", detail: res.proposedCommand ?? "" });
      if (!res.proposedCommand) return res;
      // Risk tier is looked up server-side; anything the model says about risk is ignored.
      const classification = await a.policy.classify(res.proposedCommand);
      if (!classification.allowed) {
        a.audit.log({ actor: "system", action: "blocked", detail: `${res.proposedCommand}: ${classification.reason}` });
        return { text: `${res.text}\n\nProposed command blocked: ${classification.reason}` };
      }
      return { ...res, classification };
    },
    async approveAndRun(cmd: string, host: HostBridge): Promise<{ output: string[]; interpretation: string }> {
      a.audit.log({ actor: "operator", action: "approved", detail: cmd });
      const output = await host.sendCommand(cmd);
      const res = await a.model.complete({ question: `interpret: ${cmd}`, context: output.join("\n"), knowledge: [] });
      a.audit.log({ actor: "assistant", action: "interpreted", detail: cmd });
      return { output, interpretation: res.text };
    },
    reject(cmd: string) {
      a.audit.log({ actor: "operator", action: "rejected", detail: cmd });
    },
  };
}
