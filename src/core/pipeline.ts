import type { AuditAdapter, KnowledgeAdapter, ModelAdapter, ModelResponse } from "@/adapters/types";

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
}

// Core pipeline: talks to backends only via adapter interfaces.
export function createPipeline(a: Adapters) {
  return {
    async ask(question: string, host: HostBridge): Promise<ModelResponse> {
      a.audit.log({ actor: "operator", action: "question", detail: question });
      const ctx = host.getSessionContext();
      const knowledge = await a.knowledge.search(question);
      const res = await a.model.complete({
        question,
        context: JSON.stringify(ctx).slice(0, 4000),
        knowledge,
      });
      a.audit.log({ actor: "assistant", action: "response", detail: res.proposedCommand ?? "" });
      return res;
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
