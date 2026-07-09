import { serve } from "@upstash/workflow/nextjs";
import { nanoid } from "nanoid";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  ensureWorkflowRecord,
  getCompanyId,
  toSavedWorkflow,
} from "@/lib/builder/workflow-db";
import { executeWorkflow } from "@/lib/builder/workflow-executor.workflow";
import { validateWorkflowSchema } from "@/lib/shared/workflow-schema";

type BuilderWorkflowInput = {
  workflowId: string;
  input?: {
    to?: string;
    from?: string;
    message?: string;
    previewUrl?: boolean;
  };
  startNodeIds?: string[];
  initialVariables?: Record<string, unknown>;
};

export const { POST } = serve<BuilderWorkflowInput>(async (context) => {
  const { workflowId, input } = context.requestPayload;
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return {
      executionId: nanoid(),
      status: "failed",
      error: "Supabase not configured",
    };
  }
  const companyId = await getCompanyId(supabase);
  const record = await ensureWorkflowRecord(supabase, workflowId, companyId);
  const workflow = toSavedWorkflow(record);
  const validation = validateWorkflowSchema(workflow);
  if (!validation.success) {
    return {
      executionId: nanoid(),
      status: "failed",
      error: "Invalid workflow",
      details: validation.errors,
    };
  }

  const triggerNode = workflow.nodes.find(
    (node) => node.data.type === "trigger"
  );
  const triggerType = triggerNode?.data.config?.triggerType as
    | string
    | undefined;
  const inboundMessage = input?.message || "";

  const executionId = nanoid();
  await supabase.from("workflow_runs").insert({
    id: executionId,
    workflow_id: workflowId,
    version_id: record.workflow.active_version_id,
    status: "running",
    trigger_type: triggerType ?? null,
    input: input ?? {},
    started_at: new Date().toISOString(),
  });

  if (triggerType === "Keywords" && !context.requestPayload.startNodeIds) {
    const keywordListRaw = triggerNode?.data.config?.keywordList as
      | string
      | undefined;
    const keywords = (keywordListRaw || "")
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    const normalizedMessage = inboundMessage.toLowerCase();

    if (!normalizedMessage) {
      await supabase
        .from("workflow_runs")
        .update({
          status: "skipped",
          output: { reason: "missing_message" },
          finished_at: new Date().toISOString(),
        })
        .eq("id", executionId);
      return {
        executionId,
        status: "skipped",
        output: { reason: "missing_message" },
      };
    }

    const matched = keywords.some((keyword) =>
      normalizedMessage.includes(keyword.toLowerCase())
    );
    if (!matched) {
      await supabase
        .from("workflow_runs")
        .update({
          status: "skipped",
          output: { reason: "keyword_not_matched" },
          finished_at: new Date().toISOString(),
        })
        .eq("id", executionId);
      return {
        executionId,
        status: "skipped",
        output: { reason: "keyword_not_matched" },
      };
    }
  }

  const execution = await context.run(`execute-workflow-${workflowId}`, () =>
    executeWorkflow({
      tenantId: record.workflow.tenant_id,
      nodes: workflow.nodes,
      edges: workflow.edges,
      triggerInput: input ?? {},
      executionId,
      workflowId,
      startNodeIds: context.requestPayload.startNodeIds,
      initialVariables: context.requestPayload.initialVariables,
    })
  );

  return {
    executionId,
    status: execution.paused
      ? "waiting"
      : execution.success
        ? "success"
        : "failed",
    output: execution,
  };
});
