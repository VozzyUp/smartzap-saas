import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getTenantContext } from "@/lib/tenant-context";
import {
  buildDefaultGraph,
  createWorkflowRecord,
  getCompanyId,
  toSavedWorkflow,
} from "@/lib/builder/workflow-db";
import { validateWorkflowSchema } from "@/lib/shared/workflow-schema";

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
  const nodes = Array.isArray(body?.nodes) ? body.nodes : [];
  const edges = Array.isArray(body?.edges) ? body.edges : [];
  const graph =
    nodes.length === 0 && edges.length === 0 ? buildDefaultGraph() : null;
  let normalized = {
    name: body?.name,
    description: body?.description,
    nodes: graph ? graph.nodes : nodes,
    edges: graph ? graph.edges : edges,
    visibility: body?.visibility,
  };
  let validation = validateWorkflowSchema(normalized);
  if (!validation.success && nodes.length === 0 && edges.length === 0) {
    const fallback = buildDefaultGraph();
    normalized = {
      ...normalized,
      nodes: fallback.nodes,
      edges: fallback.edges,
    };
    validation = validateWorkflowSchema(normalized);
  }
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid workflow", details: validation.errors },
      { status: 400 }
    );
  }
  const companyId = await getCompanyId(supabase, ctx.tenantId);
  try {
    const record = await createWorkflowRecord(
      supabase,
      ctx.tenantId,
      normalized,
      companyId
    );
    const workflow = toSavedWorkflow(record);
    return NextResponse.json(workflow);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create workflow";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
