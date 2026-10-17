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
  title: string;
  snippet: string;
}
export interface KnowledgeAdapter {
  search(query: string): Promise<KnowledgeHit[]>;
}

export interface ModelRequest {
  question: string;
  context: string;
  knowledge: KnowledgeHit[];
}
export interface ModelResponse {
  text: string;
  proposedCommand?: string;
}
export interface ModelAdapter {
  complete(req: ModelRequest): Promise<ModelResponse>;
}

export interface AuditEvent {
  at: string;
  actor: "operator" | "assistant" | "system";
  action: string;
  detail?: string;
}
export interface AuditAdapter {
  log(event: Omit<AuditEvent, "at">): void;
  entries(): AuditEvent[];
}
