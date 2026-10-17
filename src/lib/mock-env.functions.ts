import { createServerFn } from "@tanstack/react-start";
import { listScenarios } from "@/mock-env/engine.server";
import { simulationSession } from "@/mock-env/session.server";
import { validateCommand } from "@/mock-env/validate.server";
import { z } from "zod";

// "mock-env" backend: simulated NonStop environment. No real system access.
// Every function that receives a command goes through validateCommand().

export const mockEnvRun = createServerFn({ method: "POST" })
  .inputValidator((d: { command: string; operationId?: string | undefined }) => z.object({ command: z.string().max(200), operationId: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data }) => {
    const value = await simulationSession("run", data);
    if (!value.result) throw new Error("Missing simulated execution result");
    return value.result;
  });

// Risk lookup for the UI/pipeline. Tier comes from the allowlist, never the model.
export const mockEnvClassify = createServerFn({ method: "POST" })
  .inputValidator((d: { command: string }) => ({ command: String(d?.command ?? "") }))
  .handler(async ({ data }) => {
    const v = validateCommand(data.command.replace(/\s+CONFIRMED\s*$/i, ""));
    if (!v.ok) return { allowed: false as const, reason: v.reason };
    return {
      allowed: true as const,
      risk: v.entry.risk,
      description: v.entry.description,
      blastRadius: v.entry.blastRadius ?? null,
      simulated: v.entry.syntaxStatus === "illustrative",
    };
  });

export const mockEnvState = createServerFn({ method: "GET" }).handler(async () => (await simulationSession()).state);

export const mockEnvReset = createServerFn({ method: "POST" })
  .inputValidator((d: { scenario?: string }) => ({ scenario: typeof d?.scenario === "string" ? d.scenario : undefined }))
  .handler(async ({ data }) => {
    await simulationSession("reset", data);
    return { ok: true };
  });

export const mockEnvScenarios = createServerFn({ method: "GET" }).handler(async () => listScenarios());

// "Advance 15 min" — moves the scenario clock and fires time events (e.g. hardware repaired).
export const mockEnvAdvanceTime = createServerFn({ method: "POST" }).handler(async () => {
  const value = await simulationSession("advance");
  return { clock: value.clock, messages: value.messages, state: value.state };
});
