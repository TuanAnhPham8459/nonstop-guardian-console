import { useRef, useState, useEffect } from "react";
import { serverPolicy } from "@/adapters/mock-environment";
import type { CheckedCommand, ModelResponse } from "@/adapters/types";
import { DebriefForm } from "./DebriefForm";
import { ProposalCard, type ProposalState } from "./ProposalCard";
import { createPipeline, type HostBridge } from "@/core/pipeline";
import { dbAudit, serverKnowledge, serverModel } from "@/adapters/mock-services";

import { createRehearsalModel, rehearsal } from "@/adapters/rehearsal-model";

const pipeline = createPipeline({ knowledge: serverKnowledge, model: createRehearsalModel(serverModel, serverPolicy), audit: dbAudit, policy: serverPolicy });

type Msg =
  | { role: "op" | "ai" | "err"; text: string }
  | { role: "uncertain"; text: string }
  | { role: "blocked"; items: { command: string; reason: string }[] }
  | { role: "proposal"; cls: CheckedCommand; state: ProposalState }
  | { role: "result"; cmd: string; output: string[] }
  | { role: "playbook"; text: string; conflicts: string[] };

function responseToMsgs(res: ModelResponse): Msg[] {
  if (!res.ok) return [{ role: "err", text: res.error }];
  const add: Msg[] = [{ role: "ai", text: res.explanation }];
  if (res.playbooks && res.playbooks.matched.length > 0) {
    const p = res.playbooks;
    const names = p.matched.map((m) => `"${m.title}" v${m.version}`).join(" and ");
    add.push({ role: "playbook", text: `Playbook match: ${names}. ${p.followed_reason ?? ""}`, conflicts: p.conflicts });
  }
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
  const [debriefOpen, setDebriefOpen] = useState(false);
  const [rehearsalOn, setRehearsalOn] = useState(false);
  useEffect(() => setRehearsalOn(rehearsal.enabled), []);
  function toggleRehearsal() {
    const on = !rehearsalOn;
    rehearsal.set(on);
    setRehearsalOn(on);
    setMsgs((m) => [...m, { role: "ai", text: on
      ? `Rehearsal mode ON — replaying cached replies (${rehearsal.cachedCount()} saved) or scripted ones. No AI calls are made. Risk tiers still come from the allowlist.`
      : "Rehearsal mode OFF — live AI replies." }]);
  }
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  // Proactive mode: assistant speaks first when the scenario starts.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    setBusy(true);
    pipeline.proactive(host).then((res) => {
      setMsgs((m) => [...m, ...responseToMsgs(res)]);
      setBusy(false);
    });
  }, [host]);

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
    pipeline.reject(cmd, msgs[i]?.role === "proposal" ? (msgs[i] as Extract<Msg, { role: "proposal" }>).cls.risk : undefined);
  }

  // Edited commands are re-classified against the server allowlist; risk never comes from the model.
  async function edit(i: number, prev: CheckedCommand, next: string): Promise<string | null> {
    const cls = await pipeline.classify(next);
    if (!cls.allowed) return cls.reason;
    setProposal(i, {
      cls: { ...prev, command: next.trim().replace(/\s+/g, " ").toUpperCase(), risk: cls.risk, description: cls.description, blast_radius: cls.blastRadius, simulated: cls.simulated, reason: `${prev.reason} (edited by operator)` },
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
        <div className="flex items-center gap-2">
          <button
            onClick={toggleRehearsal}
            aria-pressed={rehearsalOn}
            title="Replay cached assistant replies if the network or AI is unavailable"
            className={`btn-ghost font-mono text-[11px] ${rehearsalOn ? "border-warn text-warn" : ""}`}
          >
            Rehearsal: {rehearsalOn ? "ON" : "OFF"}
          </button>
          <button onClick={() => setDebriefOpen(true)} className="btn-ghost">Debrief</button>
          <button onClick={onClose} className="btn-ghost" aria-label="Close assistant">✕</button>
        </div>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {msgs.map((m, i) => {
          if (m.role === "op") return <div key={i} className="bubble-op">{m.text}</div>;
          if (m.role === "ai") return <div key={i} className="bubble-ai whitespace-pre-wrap">{m.text}</div>;
          if (m.role === "err") return <div key={i} className="blast">{m.text}</div>;
          if (m.role === "uncertain")
            return <div key={i} className="note"><span className="font-semibold">Unsure: </span>{m.text}</div>;
          if (m.role === "playbook")
            return (
              <div key={i} className="note">
                <div className="font-semibold">▤ {m.text}</div>
                {m.conflicts.map((c, j) => (
                  <div key={j} className="mt-1 text-warn">⚠ {c}</div>
                ))}
              </div>
            );
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
          if (m.role !== "result") return null;
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
      {debriefOpen && (
        <DebriefForm
          incident={(() => {
            const st = host.getSessionContext().state as { incident?: { title?: string } } | undefined;
            return st?.incident?.title ?? "Incident";
          })()}
          onCancel={() => setDebriefOpen(false)}
          onSubmit={async (d) => {
            const r = await pipeline.debrief(d);
            if ("error" in r) return r.error;
            setDebriefOpen(false);
            setMsgs((m) => [...m, { role: "ai", text: `Debrief saved as expert note ${r.id}. Ask a related question and it will be retrieved and cited.` }]);
            return null;
          }}
        />
      )}
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
