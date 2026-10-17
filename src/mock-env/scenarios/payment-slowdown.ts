// Scenario data loader. The data itself lives in ../scenarios.json — edit values there.
import data from "../scenarios.json";

export type Level = "crit" | "warn" | "info";

export interface StateChange {
  avgResponse?: number;
  avgResponseDelta?: number;
  queue?: number;
  queueDelta?: number;
  queueGrowing?: boolean;
  tps?: number;
  unprotected?: number;
  redundancy?: "FULL" | "REDUCED";
  cpuBusy?: number[];
  cpuDown?: number | null;
  hardwareTicket?: boolean;
  hardwareRepaired?: boolean;
  ownerResponse?: string;
  businessImpact?: boolean;
}

export interface ScenarioOption {
  id: string;
  tier: 0 | 1 | 2 | 3; // 0 read-only, 1 low, 2 high, 3 critical
  action: string; // the command string (must be on the allowlist)
  syntax_status: "confirmed" | "illustrative";
  risk: "read-only" | "low-risk" | "high-risk";
  requires?: string[]; // all must be executed
  requiresAny?: string[]; // at least one must be executed
  unlocks?: string[];
  one_time?: boolean;
  needs_second_operator?: boolean;
  trap?: boolean;
  outcome?: "OUTAGE";
  output?: string[];
  state_change?: StateChange;
  outcomes?: {
    success: { when: string; output: string[]; state_change?: StateChange };
    bad: { output: string[]; state_change?: StateChange };
  };
  risk_text?: string;
  notes?: string[];
}

export interface Scenario {
  id: string;
  label: string;
  title: string;
  opener: string;
  node: string;
  incident: { id: string; title: string; severity: "SEV1" | "SEV2" | "SEV3" };
  start: {
    clock: string; // "HH:MM"
    cpuDown: number | null;
    cpuBusy: number[];
    avgResponse: number;
    responseThreshold: number;
    queue: number;
    queueGrowing?: boolean;
    tps: number;
    unprotected: number;
    redundancy: "FULL" | "REDUCED";
    hardwareTicket?: boolean;
    hardwareRepaired?: boolean;
    ownerResponse?: string;
  };
  alerts: { time: string; source: string; text: string; level: Level }[];
  options: ScenarioOption[];
  timeEvents?: { afterOption: string; afterMinutes: number; set: StateChange; message: string }[];
  endStates: Record<string, string>;
}

export const SCENARIOS: Record<string, Scenario> = Object.fromEntries(
  (data.scenarios as Scenario[]).map((s) => [s.id, s]),
);
export const defaultScenario = SCENARIOS["cpu-failure"]!;
