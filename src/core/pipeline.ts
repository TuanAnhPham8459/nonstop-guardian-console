import type { AuditAdapter, Classification, Debrief, KnowledgeAdapter, KnowledgeHit, ModelAdapter, ModelResponse, PolicyAdapter } from "@/adapters/types";

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

export const PROACTIVE_OPENER = "CPU 3 went down and load is shifting. Here is what I would check first.";

// Core pipeline: talks to backends only via adapter interfaces.
export function createPipeline(a: Adapters) {
  function logResponse(res: ModelResponse, question: string) {
    if (!res.ok) return a.audit.log({ actor: "system", event_type: "error", question, detail: res.error });
    res.proposed_commands.forEach((c) =>
      a.audit.log({ actor: "assistant", event_type: "proposed", question, command: c.command, risk: c.risk, detail: c.reason }),
    );
    res.blocked.forEach((b) => a.audit.log({ actor: "system", event_type: "blocked", question, command: b.command, detail: b.reason }));
  }

  return {
    async ask(question: string, host: HostBridge): Promise<ModelResponse> {
      a.audit.log({ actor: "operator", event_type: "question", question });
      const res = await a.model.complete({ question, state: host.getSessionContext() });
      logResponse(res, question);
      return res;
    },

    // Assistant speaks first at scenario start. Only read-only commands are kept (enforced here, not by the model).
    async proactive(host: HostBridge): Promise<ModelResponse> {
      const q =
        "Proactive briefing at scenario start: summarize what is happening (CPU 3 failure, load shifting) and propose ONLY read-only diagnostic commands to check first.";
      let res = await a.model.complete({ question: q, state: host.getSessionContext() });
      if (res.ok) {
        const dropped = res.proposed_commands.filter((c) => c.risk !== "read-only");
        res = {
          ...res,
          explanation: `${PROACTIVE_OPENER}\n\n${res.explanation}`,
          proposed_commands: res.proposed_commands.filter((c) => c.risk === "read-only"),
          blocked: [...res.blocked, ...dropped.map((c) => ({ command: c.command, reason: "Proactive mode proposes read-only commands only" }))],
        };
        a.audit.log({ actor: "assistant", event_type: "proactive", interpretation: res.explanation });
      }
      logResponse(res, "(proactive)");
      return res;
    },

    classify(cmd: string): Promise<Classification> {
      return a.policy.classify(cmd);
    },
    async debrief(d: Debrief) {
      const r = await a.knowledge.contribute(d);
      a.audit.log({ actor: "operator", event_type: "debrief", detail: "id" in r ? `saved ${r.id}` : r.error });
      return r;
    },
    getSource(id: string): Promise<KnowledgeHit | null> {
      return a.knowledge.get(id);
    },
    async approveAndRun(cmd: string, host: HostBridge): Promise<{ output: string[]; interpretation: ModelResponse }> {
      // Re-check the allowlist at execution time, independent of the model.
      const cls = await a.policy.classify(cmd);
      if (!cls.allowed) {
        a.audit.log({ actor: "system", event_type: "blocked", command: cmd, detail: cls.reason });
        return { output: [], interpretation: { ok: false, error: `Blocked: ${cls.reason}` } };
      }
      a.audit.log({ actor: "operator", event_type: "approved", command: cmd, risk: cls.risk });
      const output = await host.sendCommand(cmd);
      a.audit.log({ actor: "system", event_type: "output", command: cmd, output: output.join("\n") });
      const res = await a.model.complete({
        question: `Interpret this output of "${cmd}" for the operator. Explain what it means for the incident and suggest next steps (propose follow-up commands only if useful).\n${output.join("\n")}`,
        state: host.getSessionContext(),
      });
      a.audit.log({
        actor: "assistant",
        event_type: "interpretation",
        command: cmd,
        interpretation: res.ok ? `${res.explanation}${res.uncertainty ? `\nUnsure: ${res.uncertainty}` : ""}` : res.error,
      });
      logResponse(res, `(follow-up to ${cmd})`);
      return { output, interpretation: res };
    },
    reject(cmd: string, risk?: string) {
      a.audit.log({ actor: "operator", event_type: "rejected", command: cmd, risk });
    },
  };
}
