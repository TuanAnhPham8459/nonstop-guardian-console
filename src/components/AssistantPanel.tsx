import { useRef, useState, useEffect } from "react";
import { createPipeline, type HostBridge } from "@/core/pipeline";
import { mockAudit, mockKnowledge, mockModel } from "@/adapters/mock-services";

const pipeline = createPipeline({ knowledge: mockKnowledge, model: mockModel, audit: mockAudit });

type Msg =
  | { role: "op" | "ai"; text: string }
  | { role: "proposal"; cmd: string; state: "pending" | "approved" | "rejected" }
  | { role: "result"; cmd: string; output: string[]; text: string };

export function AssistantPanel({ host, onClose }: { host: HostBridge; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "ai", text: "Ops assistant attached. I can read recent terminal output and propose commands — nothing runs without your approval." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    setMsgs((m) => [...m, { role: "op", text: q }]);
    const res = await pipeline.ask(q, host);
    setMsgs((m) => [
      ...m,
      { role: "ai", text: res.text },
      ...(res.proposedCommand ? [{ role: "proposal" as const, cmd: res.proposedCommand, state: "pending" as const }] : []),
    ]);
    setBusy(false);
  }

  async function decide(i: number, cmd: string, ok: boolean) {
    setMsgs((m) => m.map((x, j) => (j === i && x.role === "proposal" ? { ...x, state: ok ? "approved" : "rejected" } : x)));
    if (!ok) return pipeline.reject(cmd);
    setBusy(true);
    const r = await pipeline.approveAndRun(cmd, host);
    setMsgs((m) => [...m, { role: "result", cmd, output: r.output, text: r.interpretation }]);
    setBusy(false);
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
          if (m.role === "ai") return <div key={i} className="bubble-ai">{m.text}</div>;
          if (m.role === "proposal")
            return (
              <div key={i} className="proposal">
                <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Proposed command</div>
                <code className="block font-mono text-sm text-primary">&gt; {m.cmd}</code>
                {m.state === "pending" ? (
                  <div className="mt-3 flex gap-2">
                    <button disabled={busy} onClick={() => decide(i, m.cmd, true)} className="btn-approve">Approve & run</button>
                    <button disabled={busy} onClick={() => decide(i, m.cmd, false)} className="btn-ghost">Reject</button>
                  </div>
                ) : (
                  <div className={`mt-2 font-mono text-[11px] ${m.state === "approved" ? "text-ok" : "text-destructive"}`}>
                    {m.state.toUpperCase()}
                  </div>
                )}
              </div>
            );
          if (m.role !== "result") return null;
          return (
            <div key={i} className="bubble-ai">
              <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Output of {m.cmd}</div>
              <pre className="mb-2 overflow-x-auto rounded bg-background p-2 font-mono text-[11px] text-ok">{m.output.join("\n")}</pre>
              {m.text}
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
