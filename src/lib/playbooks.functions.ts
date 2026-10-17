import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { approvePlaybook, listPlaybooks, savePlaybook } from "@/playbooks/playbooks.server";
import { ALLOWLIST } from "@/mock-env/allowlist.server";
import { SCENARIOS } from "@/mock-env/scenarios/payment-slowdown";
import { simulationSession } from "@/mock-env/session.server";

export const listPlaybooksFn = createServerFn({ method: "GET" }).handler(async () => listPlaybooks());

const condition = z.object({
  metric: z.string().min(1).max(40),
  operator: z.enum([">", ">=", "<", "<=", "=", "!="]),
  value: z.union([z.number(), z.string().max(40)]),
});
const step = z.object({
  option_id: z.string().min(1).max(20),
  action: z.string().min(1).max(200),
  why: z.string().max(1000),
  check_after: z.string().max(500).optional(),
});
const playbookInput = z.object({
  id: z.string().max(50).optional(),
  title: z.string().trim().min(1).max(200),
  author: z.string().trim().min(1).max(100),
  trigger: z.array(condition).max(10),
  steps: z.array(step).min(1).max(50),
  stop_conditions: z.string().max(1000),
  escalate_if: z.string().max(1000),
  never_do: z.array(z.string().max(20)).max(50),
});

export const savePlaybookFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => playbookInput.parse(d))
  .handler(async ({ data }) => savePlaybook(data));

export const approvePlaybookFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().max(50), approver: z.string().trim().min(1).max(100) }).parse(d))
  .handler(async ({ data }) => approvePlaybook(data.id, data.approver));

// Catalog for the steps dropdown: scenario options + confirmed commands. No free text.
export const listCatalogFn = createServerFn({ method: "GET" }).handler(async () =>
  Object.values(SCENARIOS).flatMap((sc) =>
    sc.options.map((o) => ({
      option_id: o.id,
      action: o.action,
      risk: o.risk,
      scenario: sc.id,
      description: ALLOWLIST.find((c) => c.pattern === o.action)?.description ?? "",
    })),
  ),
);

// Options already executed in the current incident — used by "Convert to playbook".
export const executedOptionsFn = createServerFn({ method: "GET" }).handler(async () => {
  const ids = (await simulationSession()).executed;
  const sc = Object.values(SCENARIOS).find((s) => s.options.some((o) => ids.includes(o.id)));
  return ids.map((id) => {
    const o = sc?.options.find((x) => x.id === id);
    return o ? { option_id: o.id, action: o.action } : null;
  }).filter((x): x is { option_id: string; action: string } => x !== null);
});
