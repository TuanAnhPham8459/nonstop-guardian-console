import { createServerFn } from "@tanstack/react-start";
import { getState, resetScenario, runCommand, commandHelp } from "@/mock-env/engine";

// "mock-env" backend: simulated NonStop environment. No real system access.
// Note: state lives in server memory — fine for a prototype, resets on cold start.

export const mockEnvRun = createServerFn({ method: "POST" })
  .inputValidator((d: { command: string }) => ({ command: String(d.command).slice(0, 200) }))
  .handler(async ({ data }) => {
    if (data.command.trim().toLowerCase() === "help")
      return { command: data.command, output: commandHelp(), exitCode: 0 };
    return runCommand(data.command);
  });

export const mockEnvState = createServerFn({ method: "GET" }).handler(async () => getState());

export const mockEnvReset = createServerFn({ method: "POST" })
  .inputValidator((d: { scenario?: string }) => d)
  .handler(async ({ data }) => {
    resetScenario(data.scenario);
    return { ok: true };
  });
