import { NextResponse } from "next/server";
import { settingsDb } from "@/lib/supabase-db";
import { getTenantContext } from "@/lib/tenant-context";

const SETTINGS_KEY = "workflow_builder_default_id";

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx?.tenantId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const value = await settingsDb.get(ctx.tenantId, SETTINGS_KEY);
  return NextResponse.json({ defaultWorkflowId: value || "" });
}

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx?.tenantId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const defaultWorkflowId = String(body?.defaultWorkflowId || "").trim();
  await settingsDb.set(ctx.tenantId, SETTINGS_KEY, defaultWorkflowId);
  return NextResponse.json({ defaultWorkflowId });
}
