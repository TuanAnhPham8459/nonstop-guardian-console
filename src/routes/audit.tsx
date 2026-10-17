import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { SimBanner } from "@/components/SimBanner";
import { readAudit } from "@/lib/audit.functions";

export const Route = createFileRoute("/audit")({
  head: () => ({
    meta: [
      { title: "Audit Log — NonStop Ops Assistant" },
      { name: "description", content: "Every question, proposal, approval, output and interpretation recorded by the ops assistant." },
      { property: "og:title", content: "Audit Log — NonStop Ops Assistant" },
      { property: "og:description", content: "Full step-by-step audit trail of the simulated ops assistant." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: () => readAudit(),
  component: AuditPage,
});

const fmt = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 19);

function AuditPage() {
  const initial = Route.useLoaderData();
  const [rows, setRows] = useState(initial);
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const types = ["all", ...Array.from(new Set(initial.map((r) => r.event_type)))];
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) =>
    (filter === "all" || r.event_type === filter) &&
    (!needle || [r.session_id, r.actor, r.event_type, r.question, r.command, r.risk, r.output, r.interpretation, r.detail]
      .some((v) => v?.toLowerCase().includes(needle))));

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SimBanner />
      <div className="mx-auto max-w-6xl p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">Audit log <span className="font-mono text-xs text-muted-foreground">{shown.length} / {rows.length}</span></h1>
          <div className="flex flex-wrap gap-2">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search questions, commands, output…"
              aria-label="Search audit log"
              className="field w-72 font-mono text-xs"
            />
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className="field font-mono text-xs" aria-label="Filter by event">
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button onClick={async () => setRows(await readAudit())} className="btn-ghost font-mono text-xs">↻ Refresh</button>
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">{rows.length ? "No entries match your search." : "No audit entries yet. Use the assistant on the Host Terminal page."}</p>
        ) : (
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full font-mono text-[11px]">
              <thead className="bg-card text-left text-muted-foreground">
                <tr>
                  <th className="p-2">Time (UTC)</th><th className="p-2">Session</th><th className="p-2">Actor</th>
                  <th className="p-2">Event</th><th className="p-2">Command</th><th className="p-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const text = r.question ?? r.interpretation ?? r.output ?? r.detail ?? "";
                  return (
                    <tr key={r.id} className="border-t border-border align-top hover:bg-card">
                      <td className="whitespace-nowrap p-2 text-muted-foreground">{fmt(r.created_at)}</td>
                      <td className="p-2 text-muted-foreground">{r.session_id}</td>
                      <td className="p-2">{r.actor}</td>
                      <td className="p-2"><span className={`audit-ev audit-${r.event_type}`}>{r.event_type}</span></td>
                      <td className="p-2 text-primary">{r.command}{r.risk && <span className={`risk risk-${r.risk} ml-1`}>{r.risk}</span>}</td>
                      <td className="max-w-md p-2">
                        <button onClick={() => setOpen(open === r.id ? null : r.id)} className="w-full text-left">
                          <div className={open === r.id ? "whitespace-pre-wrap" : "truncate"}>{text}</div>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
