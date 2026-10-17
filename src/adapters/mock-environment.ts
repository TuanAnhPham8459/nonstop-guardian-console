import type { EnvironmentAdapter, PolicyAdapter } from "./types";
import { mockEnvClassify, mockEnvReset, mockEnvRun, mockEnvScenarios, mockEnvState } from "@/lib/mock-env.functions";

// EnvironmentAdapter backed by the stateful "mock-env" backend.
export const mockEnvironment: EnvironmentAdapter = {
  runCommand: (cmd) => mockEnvRun({ data: { command: cmd } }),
  getState: () => mockEnvState(),
  reset: async (scenario) => { await mockEnvReset({ data: { scenario } }); },
  listScenarios: () => mockEnvScenarios(),
};

export const serverPolicy: PolicyAdapter = {
  classify: (cmd) => mockEnvClassify({ data: { command: cmd } }),
};
