import type { EnvironmentAdapter } from "./types";
import { mockEnvReset, mockEnvRun, mockEnvState } from "@/lib/mock-env.functions";

// EnvironmentAdapter backed by the stateful "mock-env" backend.
export const mockEnvironment: EnvironmentAdapter = {
  runCommand: (cmd) => mockEnvRun({ data: { command: cmd } }),
  getState: () => mockEnvState(),
  reset: async () => { await mockEnvReset({ data: {} }); },
};
