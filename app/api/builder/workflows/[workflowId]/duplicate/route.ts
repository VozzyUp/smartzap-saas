import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getTenantContext } from "@/lib/tenant-context";
import {
  createWorkflowRecord,
  ensureWorkflowRecord,
  getCompanyId,
  toSavedWorkflow,
} from "@/lib/builder/workflow-db";

type RouteParams = {
  params: Promise<{ workflowId: string }>;
};

export async function POST(_request: Request, { params }: RouteParams) {
  const ctx = await getTenantContext();
  if (!ctx?.tenantId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { workflowId } = await params;
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 400 }
    );
  }
  const companyId = await getCompanyId(supabase, ctx.tenantId);
  const record = await ensureWorkflowRecord(supabase, ctx.tenantId, workflowId, companyId);
  const duplicate = await createWorkflowRecord(
    supabase,
    ctx.tenantId,
    {
      name: `${record.workflow.name} Copy`,
      description: record.workflow.description ?? undefined,
      nodes: record.version.nodes,
      edges: record.version.edges,
    },
    companyId
  );
  return NextResponse.json(toSavedWorkflow(duplicate));
}
