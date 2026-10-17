import type { CommandResult, EnvironmentAdapter, SystemState } from "./types";

// SIMULATED HPE NonStop node. No real system access.
const start = Date.now() - 17 * 60 * 1000;

const state: SystemState = {
  node: "\\BANKPRD1",
  cpus: [
    { id: 0, busy: 42, status: "ok" },
    { id: 1, busy: 38, status: "ok" },
    { id: 2, busy: 91, status: "crit" },
    { id: 3, busy: 77, status: "warn" },
    { id: 4, busy: 35, status: "ok" },
    { id: 5, busy: 40, status: "ok" },
    { id: 6, busy: 0, status: "down" },
    { id: 7, busy: 44, status: "ok" },
  ],
  tps: 1842,
  responseMs: 412,
  incident: {
    id: "INC-20417",
    title: "Elevated ATM authorization latency",
    severity: "SEV2",
    firstAlertAt: start,
    alerts: [
      { time: "20:04:11", source: "EMS", text: "CPU 6 down — process pairs taking over", level: "crit" },
      { time: "20:05:02", source: "Pathway", text: "SERVERCLASS AUTH-SVR queue depth 214", level: "crit" },
      { time: "20:07:40", source: "Measure", text: "CPU 2 busy > 90% for 5m", level: "warn" },
      { time: "20:11:15", source: "TMF", text: "Audit trail 68% full", level: "info" },
    ],
  },
};

const responses: Record<string, string[]> = {
  status: ["SYSTEM \\BANKPRD1  CPUs 0-7", "CPU 6 DOWN, all others UP"],
  "status cpu": state.cpus.map((c) => `CPU ${c.id}  ${c.status.toUpperCase().padEnd(5)} busy ${c.busy}%`),
  "peek /cpu 2": ["PEEK - T9050 ... CPU 2", "Memory pages: 1,048,576  Free: 21,340", "Dispatches/s: 18,402  Swaps/s: 12"],
  "pathcom $pm; status serverclass auth-svr": [
    "SERVERCLASS  STATE    RUNNING  QUEUED",
    "AUTH-SVR     RUNNING  8/12     214",
  ],
  "tmfcom status tmf": ["TMF Status: STARTED", "Audit trail capacity used: 68%", "Transactions/s: 1842"],
  help: ["Available (simulated): status, status cpu, peek /cpu <n>,", "  pathcom $pm; status serverclass auth-svr, tmfcom status tmf, clear"],
};

export const mockEnvironment: EnvironmentAdapter = {
  async runCommand(cmd: string): Promise<CommandResult> {
    await new Promise((r) => setTimeout(r, 350));
    const key = cmd.trim().toLowerCase();
    const output = responses[key];
    if (output) return { command: cmd, output, exitCode: 0 };
    return { command: cmd, output: [`*ERROR* Unknown command: ${cmd}  (type 'help')`], exitCode: 1 };
  },
  getState() {
    // light jitter to simulate live metrics
    state.tps = 1800 + Math.round(Math.random() * 90);
    state.responseMs = 380 + Math.round(Math.random() * 70);
    state.cpus.forEach((c) => {
      if (c.status !== "down") c.busy = Math.max(5, Math.min(99, c.busy + Math.round((Math.random() - 0.5) * 4)));
    });
    return structuredClone(state);
  },
};
