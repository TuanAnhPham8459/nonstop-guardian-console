import type { EnvironmentAdapter, PolicyAdapter } from "./types";
import { mockEnvClassify, mockEnvReset, mockEnvRun, mockEnvState } from "@/lib/mock-env.functions";

// EnvironmentAdapter backed by the stateful "mock-env" backend.
export const mockEnvironment: EnvironmentAdapter = {
  runCommand: (cmd) => mockEnvRun({ data: { command: cmd } }),
  getState: () => mockEnvState(),
  reset: async () => { await mockEnvReset({ data: {} }); },
};

export const serverPolicy: PolicyAdapter = {
  classify: (cmd) => mockEnvClassify({ data: { command: cmd } }),
};
