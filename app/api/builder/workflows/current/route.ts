import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getTenantContext } from "@/lib/tenant-context";
import {
  createWorkflowRecord,
  ensureWorkflowRecord,
  getCompanyId,
  listWorkflowRecords,
  toSavedWorkflow,
  updateWorkflowRecord,
} from "@/lib/builder/workflow-db";

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx?.tenantId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 400 }
    );
  }
  const companyId = await getCompanyId(supabase, ctx.tenantId);
  const records = await listWorkflowRecords(supabase, ctx.tenantId, companyId);
  if (records.length > 0) {
    return NextResponse.json(toSavedWorkflow(records[0]));
  }
  const created = await createWorkflowRecord(
    supabase,
    ctx.tenantId,
    {
      name: "Current Workflow",
      nodes: [],
      edges: [],
    },
    companyId
  );
  return NextResponse.json(toSavedWorkflow(created));
}

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx?.tenantId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 400 }
    );
  }
  const body = await request.json().catch(() => ({}));
  const companyId = await getCompanyId(supabase, ctx.tenantId);
  const records = await listWorkflowRecords(supabase, ctx.tenantId, companyId);
  const workflowId = records[0]?.workflow.id ?? null;
  const record = workflowId
    ? await updateWorkflowRecord(supabase, ctx.tenantId, workflowId, {
        nodes: Array.isArray(body?.nodes) ? body.nodes : [],
        edges: Array.isArray(body?.edges) ? body.edges : [],
      })
    : await createWorkflowRecord(
        supabase,
        ctx.tenantId,
        {
          name: "Current Workflow",
          nodes: Array.isArray(body?.nodes) ? body.nodes : [],
          edges: Array.isArray(body?.edges) ? body.edges : [],
        },
        companyId
      );
  return NextResponse.json(toSavedWorkflow(record));
}
