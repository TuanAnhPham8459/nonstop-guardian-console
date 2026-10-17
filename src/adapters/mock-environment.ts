import type { EnvironmentAdapter, PolicyAdapter } from "./types";
import { mockEnvAdvanceTime, mockEnvClassify, mockEnvReset, mockEnvRun, mockEnvScenarios, mockEnvState } from "@/lib/mock-env.functions";

// EnvironmentAdapter backed by the stateful "mock-env" backend.
export const mockEnvironment: EnvironmentAdapter = {
  runCommand: (cmd, operationId) => mockEnvRun({ data: { command: cmd, operationId } }),
  getState: () => mockEnvState(),
  reset: async (scenario) => { await mockEnvReset({ data: scenario ? { scenario } : {} }); },
  listScenarios: () => mockEnvScenarios(),
  advanceTime: () => mockEnvAdvanceTime(),
};

export const serverPolicy: PolicyAdapter = {
  classify: (cmd) => mockEnvClassify({ data: { command: cmd } }),
};
