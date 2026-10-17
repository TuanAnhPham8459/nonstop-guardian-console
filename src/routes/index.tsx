import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mockEnvironment } from "@/adapters/mock-environment";
import type { SystemState } from "@/adapters/types";
import type { HostBridge } from "@/core/pipeline";
import { SimBanner } from "@/components/SimBanner";
import { AssistantPanel } from "@/components/AssistantPanel";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Host Terminal — NonStop Ops Console (Simulated)" },
      { name: "description", content: "Simulated HPE NonStop operations terminal with a docked AI assistant plugin." },
      { property: "og:title", content: "Host Terminal — NonStop Ops Console" },
      { property: "og:description", content: "Simulated host system with a pluggable ops assistant." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: () => mockEnvironment.getState(),
  component: HostPage,
});

type Line = { kind: "in" | "out" | "err" | "sys"; text: string };
const env = mockEnvironment;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function HostPage() {
  const [lines, setLines] = useState<Line[]>([
    { kind: "sys", text: "TACL (simulated) — \\BANKPRD1.$SYSTEM.OPS" },
    { kind: "sys", text: "Type 'help' for available commands." },
  ]);
  const [typed, setTyped] = useState("");
  const [locked, setLocked] = useState(false);
  const [state, setState] = useState<SystemState>(Route.useLoaderData());
  const [panelOpen, setPanelOpen] = useState(true);
  const [run, setRun] = useState(0); // bumps on fault injection so the assistant restarts its briefing
  const [scenarios, setScenarios] = useState<{ id: string; label: string; title: string }[]>([]);
  useEffect(() => { env.listScenarios().then(setScenarios); }, []);
  const [now, setNow] = useState(0);
  useEffect(() => setNow(Date.now()), []);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const stateRef = useRef(state);
  stateRef.current = state;
  const scroll = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => { env.getState().then(setState); setNow(Date.now()); }, 2000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight }); }, [lines, typed]);

  const execute = useCallback(async (cmd: string) => {
    setLines((l) => [...l, { kind: "in", text: cmd }]);
    if (cmd.trim().toLowerCase() === "clear") { setLines([]); return []; }
    const r = await env.runCommand(cmd);
    setLines((l) => [...l, ...r.output.map((t) => ({ kind: (r.exitCode ? "err" : "out") as Line["kind"], text: t }))]);
    const st = await env.getState();
    stateRef.current = st;
    setState(st);
    return r.output;
  }, []);

  // The ONLY surface exposed to the plugin.
  const bridge: HostBridge = useMemo(() => ({
    getSessionContext: () => ({
      recentOutput: linesRef.current.slice(-30).map((l) => l.text),
      state: stateRef.current,
    }),
    sendCommand: async (cmd) => {
      setLocked(true);
      for (let i = 1; i <= cmd.length; i++) { setTyped(cmd.slice(0, i)); await sleep(30); }
      await sleep(200);
      setTyped("");
      const out = await execute(cmd);
      setLocked(false);
      return out;
    },
  }), [execute]);

  async function inject(id: string, msg: string) {
    await env.reset(id);
    const st = await env.getState();
    stateRef.current = st;
    setState(st);
    setLines([{ kind: "sys", text: `${msg} Incident ${st.incident.id}: ${st.incident.title}` }]);
    setRun((r) => r + 1);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (locked || !typed.trim()) return;
    const c = typed; setTyped(""); setLocked(true);
    await execute(c); setLocked(false);
  }

  const mins = Math.floor((now - state.incident.firstAlertAt) / 60000);
  const secs = Math.floor(((now - state.incident.firstAlertAt) % 60000) / 1000);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <SimBanner />
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <div className="flex items-center gap-3">
              <span className="host-label shrink-0 whitespace-nowrap">Simulated host system</span>
              <span className="truncate font-mono text-xs text-muted-foreground">{state.node} · {state.scenario?.label}</span>
            </div>
            <div className="flex gap-2">
            <select
              aria-label="Inject fault"
              value=""
              onChange={async (e) => {
                const id = e.target.value;
                if (!id) return;
                await inject(id, `Fault injected: ${scenarios.find((x) => x.id === id)?.label ?? id}.`);
              }}
              className="btn-ghost w-40 bg-background font-mono text-xs text-warn"
            >
              <option value="">⚡ Inject fault…</option>
              {scenarios.map((x) => (
                <option key={x.id} value={x.id}>{x.label} — {x.title}</option>
              ))}
            </select>
            <button
              onClick={async () => {
                const id = state.scenario?.id;
                await env.reset(id);
                const st = await env.getState();
                stateRef.current = st;
                setState(st);
                setLines([{ kind: "sys", text: `Scenario '${st.scenario?.label ?? id}' reset.` }]);
              }}
              className="btn-ghost font-mono text-xs"
            >
              ↺ Reset scenario
            </button>
            <button onClick={() => setPanelOpen((o) => !o)} className="btn-ghost font-mono text-xs">
              {panelOpen ? "Hide assistant ▸" : "◂ Assistant"}
            </button>
            </div>
          </div>

          <div className="grid gap-3 border-b border-border p-3 md:grid-cols-[1.2fr_1fr]">
            <section className="tile">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-mono text-[10px] text-muted-foreground">{state.incident.id}</div>
                  <div className="text-sm font-semibold">{state.incident.title}</div>
                </div>
                <div className="text-right">
                  <span className="sev">{state.incident.severity}</span>
                  <div className="mt-1 font-mono text-lg text-warn tabular-nums">
                    {now ? `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : "--:--"}
                  </div>
                  <div className="text-[10px] text-muted-foreground">since first alert</div>
                </div>
              </div>
              <ul className="mt-2 space-y-1 font-mono text-[11px]">
                {state.incident.alerts.map((a, i) => (
                  <li key={i} className="flex gap-2">
                    <span className={`dot dot-${a.level}`} />
                    <span className="text-muted-foreground">{a.time}</span>
                    <span className="text-accent-foreground">{a.source}</span>
                    <span className="truncate">{a.text}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="tile">
              <div className="grid grid-cols-8 gap-1">
                {state.cpus.map((c) => (
                  <div key={c.id} className={`cpu cpu-${c.status}`}>
                    <div className="text-[9px] opacity-70">CPU{c.id}</div>
                    <div className="text-xs font-semibold">{c.status === "down" ? "DN" : `${c.busy}%`}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div><div className="metric-label">Throughput</div><div className="metric">{state.tps.toLocaleString()} <span className="text-xs text-muted-foreground">TPS</span></div></div>
                <div><div className="metric-label">Response time</div><div className="metric text-warn">{state.responseMs} <span className="text-xs text-muted-foreground">ms</span></div></div>
              </div>
            </section>
          </div>

          <div ref={scroll} className="terminal flex-1 overflow-y-auto p-4 font-mono text-[13px] leading-relaxed">
            {lines.map((l, i) => (
              <div key={i} className={`term-${l.kind} whitespace-pre-wrap`}>{l.kind === "in" ? `$OPS 1> ${l.text}` : l.text}</div>
            ))}
            <form onSubmit={submit} className="flex">
              <span className="term-in shrink-0">$OPS 1&gt;&nbsp;</span>
              <input
                value={typed}
                onChange={(e) => !locked && setTyped(e.target.value)}
                readOnly={locked}
                className="term-input flex-1"
                autoFocus
                spellCheck={false}
                aria-label="Terminal command"
              />
            </form>
          </div>
        </main>

        {panelOpen && (
          <div className="w-1/2 min-w-0 shrink-0 border-l border-border">
            <AssistantPanel key={run} host={bridge} onClose={() => setPanelOpen(false)} />
          </div>
        )}
      </div>
    </div>
  );
}
