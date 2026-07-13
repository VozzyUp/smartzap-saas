import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getTenantContext } from "@/lib/tenant-context";
import {
  ensureWorkflowRecord,
  getCompanyId,
  toSavedWorkflow,
} from "@/lib/builder/workflow-db";

type RouteParams = {
  params: Promise<{ workflowId: string }>;
};

export async function GET(_request: Request, { params }: RouteParams) {
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
  const workflow = toSavedWorkflow(record);
  return NextResponse.json({
    name: workflow.name,
    workflow,
  });
}
