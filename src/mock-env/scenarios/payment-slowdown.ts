// Scenario data: "payment-slowdown". Edit values here to change the story.
export const paymentSlowdown = {
  id: "payment-slowdown",
  node: "\\BANKPRD1",
  incident: {
    id: "INC-20417",
    title: "Payment authorization latency high",
    severity: "SEV2" as const,
  },
  cpuFailure: { cpu: 3, at: "14:02:00" },
  // CPU busy % before the failure, and after load shifts to CPUs 4-7
  baselineBusy: [34, 31, 36, 38, 33, 35, 32, 37],
  degradedBusy: [36, 33, 39, 0, 88, 91, 86, 89],
  // after high-risk remediation (process restart rebalances work)
  recoveredBusy: [40, 38, 42, 0, 55, 58, 53, 56],
  responseMs: { start: 120, peak: 900, recovered: 180 },
  rampTicks: 8, // number of state polls to climb from start to peak
  tps: { degraded: 1420, recovered: 1880 },
  alerts: [
    { time: "14:02:00", source: "EMS", text: "CPU 3 down — process pairs taking over", level: "crit" as const },
    { time: "14:02:04", source: "Measure", text: "Load shifted to CPUs 4-7", level: "warn" as const },
    { time: "14:05:30", source: "APM", text: "Payment authorization latency high", level: "crit" as const },
  ],
  disks: [
    { vol: "$SYSTEM", state: "STARTED", path: "PRIMARY/MIRROR" },
    { vol: "$DATA01", state: "STARTED", path: "PRIMARY/MIRROR" },
    { vol: "$DATA02", state: "STARTED", path: "MIRROR ONLY" },
    { vol: "$AUDIT", state: "STARTED", path: "PRIMARY/MIRROR" },
  ],
  tmf: { state: "STARTED", auditUsed: 64 },
};

export type Scenario = typeof paymentSlowdown;
export const SCENARIOS: Record<string, Scenario> = { [paymentSlowdown.id]: paymentSlowdown };
