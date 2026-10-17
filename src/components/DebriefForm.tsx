import { useState } from "react";
import type { Debrief } from "@/adapters/types";

export function DebriefForm({
  incident,
  onCancel,
  onSubmit,
}: {
  incident: string;
  onCancel: () => void;
  onSubmit: (d: Debrief) => Promise<string | null>;
}) {
  const [f, setF] = useState({ operator: "", suspicion: "", checkedFirst: "", adviceNext: "" });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const valid = f.operator.trim() && f.suspicion.trim().length > 2 && f.checkedFirst.trim().length > 2 && f.adviceNext.trim().length > 2;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return setErr("Please answer all questions.");
    setSaving(true);
    const r = await onSubmit({ incident, ...f });
    setSaving(false);
    setErr(r);
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t border-border bg-background p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Incident debrief</div>
        <span className="font-mono text-[10px] text-muted-foreground">{incident}</span>
      </div>
      <input value={f.operator} onChange={set("operator")} maxLength={100} placeholder="Your name" className="field w-full" aria-label="Your name" />
      <label className="block text-xs text-muted-foreground">What made you suspect that?
        <textarea value={f.suspicion} onChange={set("suspicion")} maxLength={2000} rows={2} className="field mt-1 w-full" />
      </label>
      <label className="block text-xs text-muted-foreground">What did you check first?
        <textarea value={f.checkedFirst} onChange={set("checkedFirst")} maxLength={2000} rows={2} className="field mt-1 w-full" />
      </label>
      <label className="block text-xs text-muted-foreground">What would you tell the next operator?
        <textarea value={f.adviceNext} onChange={set("adviceNext")} maxLength={2000} rows={2} className="field mt-1 w-full" />
      </label>
      {err && <div className="text-xs text-destructive">{err}</div>}
      <div className="flex gap-2">
        <button disabled={saving || !valid} className="btn-approve">{saving ? "Saving…" : "Save as expert note"}</button>
        <button type="button" onClick={onCancel} className="btn-ghost">Cancel</button>
      </div>
    </form>
  );
}
