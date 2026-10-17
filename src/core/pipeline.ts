import type { AuditAdapter, KnowledgeAdapter, ModelAdapter, ModelResponse, PolicyAdapter } from "@/adapters/types";

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
    async ask(question: string, host: HostBridge): Promise<ModelResponse> {
      a.audit.log({ actor: "operator", action: "question", detail: question });
      const res = await a.model.complete({ question, state: host.getSessionContext() });
      if (res.ok) {
        res.proposed_commands.forEach((c) => a.audit.log({ actor: "assistant", action: "proposed", detail: `${c.command} [${c.risk}]` }));
        res.blocked.forEach((b) => a.audit.log({ actor: "system", action: "blocked", detail: `${b.command}: ${b.reason}` }));
      } else a.audit.log({ actor: "system", action: "error", detail: res.error });
      return res;
    },
    async approveAndRun(cmd: string, host: HostBridge): Promise<{ output: string[]; interpretation: string }> {
      // Re-check the allowlist at execution time, independent of the model.
      const cls = await a.policy.classify(cmd);
      if (!cls.allowed) {
        a.audit.log({ actor: "system", action: "blocked", detail: `${cmd}: ${cls.reason}` });
        return { output: [], interpretation: `Blocked: ${cls.reason}` };
      }
      a.audit.log({ actor: "operator", action: "approved", detail: cmd });
      const output = await host.sendCommand(cmd);
      const res = await a.model.complete({
        question: `Interpret this output of "${cmd}" for the operator. Do not propose commands unless clearly needed.\n${output.join("\n")}`,
        state: host.getSessionContext(),
      });
      a.audit.log({ actor: "assistant", action: "interpreted", detail: cmd });
      return { output, interpretation: res.ok ? `${res.explanation}${res.uncertainty ? `\n\nUnsure: ${res.uncertainty}` : ""}` : res.error };
    },
    reject(cmd: string) {
      a.audit.log({ actor: "operator", action: "rejected", detail: cmd });
    },
  };
}
