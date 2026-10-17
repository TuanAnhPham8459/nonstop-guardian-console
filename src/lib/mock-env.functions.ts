import { createServerFn } from "@tanstack/react-start";
import { getState, resetScenario, runCommand, commandHelp, listScenarios, advanceTime } from "@/mock-env/engine.server";
import { validateCommand } from "@/mock-env/validate.server";

// "mock-env" backend: simulated NonStop environment. No real system access.
// Every function that receives a command goes through validateCommand().

export const mockEnvRun = createServerFn({ method: "POST" })
  .inputValidator((d: { command: string }) => ({ command: String(d?.command ?? "") }))
  .handler(async ({ data }) => {
    if (data.command.trim().toLowerCase() === "help")
      return { command: data.command, output: commandHelp(), exitCode: 0 };
    const v = validateCommand(data.command);
    if (!v.ok) return { command: data.command, output: [v.reason], exitCode: 1 };
    return runCommand(data.command);
  });

// Risk lookup for the UI/pipeline. Tier comes from the allowlist, never the model.
export const mockEnvClassify = createServerFn({ method: "POST" })
  .inputValidator((d: { command: string }) => ({ command: String(d?.command ?? "") }))
  .handler(async ({ data }) => {
    const v = validateCommand(data.command);
    if (!v.ok) return { allowed: false as const, reason: v.reason };
    return {
      allowed: true as const,
      risk: v.entry.risk,
      description: v.entry.description,
      blastRadius: v.entry.blastRadius ?? null,
      simulated: v.entry.syntaxStatus === "illustrative",
    };
  });

export const mockEnvState = createServerFn({ method: "GET" }).handler(async () => getState());

export const mockEnvReset = createServerFn({ method: "POST" })
  .inputValidator((d: { scenario?: string }) => ({ scenario: typeof d?.scenario === "string" ? d.scenario : undefined }))
  .handler(async ({ data }) => {
    resetScenario(data.scenario);
    return { ok: true };
  });

export const mockEnvScenarios = createServerFn({ method: "GET" }).handler(async () => listScenarios());

// "Advance 15 min" — moves the scenario clock and fires time events (e.g. hardware repaired).
export const mockEnvAdvanceTime = createServerFn({ method: "POST" }).handler(async () => advanceTime(15));
