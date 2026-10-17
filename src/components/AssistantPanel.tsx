import { useRef, useState, useEffect } from "react";
import { serverPolicy } from "@/adapters/mock-environment";
import type { CheckedCommand, ModelResponse } from "@/adapters/types";
import { ProposalCard, type ProposalState } from "./ProposalCard";
import { createPipeline, type HostBridge } from "@/core/pipeline";
import { mockAudit, serverKnowledge, serverModel } from "@/adapters/mock-services";

const pipeline = createPipeline({ knowledge: serverKnowledge, model: serverModel, audit: mockAudit, policy: serverPolicy });

type Msg =
  | { role: "op" | "ai" | "err"; text: string }
  | { role: "uncertain"; text: string }
  | { role: "blocked"; items: { command: string; reason: string }[] }
  | { role: "proposal"; cls: CheckedCommand; state: ProposalState }
  | { role: "result"; cmd: string; output: string[] };

function responseToMsgs(res: ModelResponse): Msg[] {
  if (!res.ok) return [{ role: "err", text: res.error }];
  const add: Msg[] = [{ role: "ai", text: res.explanation }];
  res.proposed_commands.forEach((c) => add.push({ role: "proposal", cls: c, state: "pending" }));
  if (res.blocked.length) add.push({ role: "blocked", items: res.blocked });
  if (res.uncertainty) add.push({ role: "uncertain", text: res.uncertainty });
  return add;
}

export function AssistantPanel({ host, onClose }: { host: HostBridge; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "ai", text: "Ops assistant attached. I can read recent terminal output and propose commands — nothing runs without your click." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const setProposal = (i: number, patch: Partial<Extract<Msg, { role: "proposal" }>>) =>
    setMsgs((m) => m.map((x, j) => (j === i && x.role === "proposal" ? { ...x, ...patch } : x)));

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    setMsgs((m) => [...m, { role: "op", text: q }]);
    const res = await pipeline.ask(q, host);
    setMsgs((m) => [...m, ...responseToMsgs(res)]);
    setBusy(false);
  }

  async function approve(i: number, cmd: string) {
    setProposal(i, { state: "running" });
    setBusy(true);
    const r = await pipeline.approveAndRun(cmd, host);
    setProposal(i, { state: "approved" });
    setMsgs((m) => [...m, ...(r.output.length ? [{ role: "result" as const, cmd, output: r.output }] : []), ...responseToMsgs(r.interpretation)]);
    setBusy(false);
  }

  function reject(i: number, cmd: string) {
    setProposal(i, { state: "rejected" });
    pipeline.reject(cmd);
  }

  // Edited commands are re-classified against the server allowlist; risk never comes from the model.
  async function edit(i: number, prev: CheckedCommand, next: string): Promise<string | null> {
    const cls = await pipeline.classify(next);
    if (!cls.allowed) return cls.reason;
    setProposal(i, {
      cls: { ...prev, command: next.trim().replace(/\s+/g, " ").toUpperCase(), risk: cls.risk, description: cls.description, blast_radius: cls.blastRadius, reason: `${prev.reason} (edited by operator)` },
    });
    return null;
  }

  return (
    <aside className="panel flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <div className="text-sm font-semibold">Ops Assistant</div>
          <div className="font-mono text-[10px] text-muted-foreground">plugin · bridge: getSessionContext / sendCommand</div>
        </div>
        <button onClick={onClose} className="btn-ghost" aria-label="Close assistant">✕</button>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {msgs.map((m, i) => {
          if (m.role === "op") return <div key={i} className="bubble-op">{m.text}</div>;
          if (m.role === "ai") return <div key={i} className="bubble-ai whitespace-pre-wrap">{m.text}</div>;
          if (m.role === "err") return <div key={i} className="blast">{m.text}</div>;
          if (m.role === "uncertain")
            return <div key={i} className="note"><span className="font-semibold">Unsure: </span>{m.text}</div>;
          if (m.role === "blocked")
            return (
              <div key={i} className="blast font-mono">
                <div className="mb-1 font-semibold">Blocked by allowlist</div>
                {m.items.map((b, j) => <div key={j}>✕ {b.command} — {b.reason}</div>)}
              </div>
            );
          if (m.role === "proposal")
            return (
              <ProposalCard
                key={i}
                cmd={m.cls}
                state={m.state}
                disabled={busy}
                onApprove={() => approve(i, m.cls.command)}
                onReject={() => reject(i, m.cls.command)}
                onEdit={(next) => edit(i, m.cls, next)}
                getSource={(id) => pipeline.getSource(id)}
              />
            );
          return (
            <div key={i} className="term-block">
              <div className="term-block-head">mock-env · {m.cmd}</div>
              <pre>{m.output.join("\n")}</pre>
            </div>
          );
        })}
        {busy && <div className="font-mono text-xs text-muted-foreground animate-pulse">working…</div>}
        <div ref={end} />
      </div>
      <form onSubmit={ask} className="flex gap-2 border-t border-border p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask in plain language, e.g. why is latency high?"
          className="field flex-1"
        />
        <button className="btn-approve" disabled={busy}>Ask</button>
      </form>
    </aside>
  );
}
