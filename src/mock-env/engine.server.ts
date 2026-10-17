import type { CommandResult, SystemState } from "@/adapters/types";
import { ALLOWLIST } from "./allowlist.server";
import { validateCommand, normalize } from "./validate.server";
import { SCENARIOS, defaultScenario, type Scenario, type ScenarioOption, type StateChange } from "./scenarios/payment-slowdown";

// Stateful simulation engine. Pure TS, no I/O — runs inside the mock-env backend.
// Each scenario is a decision tree of options (see scenarios.json): options gate on
// `requires`, `one_time`, `needs_second_operator` and traps; a scenario clock advances
// in 15-minute steps and fires time events (e.g. hardware repaired 45 min after the ticket).

export interface EnvState {
  sessionId: string;
  optionMinutes: Record<string, number>;
  timing: boolean;
  statistics: boolean;
  spooling: string | null;
  scfPrompt: number;
  ticket: NonNullable<SystemState["maintenance"]> | null;
  receipts: Record<string, CommandResult>;
  scenario: Scenario;
  executed: Set<string>; // option ids already run
  pendingSecond: string | null; // option id awaiting second-operator confirmation
  minutes: number; // minutes since scenario start (advanced by "Advance 15 min")
  flags: Record<string, unknown>; // hardwareTicket, hardwareRepaired, ownerResponse, ...
  metrics: { avgResponse: number; queue: number; queueGrowing: boolean; tps: number; unprotected: number; redundancy: "FULL" | "REDUCED"; cpuBusy: number[]; cpuDown: number | null };
  outage: string | null; // trap outcome message
  startedAt: number;
}

