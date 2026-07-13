import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  ensureWorkflowRecord,
  getCompanyId,
  toSavedWorkflow,
} from "@/lib/builder/workflow-db";
import { executeWorkflow } from "@/lib/builder/workflow-executor.workflow";
import { settingsDb } from "@/lib/supabase-db";

type RouteParams = {
  params: Promise<{ workflowId: string }>;
};

export async function POST(request: Request, { params }: RouteParams) {
  const { workflowId } = await params;
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 400 }
    );
  }

  // Rota disparada por webhook externo (secret no header, sem sessão de
  // usuário) — deriva o tenant do próprio recurso, mesmo padrão do fix de
  // campaign/dispatch na Fase 2A.
  const { data: workflowRow } = await supabase
    .from("workflows")
    .select("tenant_id")
    .eq("id", workflowId)
    .maybeSingle<{ tenant_id: string }>();
  if (!workflowRow?.tenant_id) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }
  const tenantId = workflowRow.tenant_id;

  const body = await request.json().catch(() => ({}));
  const companyId = await getCompanyId(supabase, tenantId);
  const record = await ensureWorkflowRecord(supabase, tenantId, workflowId, companyId);
  const workflow = toSavedWorkflow(record);

  const secret =
    (await settingsDb.get(tenantId, "workflow_builder_webhook_secret")) ||
    process.env.WORKFLOW_BUILDER_WEBHOOK_SECRET ||
    null;
  const provided = request.headers.get("x-workflow-secret");
  if (secret && provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const executionId = nanoid();
  await supabase.from("workflow_runs").insert({
    id: executionId,
    tenant_id: tenantId,
    workflow_id: workflowId,
    version_id: record.workflow.active_version_id,
    status: "running",
    trigger_type: "Webhook",
    input: body ?? {},
    started_at: new Date().toISOString(),
  });

  const execution = await executeWorkflow({
    tenantId,
    nodes: workflow.nodes,
    edges: workflow.edges,
    triggerInput: body ?? {},
    executionId,
    workflowId,
  });

  return NextResponse.json({
    executionId,
    status: execution.success ? "success" : "failed",
    output: execution,
  });
}
