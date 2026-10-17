import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mockEnvironment } from "@/adapters/mock-environment";
import type { CommandResult, SystemState } from "@/adapters/types";
import type { HostBridge } from "@/core/pipeline";
import { SimBanner } from "@/components/SimBanner";
import { AssistantPanel } from "@/components/AssistantPanel";
import { useWebMCP } from "use-webmcp-tool";
import { Button } from "@/components/ui/button";
import { isCurrentSnapshot } from "@/lib/simulation-version";
import { runWebMCPTool } from "@/lib/webmcp-telemetry";

export const Route = createFileRoute("/")({
  staleTime: 0,
  gcTime: 0,
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

type Line = { kind: "in" | "out" | "err" | "sys"; text: string; prompt?: string };
const env = mockEnvironment;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// RMXCI commands get the SQL> prompt; everything else gets the numbered SCF-style prompt.
const isRmxci = (cmd: string) => /^(SHOW|SET|GET|SPOOL)\b/i.test(cmd.trim());

function HostPage() {
  const [lines, setLines] = useState<Line[]>([
    { kind: "sys", text: "TACL (simulated) — \\BANKPRD1.$SYSTEM.OPS" },
    { kind: "sys", text: "Type 'help' for available commands." },
  ]);
  const [typed, setTyped] = useState("");
  const [locked, setLocked] = useState(false);
  const [state, setState] = useState<SystemState>(Route.useLoaderData());
  const [panelOpen, setPanelOpen] = useState(true);
  const mutationPending = useRef(false);
  const generation = useRef(0);
  const [scenarios, setScenarios] = useState<{ id: string; label: string; title: string }[]>([]);
  useEffect(() => { env.listScenarios().then(setScenarios); }, []);
  const [now, setNow] = useState(0);
  useEffect(() => setNow(Date.now()), []);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const stateRef = useRef(state);
  stateRef.current = state;
  const scroll = useRef<HTMLDivElement>(null);
  const promptNo = useRef(1);

  const acceptState = useCallback((next: SystemState) => {
    const prev = stateRef.current;
    if (!isCurrentSnapshot(prev, next)) return;
    stateRef.current = next;
    setState(next);
  }, []);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const token = generation.current;
      try {
        if (!mutationPending.current) {
          const next = await env.getState();
          if (!disposed && token === generation.current && !mutationPending.current) acceptState(next);
        }
        if (!disposed) setNow(Date.now());
      } catch { /* Never reset a session on a failed poll. */ }
      finally { if (!disposed) timer = setTimeout(poll, 2000); }
    }
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [acceptState]);
  useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight }); }, [lines, typed]);

  const nextPrompt = (cmd: string) => (isRmxci(cmd) ? "SQL>" : `${promptNo.current++}->`);

  const execute = useCallback(async (cmd: string, operationId?: string): Promise<CommandResult> => {
    mutationPending.current = true; generation.current++;
    setLines((l) => [...l, { kind: "in", text: cmd, prompt: nextPrompt(cmd) }]);
    try {
      if (cmd.trim().toLowerCase() === "clear") { setLines([]); return { command: cmd, output: [], exitCode: 0 }; }
      const r = await env.runCommand(cmd, operationId ?? crypto.randomUUID());
      setLines((l) => [...l, ...r.output.map((t) => ({ kind: (r.exitCode ? "err" : "out") as Line["kind"], text: t }))]);
      acceptState(r.state ?? await env.getState());
      return r;
    } finally { mutationPending.current = false; generation.current++; }
  }, [acceptState]);

  // The ONLY surface exposed to the plugin.
  const bridge: HostBridge = useMemo(() => ({
    getSessionContext: () => ({
      recentOutput: linesRef.current.slice(-30).map((l) => l.text),
      state: stateRef.current,
    }),
    sendCommand: async (cmd, operationId) => {
      if (mutationPending.current) throw new Error("Another command is in progress");
      mutationPending.current = true; generation.current++;
      setLocked(true);
      for (let i = 1; i <= cmd.length; i++) { setTyped(cmd.slice(0, i)); await sleep(30); }
      await sleep(200);
      setTyped("");
      try { return await execute(cmd, operationId); } finally { setLocked(false); }
    },
  }), [execute]);

  async function inject(id: string, msg: string) {
    if (mutationPending.current) return;
    mutationPending.current = true; generation.current++;
    setLocked(true);
    try {
    await env.reset(id);
    const st = await env.getState();
    stateRef.current = st;
    setState(st);
    setLines([{ kind: "sys", text: `${msg} Incident ${st.incident.id}: ${st.incident.title}` }]);
    } finally { mutationPending.current = false; generation.current++; setLocked(false); }
  }

  useWebMCP({
    name: "read_system_status",
    description: "Read the simulated incident, alerts, CPU tiles, throughput and response time shown on the host screen.",
    annotations: { readOnlyHint: true },
    execute: () => runWebMCPTool("read_system_status", () => {
      const s = stateRef.current;
      return [
        `${s.scenario?.label ?? ""} · ${s.incident.id} ${s.incident.title} (${s.incident.severity})`,
        `TPS ${s.tps} · response ${s.responseMs} ms`,
        `CPUs: ${s.cpus.map((c) => `${c.id}:${c.status === "down" ? "DOWN" : `${c.busy}%`}`).join(" ")}`,
        ...s.incident.alerts.map((a) => `${a.time} ${a.source}: ${a.text}`),
      ].join("\n");
    }),
  });

  useWebMCP({
    name: "inject_fault",
    description: "Load a simulated fault scenario, like the Inject fault menu: resets the host screen and restarts the assistant briefing.",
    enabled: scenarios.length > 0 && !locked,
    inputSchema: {
      type: "object",
      properties: { scenario: { type: "string", enum: scenarios.map((x) => x.id), description: "Scenario id to load." } },
      required: ["scenario"],
    },
    execute: ({ scenario }: { scenario: string }) => runWebMCPTool("inject_fault", async () => {
      const sc = scenarios.find((x) => x.id === scenario);
      if (!sc) throw new Error("Unknown scenario.");
      await inject(sc.id, `Fault injected: ${sc.label}.`);
      return `Loaded ${sc.label}.`;
    }),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (locked || !typed.trim()) return;
    const c = typed; setTyped(""); setLocked(true);
    try { await execute(c); } finally { setLocked(false); }
  }

  const mins = Math.floor((now - state.incident.firstAlertAt) / 60000);
  const secs = Math.floor(((now - state.incident.firstAlertAt) % 60000) / 1000);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <SimBanner />
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <span className="host-label shrink-0 whitespace-nowrap">Simulated host system</span>
              <span className="truncate font-mono text-xs text-muted-foreground">{state.node} · {state.scenario?.label}{state.clock ? ` · ${state.clock}` : ""}</span>
            </div>
            <div className="flex min-w-0 flex-wrap gap-2">
            <select
              aria-label="Inject fault"
              value=""
              disabled={locked || mutationPending.current}
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
            <Button variant="ghost" size="sm"
              disabled={locked}
              onClick={async () => {
                if (mutationPending.current) return;
                mutationPending.current = true; generation.current++;
                setLocked(true);
                try {
                const r = await env.advanceTime();
                acceptState(r.state ?? await env.getState());
                setLines((l) => [
                  ...l,
                  { kind: "sys", text: `⏩ Advanced 15 min — scenario time ${r.clock}` },
                  ...r.messages.map((m) => ({ kind: "sys" as const, text: `📟 ${m}` })),
                ]);
                } finally { mutationPending.current = false; generation.current++; setLocked(false); }
              }}
              className="btn-ghost font-mono text-xs"
            >
              ⏩ Advance 15 min
            </Button>
            <Button variant="ghost" size="sm"
              disabled={locked}
              onClick={async () => {
                await inject(state.scenario?.id ?? "cpu-failure", "Scenario reset.");
              }}
              className="btn-ghost font-mono text-xs"
            >
              ↺ Reset scenario
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPanelOpen((o) => !o)} className="btn-ghost font-mono text-xs">
              {panelOpen ? "Hide assistant ▸" : "◂ Assistant"}
            </Button>
            </div>
          </div>

          <div className="grid min-w-0 gap-3 border-b border-border p-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <section className="tile min-w-0">
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
            <section className="tile min-w-0">
                <div className="grid grid-cols-4 gap-1 2xl:grid-cols-8">
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
                <div><div className="metric-label">Queue depth</div><div className="metric">{state.queueDepth.toLocaleString()}</div></div>
                <div>
                  <div className="metric-label">No backup</div>
                  <div className={`metric ${state.unprotected > 0 ? "text-crit" : ""}`}>{state.unprotected} <span className="text-xs text-muted-foreground">proc</span></div>
                </div>
                <div className="col-span-2">
                  <div className="metric-label">Redundancy</div>
                  <div className={`metric ${state.redundancy === "REDUCED" ? "text-warn" : ""}`}>{state.redundancy}</div>
                </div>
              </div>
            </section>
          </div>

          {state.maintenance && <div className="border-b border-border px-4 py-2 font-mono text-xs text-muted-foreground">
            {state.maintenance.id} · {state.maintenance.status.replaceAll("_", " ")} · {state.maintenance.elapsedMinutes}/{state.maintenance.durationMinutes} simulated min
          </div>}
          {state.endState && (
            <div className={`border-b border-border px-4 py-2 font-mono text-xs ${state.endState.id === "RESOLVED" ? "text-ok" : state.endState.id === "OUTAGE" ? "text-crit" : "text-warn"}`}>
              ■ {state.endState.id}: {state.endState.label}
            </div>
          )}
          <div ref={scroll} className="terminal flex-1 overflow-y-auto p-4 font-mono text-[13px] leading-relaxed">
            {lines.map((l, i) => (
              <div key={i} className={`term-${l.kind} whitespace-pre-wrap`}>{l.kind === "in" ? `${l.prompt ?? "1->"} ${l.text}` : l.text}</div>
            ))}
            <form onSubmit={submit} className="flex">
              <span className="term-in shrink-0">{isRmxci(typed) ? "SQL>" : `${promptNo.current}->`}&nbsp;</span>
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
          <footer className="border-t border-border px-4 py-1.5 text-center font-mono text-[10px] text-muted-foreground">
            Command formats based on the HPE SQL/MX RMXCI Guide 4.0.1; values are fictional.
          </footer>
        </main>

        <div className={`${panelOpen ? "w-1/2" : "hidden"} min-w-0 shrink-0 border-l border-border`}>
          <AssistantPanel key={state.sessionId} sessionId={state.sessionId ?? state.incident.id} title={`${state.scenario?.label ?? "Incident"} ${state.incident.id}`} host={bridge} onClose={() => setPanelOpen(false)} />
        </div>
      </div>
    </div>
  );
}
