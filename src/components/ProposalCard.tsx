import { useState } from "react";
import type { CheckedCommand, KnowledgeHit } from "@/adapters/types";

export type ProposalState = "pending" | "running" | "approved" | "rejected";

interface Props {
  cmd: CheckedCommand;
  state: ProposalState;
  disabled: boolean;
  onApprove: () => void;
  onReject: () => void;
  onEdit: (newCommand: string) => Promise<string | null>; // returns error or null
  getSource: (id: string) => Promise<KnowledgeHit | null>;
}

export function ProposalCard({ cmd, state, disabled, onApprove, onReject, onEdit, getSource }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cmd.command);
  const [editErr, setEditErr] = useState<string | null>(null);
  const [openSource, setOpenSource] = useState<KnowledgeHit | null>(null);

  const pending = state === "pending";
  const highOk = cmd.risk !== "high-risk" || typed === "CONFIRM";

  async function toggleSource(id: string) {
    if (openSource?.id === id) return setOpenSource(null);
    setOpenSource(await getSource(id));
  }

  async function saveEdit() {
    const err = await onEdit(draft);
    if (err) setEditErr(err);
    else {
      setEditErr(null);
      setEditing(false);
      setTyped("");
      setConfirming(false);
    }
  }

  return (
    <div className={`proposal proposal-${cmd.risk}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Proposed command</span>
        <span className="flex items-center gap-1.5">
          {cmd.simulated && (
            <span className="risk risk-low-risk" title="Illustrative syntax — not verified against HPE NonStop docs">Simulated syntax</span>
          )}
          <span className={`risk risk-${cmd.risk}`}>{cmd.risk}</span>
        </span>
      </div>

      {editing ? (
        <div className="mb-2 space-y-2">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} className="field w-full font-mono" aria-label="Edit command" />
          {editErr && <div className="text-xs text-destructive">{editErr}</div>}
          <div className="flex gap-2">
            <button onClick={saveEdit} className="btn-approve">Save</button>
            <button onClick={() => { setEditing(false); setDraft(cmd.command); setEditErr(null); }} className="btn-ghost">Cancel</button>
          </div>
        </div>
      ) : (
        <code className="cmd-block mb-2 block">&gt; {cmd.command}</code>
      )}

      <div className="mb-1 text-xs text-muted-foreground">{cmd.description}</div>
      <div className="mb-2 text-sm">{cmd.reason}</div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
        <span className="text-muted-foreground">confidence</span>
        <span className="conf-bar"><span style={{ width: `${Math.round(cmd.confidence * 100)}%` }} /></span>
        <span>{Math.round(cmd.confidence * 100)}%</span>
        <span className="mx-1 text-muted-foreground">·</span>
        {cmd.sources.length === 0 && <span className="text-muted-foreground">no sources</span>}
        {cmd.sources.map((s) => (
          <button key={s} onClick={() => toggleSource(s)} className={`cite ${openSource?.id === s ? "cite-open" : ""}`}>{s}</button>
        ))}
        {cmd.unknown_sources.map((s) => (
          <span key={s} className="risk risk-high-risk" title="Unknown source — removed">?{s}</span>
        ))}
      </div>
      {openSource && (
        <div className="note mb-2">
          <div className="font-semibold">[{openSource.id}] {openSource.title}</div>
          <div className="mt-1">{openSource.snippet}</div>
        </div>
      )}

      {cmd.blast_radius && (
        <div className="blast mb-2"><span className="font-semibold">Blast radius: </span>{cmd.blast_radius}</div>
      )}

      {pending && !editing && (
        <div className="space-y-2">
          {cmd.risk === "high-risk" && (
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder='Type "CONFIRM" to enable'
              className="field w-full font-mono"
              aria-label="Type CONFIRM to enable"
            />
          )}
          {cmd.risk === "low-risk" && confirming ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span>Run this low-risk command?</span>
              <button disabled={disabled} onClick={onApprove} className="btn-approve">Yes, run</button>
              <button onClick={() => setConfirming(false)} className="btn-ghost">No</button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                disabled={disabled || !highOk}
                onClick={() => (cmd.risk === "low-risk" ? setConfirming(true) : onApprove())}
                className="btn-approve"
              >
                Approve & Run
              </button>
              <button disabled={disabled} onClick={() => setEditing(true)} className="btn-ghost">Edit</button>
              <button disabled={disabled} onClick={onReject} className="btn-ghost">Reject</button>
            </div>
          )}
        </div>
      )}
      {!pending && (
        <div className={`font-mono text-[11px] ${state === "rejected" ? "text-destructive" : state === "running" ? "text-warn animate-pulse" : "text-ok"}`}>
          {state === "running" ? "RUNNING…" : state.toUpperCase()}
        </div>
      )}
    </div>
  );
}