export function createEngine(snapshot?: SerializedSimulation) {
let s: EnvState = snapshot ? { ...snapshot, scenario: SCENARIOS[snapshot.scenarioId] ?? defaultScenario, executed: new Set(snapshot.executed) } : fresh(defaultScenario.id);
const events: { command?: string; output?: string; detail: string }[] = [];

function fresh(id: string): EnvState {
  const sc = SCENARIOS[id] ?? defaultScenario;
  const st = sc.start;
  return {
    sessionId: crypto.randomUUID(), optionMinutes: {}, timing: false, statistics: false, spooling: null, scfPrompt: 1, ticket: null, receipts: {},
    scenario: sc,
    executed: new Set(),
    pendingSecond: null,
    minutes: 0,
    flags: {
      hardwareTicket: st.hardwareTicket ?? false,
      hardwareRepaired: st.hardwareRepaired ?? false,
      ownerResponse: st.ownerResponse ?? null,
      businessImpact: false,
    },
    metrics: {
      avgResponse: st.avgResponse,
      queue: st.queue,
      queueGrowing: st.queueGrowing ?? false,
      tps: st.tps,
      unprotected: st.unprotected,
      redundancy: st.redundancy,
      cpuBusy: [...st.cpuBusy],
      cpuDown: st.cpuDown,
    },
    outage: null,
    startedAt: Date.now() - 12 * 60_000,
  };
}

function resetScenario(id = defaultScenario.id) {
  s = fresh(id);
  events.length = 0;
}

function applyChange(c: StateChange) {
  const m = s.metrics;
  if (c.avgResponse != null) m.avgResponse = c.avgResponse;
  if (c.avgResponseDelta != null) m.avgResponse = Math.max(50, m.avgResponse + c.avgResponseDelta);
  if (c.queue != null) m.queue = c.queue;
  if (c.queueDelta != null) m.queue = Math.max(0, m.queue + c.queueDelta);
  if (c.queueGrowing != null) m.queueGrowing = c.queueGrowing;
  if (c.tps != null) m.tps = c.tps;
  if (c.unprotected != null) m.unprotected = c.unprotected;
  if (c.redundancy != null) m.redundancy = c.redundancy;
  if (c.cpuBusy) m.cpuBusy = [...c.cpuBusy];
  if (c.cpuDown !== undefined) m.cpuDown = c.cpuDown;
  for (const k of ["hardwareTicket", "hardwareRepaired", "ownerResponse", "businessImpact"] as const)
    if (c[k] !== undefined) s.flags[k] = c[k];
}

function clock() {
  const [h, m] = s.scenario.start.clock.split(":").map(Number);
  const total = (h ?? 0) * 60 + (m ?? 0) + s.minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function advanceTime(step = 15): { clock: string; messages: string[] } {
  s.minutes += step;
  const messages: string[] = [];
  for (const ev of s.scenario.timeEvents ?? []) {
    const firedKey = `fired:${ev.afterOption}:${ev.afterMinutes}`;
    if (s.executed.has(ev.afterOption) && !s.flags[firedKey]) {
      const ranAt = s.optionMinutes[ev.afterOption] ?? 0;
      if (s.minutes - ranAt >= ev.afterMinutes) {
        s.flags[firedKey] = true;
        applyChange(ev.set);
        messages.push(ev.message);
        events.push({ detail: `Simulated repair event: ${ev.message}` });
        if (ev.maintenanceCompletion && s.ticket) {
          const passes = s.flags["hardwareRepaired"] === true && s.metrics.cpuDown === 3 && !s.outage;
          s.ticket = { ...s.ticket, status: passes ? "COMPLETED" : "CHECK_FAILED", elapsedMinutes: s.minutes - s.ticket.createdMinute };
          if (passes) {
            applyChange(ev.maintenanceCompletion);
            s.pendingSecond = null;
            const message = "Simulated post-repair health check PASSED; CPU 3 automatically reintegrated, process protection restored.";
            messages.push(message);
            events.push({ detail: message });
          } else {
            messages.push("Simulated post-repair health check failed; automatic reintegration withheld.");
            events.push({ detail: "Simulated post-repair health check FAILED; CPU reintegration withheld." });
          }
        }
      }
    }
  }
  if (s.ticket && s.ticket.status === "IN_PROGRESS") s.ticket.elapsedMinutes = s.minutes - s.ticket.createdMinute;
  return { clock: clock(), messages };
}


// End-state evaluation, per the scenario's endStates table.
function endState(): { id: string; label: string } | null {
  const m = s.metrics;
  if (s.outage) return { id: "OUTAGE", label: s.outage };
  const th = s.scenario.start.responseThreshold;
  const lowTierDone = s.scenario.options
    .filter((o) => o.tier <= 1 && !o.trap)
    .every((o) => s.executed.has(o.id));
  switch (s.scenario.id) {
    case "cpu-failure":
      if (m.avgResponse <= th && m.unprotected === 0 && m.cpuDown === null && m.redundancy === "FULL" && m.tps > 0) return { id: "RESOLVED", label: "Resolved — latency back under threshold and every process pair protected." };
      if (m.avgResponse <= th && m.unprotected > 0)
        return { id: "STABLE_AT_RISK", label: `Stable at risk — latency is fine, but ${m.unprotected} process(es) still run without a backup. Accept the risk window or continue.` };
      if (lowTierDone && m.avgResponse > th) return { id: "STALEMATE", label: "Stalemate — the safe options are exhausted and latency is still high. A high-risk decision is needed." };
      return null;
    case "disk-degraded":
      if (m.avgResponse <= th && m.redundancy === "FULL") return { id: "RESOLVED", label: "Resolved — latency back under threshold and redundancy restored." };
      if (m.avgResponse <= th && m.redundancy === "REDUCED") return { id: "STABLE_DEGRADED", label: "Stable but degraded — latency is fine, redundancy is still reduced." };
      if (lowTierDone && m.avgResponse > th) return { id: "STALEMATE", label: "Stalemate — the safe options are exhausted and latency is still high. A high-risk decision is needed." };
      return null;
    case "txn-backlog":
      if (m.queue <= 200 && m.avgResponse <= th) return { id: "RESOLVED", label: "Resolved — queue drained and latency back under threshold." };
      if (!m.queueGrowing && m.queue > 200) return { id: "CONTAINED", label: "Contained — the queue stopped growing, but the blocker is still present." };
      if (lowTierDone && m.queueGrowing) return { id: "STALEMATE", label: "Stalemate — the safe options are exhausted and the queue is still growing." };
      return null;
    default:
      return null;
  }
}

function getState(): SystemState {
  const sc = s.scenario;
  const m = s.metrics;
  const alerts = [...sc.alerts];
  const es = endState();
  if (es && es.id !== "OUTAGE") alerts.push({ time: clock(), source: "OPS", text: es.label, level: es.id === "RESOLVED" ? "info" : "warn" });
  if (s.outage) alerts.push({ time: clock(), source: "EMS", text: s.outage, level: "crit" });
  return {
    sessionId: s.sessionId,
    maintenance: s.ticket,
    receipts: s.receipts,
    node: sc.node,
    scenario: { id: sc.id, label: sc.label, opener: sc.opener },
    cpus: m.cpuBusy.map((v, id) => ({
      id,
      busy: v,
      status: id === m.cpuDown ? "down" : v >= 85 ? "crit" : v >= 70 ? "warn" : "ok",
    })),
    tps: s.outage ? 0 : m.tps,
    responseMs: s.outage ? 0 : m.avgResponse,
    queueDepth: m.queue,
    unprotected: m.unprotected,
    redundancy: m.redundancy,
    incident: { ...sc.incident, firstAlertAt: s.startedAt, alerts },
    clock: clock(),
    endState: es ? { id: es.id, label: es.label } : null,
  };
}

// RMXCI session flags (reset with the scenario).
const prompt = () => `${s.scfPrompt++}->`;

// Fictional GET STATISTICS numbers per scenario (lock problem vs disk problem).
function statsOutput(): string[] {
  const id = s.scenario.id;
  const es = endState();
  const resolved = es?.id === "RESOLVED";
  const pad = (v: string | number, w: number) => String(v).padEnd(w);
  const rows =
    id === "txn-backlog"
      ? resolved
        ? [
            ["PAYAUTH_TXN", 60400, 60180, 3100, 120800, 60400000, 6, 420, 2980],
            ["CARD_LEDGER", 27300, 27110, 1890, 54600, 27300000, 3, 160, 2100],
            ["AUTH_CODES", 10100, 10100, 240, 20200, 2020000, 0, 14, 280],
          ]
        : [
            ["PAYAUTH_TXN", 52100, 51230, 3340, 104200, 52100000, 148, 26800, 4460],
            ["CARD_LEDGER", 19800, 19420, 2110, 39600, 19800000, 96, 17400, 2910],
            ["AUTH_CODES", 8400, 8400, 260, 16800, 1680000, 7, 380, 330],
          ]
      : id === "disk-degraded"
        ? resolved
          ? [
              ["CARD_LEDGER", 27900, 27720, 9800, 55800, 27900000, 1, 70, 8600],
              ["PAYAUTH_TXN", 58300, 58140, 6400, 116600, 58300000, 2, 130, 5100],
              ["AUTH_CODES", 9800, 9800, 240, 19600, 1960000, 0, 10, 290],
            ]
          : [
              ["CARD_LEDGER", 24100, 23890, 41200, 48200, 24100000, 3, 110, 38400],
              ["PAYAUTH_TXN", 39800, 39610, 18600, 79600, 39800000, 5, 240, 12900],
              ["AUTH_CODES", 7900, 7900, 310, 15800, 1580000, 0, 18, 340],
            ]
        : resolved
          ? [
              ["PAYAUTH_TXN", 61900, 61720, 2980, 123800, 61900000, 2, 210, 2640],
              ["CARD_LEDGER", 28700, 28540, 1740, 57400, 28700000, 1, 90, 1980],
              ["AUTH_CODES", 10400, 10400, 230, 20800, 2080000, 0, 12, 280],
            ]
          : [
              ["PAYAUTH_TXN", 48210, 47980, 3120, 96420, 48102400, 12, 1840, 4210],
              ["CARD_LEDGER", 22400, 22110, 1980, 44800, 22400000, 4, 960, 2870],
              ["AUTH_CODES", 8150, 8150, 240, 16300, 1630000, 0, 45, 310],
            ];
  return [
    `Start Time: 2026-10-17 ${clock()}:00`,
    `End Time:   2026-10-17 ${clock()}:30`,
    "Elapsed Time: 00:00:30",
    "",
    `${pad("Table Name", 14)}${pad("Records Accessed", 17)}${pad("Records Used", 13)}${pad("Disk I/Os", 10)}${pad("Message Count", 14)}${pad("Message Bytes", 14)}${pad("Lock Escl", 10)}${pad("Lock Wait", 10)}Disk Process Busy Time`,
    ...rows.map(
      (r) =>
        `${pad(r[0] ?? "", 14)}${pad(r[1] ?? "", 17)}${pad(r[2] ?? "", 13)}${pad(r[3] ?? "", 10)}${pad(r[4] ?? "", 14)}${pad(r[5] ?? "", 14)}${pad(r[6] ?? "", 10)}${pad(r[7] ?? "", 10)}${r[8]}`,
    ),
  ];
}

function findOption(cmd: string): ScenarioOption | undefined {
  const n = normalize(cmd);
  return s.scenario.options.find((o) => normalize(o.action) === n);
}

function optionGate(o: ScenarioOption): string | null {
  if (o.one_time && s.executed.has(o.id)) return `Option ${o.id} is one-time and has already been executed.`;
  for (const r of o.requires ?? [])
    if (!s.executed.has(r)) return `Option ${o.id} requires ${r} first (${s.scenario.options.find((x) => x.id === r)?.action ?? r}).`;
  if (o.requiresAny && !o.requiresAny.some((r) => s.executed.has(r)))
    return `Option ${o.id} requires one of ${o.requiresAny.join(", ")} first.`;
  return null;
}

function runOption(o: ScenarioOption, cmd: string, risk: string): CommandResult & { risk?: string } {
  const p = prompt();
  const gate = optionGate(o);
  if (gate) return { command: cmd, risk, exitCode: 1, output: [`${p}${normalize(cmd)}`, `*** Not allowed: ${gate}`] };

  // Second-operator rule: first attempt arms it; the operator must re-issue with "CONFIRMED".
  if (o.needs_second_operator && (s.pendingSecond !== o.id || !/ CONFIRMED$/.test(normalize(cmd)))) {
    s.pendingSecond = o.id;
    return {
      command: cmd, risk, exitCode: 1, status: "awaiting-second-operator",
      output: [`${p}${normalize(cmd)}`, `*** ${o.id} requires a second operator. Re-issue the command ending with CONFIRMED to proceed.`],
    };
  }
  s.pendingSecond = null;
  s.executed.add(o.id);
  s.optionMinutes[o.id] ??= s.minutes;
  if (o.id === "C3" && !s.ticket) s.ticket = { id: "HW-88412", status: "IN_PROGRESS", createdMinute: s.minutes, durationMinutes: 45, elapsedMinutes: 0 };

  if (o.trap || o.outcome === "OUTAGE") {
    s.outage = `${o.action} caused an outage — all transaction processing stopped.`;
    return { command: cmd, risk, exitCode: 1, output: [`${p}${normalize(cmd)}`, ...(o.output ?? [])] };
  }

  if (o.outcomes) {
    const when = o.outcomes.success.when;
    const ok =
      when in s.flags ? Boolean(s.flags[when])
      : when === "ownerBlocked" ? String(s.flags["ownerResponse"] ?? "").startsWith("BLOCKED")
      : s.executed.has(when);
    const branch = ok ? o.outcomes.success : o.outcomes.bad;
    if (branch.state_change) applyChange(branch.state_change);
    return { command: cmd, risk, exitCode: ok ? 0 : 1, output: [`${p}${normalize(cmd)}`, ...branch.output] };
  }

  if (o.state_change) applyChange(o.state_change);
  return { command: cmd, risk, exitCode: 0, output: [`${p}${normalize(cmd)}`, ...(o.output ?? [])] };
}

function runCommand(cmd: string): CommandResult & { risk?: string } {
  // Second-operator confirmation: "<command> CONFIRMED" re-issues an armed option.
  const confirmed = / CONFIRMED$/.test(normalize(cmd));
  const base = confirmed ? cmd.replace(/\s+CONFIRMED\s*$/i, "") : cmd;
  const v = validateCommand(base);
  if (!v.ok) return { command: cmd, output: [v.reason], exitCode: 1 };
  const def = v.entry;
  const p = prompt();

  const opt = findOption(base);
  if (opt) {
    if (opt.id === "C7" && s.metrics.cpuDown === null) return { command: cmd, risk: def.risk, exitCode: 0, output: ["CPU 3 is already online; no recovery performed."] };
    if (opt.needs_second_operator && s.pendingSecond === opt.id && confirmed) s.pendingSecond = opt.id; // already armed — proceed
    else if (opt.needs_second_operator && confirmed) return { command: cmd, risk: def.risk, exitCode: 1, output: [`${p}${normalize(base)}`, "*** Nothing to confirm: issue the command first to arm second-operator approval."] };
    // Confirmed commands that are also options (e.g. STATUS PROCESS, GET STATISTICS):
    // gate and record the option, then fall through to the confirmed handler for output.
    if (def.id === "option") return runOption(opt, cmd, def.risk);
    const gate = optionGate(opt);
    if (gate) return { command: cmd, risk: def.risk, exitCode: 1, output: [`${p}${normalize(base)}`, `*** Not allowed: ${gate}`] };
    if (def.id === "get_statistics" && !s.statistics) return { command: cmd, risk: def.risk, exitCode: 1, output: ["*** ERROR[15001] Statistics are not enabled. Issue SET STATISTICS ON first."] };
    s.executed.add(opt.id);
    s.optionMinutes[opt.id] ??= s.minutes;
  }

  switch (def.id) {
    // --- Confirmed: SCF process commands ---
    case "status_process": {
      const down = s.metrics.cpuDown != null;
      return {
        command: cmd, risk: def.risk, exitCode: 0,
        output: [
          `${p}STATUS PROCESS $ZZKRN.#*`,
          `NONSTOP KERNEL - Status PROCESS ${s.scenario.node}.$ZZKRN.#PAYAUTH1`,
          `  PRIMARY  CPU ${down ? "3 (DOWN)" : "3"}  STATE: ${down ? "RUNNING ON BACKUP" : "RUNNING"}`,
          `  BACKUP   CPU 5  STATE: ${down ? "PRIMARY (TAKEOVER)" : "RUNNING"}`,
          `NONSTOP KERNEL - Status PROCESS ${s.scenario.node}.$ZZKRN.#PAYAUTH2`,
          `  PRIMARY  CPU 6  STATE: RUNNING   BACKUP CPU 7  STATE: RUNNING`,
          down ? `WARNING: ${s.metrics.unprotected} processes running without backup` : "All process pairs protected",
        ],
      };
    }
    case "tmf_status":
      return {
        command: cmd, risk: def.risk, exitCode: 0,
        output: [
          `${p}TMFCOM STATUS TMF`,
          "TMF Status: STARTED",
          `Audit trail capacity used: ${s.scenario.id === "txn-backlog" ? 91 : 64}%`,
          `Avg payment txn response: ${s.metrics.avgResponse} ms`,
        ],
      };
    case "tmf_status_transactions":
      return {
        command: cmd, risk: def.risk, exitCode: 0,
        output: [
          `${p}TMFCOM STATUS TRANSACTIONS`,
          `Active transactions: ${s.metrics.queue}`,
          s.scenario.id === "txn-backlog" && !s.executed.has("T6")
            ? `Oldest transaction age: 00:11:00 (owner BATCH-SETTLE) — owner response: ${s.flags["ownerResponse"] ?? "UNKNOWN"}`
            : "Oldest transaction age: 00:00:41",
        ],
      };
    case "tmf_status_audittrail":
      return { command: cmd, risk: def.risk, exitCode: 0, output: [`${p}TMFCOM STATUS AUDITTRAIL`, "Audit trail: $AUDIT  State: STARTED", `Capacity used: ${s.scenario.id === "txn-backlog" ? 91 : 64}%`] };
    case "tmf_status_datavols":
      return {
        command: cmd, risk: def.risk, exitCode: 0,
        output: [
          `${p}TMFCOM STATUS DATAVOLS`,
          "VOLUME     STATE     PATH",
          ...(s.scenario.id === "disk-degraded"
            ? ["$SYSTEM    STARTED   PRIMARY/MIRROR", "$DATA01    STARTED   MIRROR SIDE B (PRIMARY PATH ERRORS)", "$DATA02    STARTED   PRIMARY/MIRROR", "$AUDIT     STARTED   PRIMARY/MIRROR"]
            : ["$SYSTEM    STARTED   PRIMARY/MIRROR", "$DATA01    STARTED   PRIMARY/MIRROR", "$DATA02    STARTED   PRIMARY/MIRROR", "$AUDIT     STARTED   PRIMARY/MIRROR"]),
        ],
      };

    // --- Confirmed: RMXCI ---
    case "show_session":
      return {
        command: cmd, risk: def.risk, exitCode: 0,
        output: [
          "SQL> SHOW SESSION",
          "Session attributes:",
          `  TIMING      ${s.timing ? "ON" : "OFF"}`,
          `  STATISTICS  ${s.statistics ? "ON" : "OFF"}`,
          `  SPOOL       ${s.spooling ?? "OFF"}`,
          "  CATALOG     BANKPRD",
          "  SCHEMA      OPS",
        ],
      };
    case "show_tables":
      return { command: cmd, risk: def.risk, exitCode: 0, output: ["SQL> SHOW TABLES", "Tables referenced in this session:", "  BANKPRD.OPS.PAYAUTH_TXN", "  BANKPRD.OPS.CARD_LEDGER", "  BANKPRD.OPS.AUTH_CODES"] };
    case "show_lasterror":
      return { command: cmd, risk: def.risk, exitCode: 0, output: ["SQL> SHOW LASTERROR", "No error. Last statement completed successfully (SQLCODE 0)."] };
    case "set_timing":
      s.timing = true;
      return { command: cmd, risk: def.risk, exitCode: 0, output: ["SQL> SET TIMING ON", "Timing is ON."] };
    case "set_statistics":
      s.statistics = true;
      return { command: cmd, risk: def.risk, exitCode: 0, output: ["SQL> SET STATISTICS ON", "Statistics collection is ON."] };
    case "get_statistics":
      if (!s.statistics)
        return { command: cmd, risk: def.risk, exitCode: 1, output: ["SQL> GET STATISTICS", "*** ERROR[15001] Statistics are not enabled. Issue SET STATISTICS ON first."] };
      return { command: cmd, risk: def.risk, exitCode: 0, output: ["SQL> GET STATISTICS", ...statsOutput()] };
    case "spool":
      s.spooling = "$SPOOL.OUT01";
      return { command: cmd, risk: def.risk, exitCode: 0, output: ["SQL> SPOOL $SPOOL.OUT01", "Spooling to $SPOOL.OUT01 (simulated — no file is written)."] };
    default:
      return { command: cmd, risk: def.risk, exitCode: 1, output: [`${p}${normalize(base)}`, "*** No handler for this command in the current scenario."] };
  }
}

const commandHelp = () => [
  "Confirmed commands (documented by HPE):",
  ...ALLOWLIST.filter((c) => c.syntaxStatus === "confirmed").map((c) => `  ${c.pattern.padEnd(46)} [${c.risk}] ${c.description}`),
  "Illustrative commands (invented for the demo):",
  ...ALLOWLIST.filter((c) => c.syntaxStatus === "illustrative").map((c) => `  ${c.pattern.padEnd(46)} [${c.risk}] ${c.description}`),
];

const listScenarios = () => Object.values(SCENARIOS).map((x) => ({ id: x.id, label: x.label, title: x.incident.title }));
const currentScenarioId = () => s.scenario.id;
// Option ids already executed in the current scenario (for playbook conflict checks and debrief prefill).
const executedOptionIds = () => [...s.executed];
// Catalog view of every scenario option's gating rules (for playbook safety checks).
const optionGates = () =>
  Object.values(SCENARIOS).flatMap((sc) =>
    sc.options.map((o) => ({ id: o.id, action: o.action, requires: o.requires, requiresAny: o.requiresAny })),
  );

function snapshotState(): SerializedSimulation {
  const { scenario, executed, ...rest } = s;
  return { ...rest, scenarioId: scenario.id, executed: [...executed] };
}
return { getState, resetScenario, runCommand, advanceTime, endState, commandHelp, listScenarios, currentScenarioId, executedOptionIds, optionGates, snapshot: snapshotState, events, receipts: s.receipts };
}
export type SerializedSimulation = Omit<EnvState, "scenario" | "executed"> & { scenarioId: string; executed: string[] };
// Lazy compatibility facade for pure engine tests and public read-only demo tools.
let demo: ReturnType<typeof createEngine> | undefined;
const engine = () => demo ??= createEngine();
export const getState = () => engine().getState();
export const resetScenario = (id?: string) => engine().resetScenario(id);
export const runCommand = (cmd: string) => engine().runCommand(cmd);
export const advanceTime = (step = 15) => engine().advanceTime(step);
export const endState = () => engine().endState();
export const commandHelp = () => engine().commandHelp();
export const listScenarios = () => engine().listScenarios();
export const currentScenarioId = () => engine().currentScenarioId();
export const executedOptionIds = () => engine().executedOptionIds();
export const optionGates = () => engine().optionGates();
