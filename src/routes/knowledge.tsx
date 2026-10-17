import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { SimBanner } from "@/components/SimBanner";
import { listKnowledgeFn } from "@/lib/assistant.functions";

export const Route = createFileRoute("/knowledge")({
  head: () => ({
    meta: [
      { title: "Knowledge Base — NonStop Ops Assistant" },
      { name: "description", content: "The runbook notes, past incidents and expert debriefs the ops assistant retrieves and cites." },
      { property: "og:title", content: "Knowledge Base — NonStop Ops Assistant" },
      { property: "og:description", content: "Playbook notes the simulated ops assistant uses as sources." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: () => listKnowledgeFn(),
  component: KnowledgePage,
});

const TYPES = ["all", "hpe-doc", "past-incident", "expert-note"];

function KnowledgePage() {
  const initial = Route.useLoaderData();
  const [notes, setNotes] = useState(initial);
  const [q, setQ] = useState("");
  const [type, setType] = useState("all");
  const n = q.trim().toLowerCase();
  const shown = notes.filter((x) =>
    (type === "all" || x.source_type === type) &&
    (!n || `${x.id} ${x.title} ${x.body} ${x.contributed_by}`.toLowerCase().includes(n)));

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SimBanner />
      <div className="mx-auto max-w-5xl p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">Knowledge Base <span className="font-mono text-xs text-muted-foreground">{shown.length} / {notes.length}</span></h1>
          <div className="flex flex-wrap gap-2">
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes…" aria-label="Search knowledge base" className="field w-64 font-mono text-xs" />
            <select value={type} onChange={(e) => setType(e.target.value)} className="field font-mono text-xs" aria-label="Filter by source type">
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button onClick={async () => setNotes(await listKnowledgeFn())} className="btn-ghost font-mono text-xs">↻ Refresh</button>
          </div>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          This is the assistant's playbook. For each question it keyword-matches these notes and cites them by ID. Add new notes with the Debrief button in the assistant panel.
        </p>
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notes match.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {shown.map((x) => (
              <article key={x.id} className="tile">
                <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[10px]">
                  <span className="text-primary">{x.id}</span>
                  <span className="audit-ev">{x.source_type}</span>
                </div>
                <h2 className="text-sm font-semibold">{x.title}</h2>
                <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{x.body}</p>
                <div className="mt-2 font-mono text-[10px] text-muted-foreground">by {x.contributed_by}</div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
