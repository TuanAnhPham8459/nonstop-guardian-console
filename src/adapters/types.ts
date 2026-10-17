// Swappable backend adapter contracts. Core pipeline depends ONLY on these.

export type CpuStatus = "ok" | "warn" | "crit" | "down";

export interface SystemState {
  node: string;
  cpus: { id: number; busy: number; status: CpuStatus }[];
  tps: number;
  responseMs: number;
  incident: {
    id: string;
    title: string;
    severity: "SEV1" | "SEV2" | "SEV3";
    firstAlertAt: number;
    alerts: { time: string; source: string; text: string; level: "crit" | "warn" | "info" }[];
  };
}

export interface CommandResult {
  command: string;
  output: string[];
  exitCode: number;
  risk?: string;
}

export interface EnvironmentAdapter {
  runCommand(cmd: string): Promise<CommandResult>;
  getState(): Promise<SystemState>;
  reset(): Promise<void>;
}

export interface KnowledgeHit {
  id: string;
  title: string;
  snippet: string;
}
export interface KnowledgeAdapter {
  search(query: string): Promise<KnowledgeHit[]>;
  get(id: string): Promise<KnowledgeHit | null>;
  contribute(d: Debrief): Promise<{ id: string } | { error: string }>;
}

export interface ModelRequest {
  question: string;
  state: unknown;
}
export interface CheckedCommand {
  command: string;
  reason: string;
  sources: string[];
  unknown_sources: string[];
  confidence: number;
  risk: "read-only" | "low-risk" | "high-risk";
  description: string;
  blast_radius: string | null;
}
export type ModelResponse =
  | {
      ok: true;
      explanation: string;
      proposed_commands: CheckedCommand[];
      blocked: { command: string; reason: string }[];
      uncertainty: string;
    }
  | { ok: false; error: string };
// Backed by the server "assistant" function (allowlist, sources and risk enforced there).
export interface ModelAdapter {
  complete(req: ModelRequest): Promise<ModelResponse>;
}

export type AuditEventType =
  | "question" | "proposed" | "blocked" | "approved" | "rejected" | "output" | "interpretation" | "debrief" | "error" | "proactive";
export interface AuditEvent {
  actor: "operator" | "assistant" | "system";
  event_type: AuditEventType;
  question?: string;
  command?: string;
  risk?: string;
  output?: string;
  interpretation?: string;
  detail?: string;
}
export interface AuditRecord extends AuditEvent {
  id: string;
  created_at: string;
  session_id: string;
}
export interface AuditAdapter {
  log(event: AuditEvent): void; // fire-and-forget append
  list(): Promise<AuditRecord[]>;
}

export type Classification =
  | { allowed: false; reason: string }
  | { allowed: true; risk: "read-only" | "low-risk" | "high-risk"; description: string; blastRadius: string | null };
// Server-side allowlist lookup. Risk tier comes from here, never from the ModelAdapter.
export interface PolicyAdapter {
  classify(cmd: string): Promise<Classification>;
}

export interface Debrief {
  incident: string;
  suspicion: string;
  checkedFirst: string;
  adviceNext: string;
  operator: string;
}
