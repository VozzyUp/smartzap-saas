import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getTenantContext } from "@/lib/tenant-context";
import {
  getCompanyId,
  listWorkflowRecords,
  toSavedWorkflow,
} from "@/lib/builder/workflow-db";

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx?.tenantId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json([]);
  }

  const companyId = await getCompanyId(supabase, ctx.tenantId);
  const records = await listWorkflowRecords(supabase, ctx.tenantId, companyId);
  return NextResponse.json(records.map((record) => toSavedWorkflow(record)));
}
