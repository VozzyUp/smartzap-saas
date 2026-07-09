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
import { completeConversation } from "@/lib/builder/workflow-conversations";

type ResumeWorkflowInput = {
  workflowId: string;
  conversationId: string;
  input?: {
    from?: string;
    to?: string;
    message?: string;
  };
};

export const { POST } = serve<ResumeWorkflowInput>(async (context) => {
  const { workflowId, conversationId, input } = context.requestPayload;
  if (!workflowId || !conversationId) {
    return {
      executionId: nanoid(),
      status: "failed",
      error: "Missing workflowId or conversationId",
    };
  }
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return {
      executionId: nanoid(),
      status: "failed",
      error: "Supabase not configured",
    };
  }

  const { data: conversation } = conversationId
    ? await supabase
        .from("workflow_conversations")
        .select("*")
        .eq("id", conversationId)
        .eq("status", "waiting")
        .maybeSingle()
    : { data: null };

  if (!conversation) {
    return {
      executionId: nanoid(),
      status: "failed",
      error: "Conversation not found",
    };
  }

  if (conversation.workflow_id !== workflowId) {
    return {
      executionId: nanoid(),
      status: "failed",
      error: "Conversation workflow mismatch",
    };
  }

  const resumeNodeId = conversation.resume_node_id;
  if (!resumeNodeId) {
    return {
      executionId: nanoid(),
      status: "failed",
      error: "Conversation missing resume node",
    };
  }

  const variableKey = conversation.variable_key;
  if (!variableKey) {
    return {
      executionId: nanoid(),
      status: "failed",
      error: "Conversation missing variable key",
    };
  }

  const incomingMessage = String(input?.message || "").trim();
  if (!incomingMessage) {
    return {
      executionId: nanoid(),
      status: "failed",
      error: "Missing inbound message",
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

  const executionId = nanoid();
  await supabase.from("workflow_runs").insert({
    id: executionId,
    workflow_id: workflowId,
    version_id: record.workflow.active_version_id,
    status: "running",
    trigger_type: "Resume",
    input: input ?? {},
    started_at: new Date().toISOString(),
  });

  const conversationVars =
    (conversation.variables as Record<string, unknown> | null) || {};
  const nextVariables = {
    ...conversationVars,
    [variableKey]: incomingMessage,
  };
  const fromPhone = String(
    input?.from || conversation.phone || input?.to || ""
  );

  const execution = await context.run(`execute-workflow-${workflowId}`, () =>
    executeWorkflow({
      tenantId: record.workflow.tenant_id,
      nodes: workflow.nodes,
      edges: workflow.edges,
      triggerInput: {
        from: fromPhone,
        to: fromPhone,
        message: incomingMessage,
      },
      executionId,
      workflowId,
      startNodeIds: [resumeNodeId],
      initialVariables: nextVariables,
    })
  );

  await completeConversation(supabase, conversation.id, nextVariables);

  return {
    executionId,
    status: execution.success ? "success" : "failed",
    output: execution,
  };
});
