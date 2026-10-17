import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SimBanner } from "@/components/SimBanner";
import { approvePlaybookFn, listCatalogFn, listPlaybooksFn, savePlaybookFn } from "@/lib/playbooks.functions";
import type { Playbook, PlaybookStep, TriggerCondition } from "@/playbooks/playbooks.server";

export const Route = createFileRoute("/playbooks")({
  head: () => ({
    meta: [
      { title: "Playbooks — NonStop Ops Assistant" },
      { name: "description", content: "Approved operations playbooks that guide the simulated ops assistant's recommendations." },
      { property: "og:title", content: "Playbooks — NonStop Ops Assistant" },
      { property: "og:description", content: "Approved operations playbooks that guide the simulated ops assistant's recommendations." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: async () => ({ playbooks: await listPlaybooksFn(), catalog: await listCatalogFn() }),
  component: PlaybooksPage,
});

type CatalogItem = { option_id: string; action: string; risk: string; scenario: string; description: string };
const METRICS = ["cpus_down", "unprotected_processes", "avg_response_ms", "queue_depth", "redundancy", "tps"];
const OPS = [">", ">=", "<", "<=", "=", "!="] as const;

interface Draft {
  id?: string;
  title: string;
  author: string;
  trigger: TriggerCondition[];
  steps: PlaybookStep[];
  stop_conditions: string;
  escalate_if: string;
  never_do: string[];
}

const emptyDraft = (): Draft => ({
  title: "", author: "", trigger: [{ metric: "avg_response_ms", operator: ">", value: 300 }],
  steps: [], stop_conditions: "", escalate_if: "", never_do: [],
});

function PlaybooksPage() {
  const { playbooks: initial, catalog } = Route.useLoaderData();
  const [playbooks, setPlaybooks] = useState<Playbook[]>(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [approver, setApprover] = useState<Record<string, string>>({});
  const [approveErr, setApproveErr] = useState<Record<string, string>>({});

  // "Convert to playbook" from the Debrief form lands here with a prefill.
  useEffect(() => {
    if (!window.location.search.includes("new=1")) return;
    const raw = sessionStorage.getItem("playbook-prefill");
    sessionStorage.removeItem("playbook-prefill");
    const pre = raw ? (JSON.parse(raw) as Partial<Draft>) : {};
    setDraft({ ...emptyDraft(), ...pre, steps: pre.steps ?? [] });
  }, []);

  const refresh = async () => setPlaybooks(await listPlaybooksFn());

  async function save() {
    if (!draft) return;
    const r = await savePlaybookFn({ data: draft });
    if ("error" in r) return setErr(r.error);
    setErr(null);
    setDraft(null);
    await refresh();
  }

  async function approve(id: string) {
    const name = (approver[id] ?? "").trim();
    const r = await approvePlaybookFn({ data: { id, approver: name } });
    if ("error" in r) return setApproveErr((e) => ({ ...e, [id]: r.error }));
    setApproveErr((e) => ({ ...e, [id]: "" }));
    await refresh();
  }

  const setD = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SimBanner />
      <div className="mx-auto max-w-5xl p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">Playbooks <span className="font-mono text-xs text-muted-foreground">{playbooks.length}</span></h1>
          <button onClick={() => setDraft(emptyDraft())} className="btn-ghost font-mono text-xs">+ New playbook</button>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Approved playbooks guide the assistant: when a playbook's trigger matches the current system state, its step order shapes the recommendations,
          and every influenced recommendation shows its source. Drafts are never used. Approval requires a different person than the author.
        </p>

        {draft && (
          <div className="tile mb-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{draft.id ? `Edit ${draft.id}` : "New playbook"} <span className="risk risk-low-risk">Draft</span></h2>
              <button onClick={() => { setDraft(null); setErr(null); }} className="btn-ghost font-mono text-xs">✕ Close</button>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <input value={draft.title} onChange={(e) => setD({ title: e.target.value })} maxLength={200} placeholder="Title" className="field" aria-label="Playbook title" />
              <input value={draft.author} onChange={(e) => setD({ author: e.target.value })} maxLength={100} placeholder="Author (your name)" className="field" aria-label="Author" />
            </div>

            <div>
              <div className="mb-1 font-mono text-[10px] text-muted-foreground">TRIGGER — all conditions must match the current state</div>
              {draft.trigger.map((c, i) => (
                <div key={i} className="mb-1 flex flex-wrap items-center gap-1.5">
                  <select value={c.metric} onChange={(e) => setD({ trigger: draft.trigger.map((x, j) => (j === i ? { ...x, metric: e.target.value } : x)) })} className="field font-mono text-xs" aria-label="Trigger metric">
                    {METRICS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <select value={c.operator} onChange={(e) => setD({ trigger: draft.trigger.map((x, j) => (j === i ? { ...x, operator: e.target.value as TriggerCondition["operator"] } : x)) })} className="field w-16 font-mono text-xs" aria-label="Trigger operator">
                    {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <input value={String(c.value)} onChange={(e) => setD({ trigger: draft.trigger.map((x, j) => (j === i ? { ...x, value: isNaN(Number(e.target.value)) || e.target.value === "" ? e.target.value : Number(e.target.value) } : x)) })} className="field w-24 font-mono text-xs" aria-label="Trigger value" />
                  <button onClick={() => setD({ trigger: draft.trigger.filter((_, j) => j !== i) })} className="btn-ghost font-mono text-xs" aria-label="Remove condition">✕</button>
                </div>
              ))}
              <button onClick={() => setD({ trigger: [...draft.trigger, { metric: "queue_depth", operator: ">", value: 1000 }] })} className="btn-ghost font-mono text-xs">+ Add condition</button>
            </div>

            <div>
              <div className="mb-1 font-mono text-[10px] text-muted-foreground">STEPS — chosen from the command catalog only</div>
              {draft.steps.map((s, i) => (
                <div key={i} className="mb-2 rounded border border-border p-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-xs text-muted-foreground">{i + 1}.</span>
                    <select
                      value={s.option_id}
                      onChange={(e) => {
                        const c = catalog.find((x: CatalogItem) => x.option_id === e.target.value);
                        if (c) setD({ steps: draft.steps.map((x, j) => (j === i ? { ...x, option_id: c.option_id, action: c.action } : x)) });
                      }}
                      className="field flex-1 font-mono text-xs"
                      aria-label={`Step ${i + 1} command`}
                    >
                      {catalog.map((c: CatalogItem) => <option key={c.option_id} value={c.option_id}>[{c.option_id}] {c.action} ({c.risk})</option>)}
                    </select>
                    <button onClick={() => setD({ steps: draft.steps.filter((_, j) => j !== i) })} className="btn-ghost font-mono text-xs" aria-label="Remove step">✕</button>
                  </div>
                  <input value={s.why} onChange={(e) => setD({ steps: draft.steps.map((x, j) => (j === i ? { ...x, why: e.target.value } : x)) })} maxLength={1000} placeholder="Why this step" className="field mt-1 w-full text-xs" aria-label={`Step ${i + 1} reason`} />
                  <input value={s.check_after ?? ""} onChange={(e) => setD({ steps: draft.steps.map((x, j) => (j === i ? { ...x, check_after: e.target.value } : x)) })} maxLength={500} placeholder="Check after (optional)" className="field mt-1 w-full text-xs" aria-label={`Step ${i + 1} check after`} />
                </div>
              ))}
              <button
                onClick={() => { const c = catalog[0]; if (c) setD({ steps: [...draft.steps, { option_id: c.option_id, action: c.action, why: "" }] }); }}
                className="btn-ghost font-mono text-xs"
              >
                + Add step
              </button>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <input value={draft.stop_conditions} onChange={(e) => setD({ stop_conditions: e.target.value })} maxLength={1000} placeholder="Stop conditions" className="field text-xs" aria-label="Stop conditions" />
              <input value={draft.escalate_if} onChange={(e) => setD({ escalate_if: e.target.value })} maxLength={1000} placeholder="Escalate if…" className="field text-xs" aria-label="Escalate if" />
            </div>
            <div>
              <div className="mb-1 font-mono text-[10px] text-muted-foreground">NEVER DO — these options are ranked last with a warning</div>
              <div className="flex flex-wrap gap-1.5">
                {catalog.filter((c: CatalogItem) => c.risk === "high-risk").map((c: CatalogItem) => (
                  <button
                    key={c.option_id}
                    onClick={() => setD({ never_do: draft.never_do.includes(c.option_id) ? draft.never_do.filter((x) => x !== c.option_id) : [...draft.never_do, c.option_id] })}
                    className={`risk ${draft.never_do.includes(c.option_id) ? "risk-high-risk" : "risk-read-only"}`}
                    aria-pressed={draft.never_do.includes(c.option_id)}
                  >
                    {c.option_id}
                  </button>
                ))}
              </div>
            </div>
            {err && <div className="text-xs text-destructive">{err}</div>}
            <button onClick={save} className="btn-approve">Save as draft</button>
          </div>
        )}

        <div className="grid gap-3">
          {playbooks.map((p) => (
            <article key={p.id} className="tile">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-primary">{p.id}</span>
                  <h2 className="text-sm font-semibold">{p.title}</h2>
                  <span className="font-mono text-[10px] text-muted-foreground">v{p.version}</span>
                </div>
                <span className={`risk ${p.status === "approved" ? "risk-read-only" : "risk-low-risk"}`}>{p.status === "approved" ? "Approved" : "Draft"}</span>
              </div>
              <div className="mb-2 font-mono text-[10px] text-muted-foreground">
                by {p.author} · {p.status === "approved" ? `approved by ${p.approved_by}` : "awaiting approval"}
              </div>
              <div className="mb-2 font-mono text-[10px] text-muted-foreground">
                Trigger: {p.trigger.map((c) => `${c.metric} ${c.operator} ${c.value}`).join(" AND ") || "—"}
              </div>
              <ol className="mb-2 space-y-1 text-xs">
                {p.steps.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="font-mono text-muted-foreground">{i + 1}.</span>
                    <span>
                      <code className="font-mono text-accent-foreground">{s.action}</code>
                      {s.why && <span className="text-muted-foreground"> — {s.why}</span>}
                      {s.check_after && <span className="text-muted-foreground"> (check: {s.check_after})</span>}
                    </span>
                  </li>
                ))}
              </ol>
              {p.never_do.length > 0 && <div className="mb-2 font-mono text-[10px] text-crit">never_do: {p.never_do.join(", ")}</div>}
              {(p.stop_conditions || p.escalate_if) && (
                <div className="mb-2 text-[11px] text-muted-foreground">
                  {p.stop_conditions && <div>Stop when: {p.stop_conditions}</div>}
                  {p.escalate_if && <div>Escalate if: {p.escalate_if}</div>}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => setDraft({ id: p.id, title: p.title, author: p.author, trigger: p.trigger, steps: p.steps, stop_conditions: p.stop_conditions, escalate_if: p.escalate_if, never_do: p.never_do })} className="btn-ghost font-mono text-xs">Edit</button>
                {p.status === "draft" && (
                  <>
                    <input
                      value={approver[p.id] ?? ""}
                      onChange={(e) => setApprover((a) => ({ ...a, [p.id]: e.target.value }))}
                      maxLength={100}
                      placeholder="Approver name (not the author)"
                      className="field w-56 text-xs"
                      aria-label={`Approver for ${p.id}`}
                    />
                    <button onClick={() => approve(p.id)} className="btn-approve">Approve</button>
                  </>
                )}
              </div>
              {approveErr[p.id] && <div className="mt-1 text-xs text-destructive">{approveErr[p.id]}</div>}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
