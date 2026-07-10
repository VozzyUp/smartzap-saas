import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getCompanyId } from "@/lib/builder/workflow-db";
import { clearWorkflowSchedule, syncWorkflowSchedule } from "@/lib/builder/workflow-schedule";
import { settingsDb } from "@/lib/supabase-db";
import { getTenantContext } from "@/lib/tenant-context";

type RouteParams = {
  params: Promise<{ workflowId: string }>;
};

export async function POST(request: Request, { params }: RouteParams) {
  const ctx = await getTenantContext();
  if (!ctx?.tenantId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { workflowId } = await params;
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const versionId = typeof body?.versionId === "string" ? body.versionId : null;
  if (!versionId) {
    return NextResponse.json(
      { error: "versionId is required" },
      { status: 400 }
    );
  }

  const { data: selectedVersion } = await supabase
    .from("workflow_versions")
    .select("id, workflow_id")
    .eq("id", versionId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle<{ id: string; workflow_id: string }>();

  if (!selectedVersion || selectedVersion.workflow_id !== workflowId) {
    return NextResponse.json(
      { error: "Version not found" },
      { status: 404 }
    );
  }

  const now = new Date().toISOString();
  await supabase.from("workflows").update({
    active_version_id: versionId,
    status: "published",
    updated_at: now,
  }).eq("id", workflowId).eq("tenant_id", ctx.tenantId);

  await supabase
    .from("workflow_versions")
    .update({ status: "archived", updated_at: now })
    .eq("workflow_id", workflowId)
    .eq("tenant_id", ctx.tenantId)
    .neq("id", versionId);

  await supabase
    .from("workflow_versions")
    .update({ status: "published", updated_at: now })
    .eq("id", versionId)
    .eq("tenant_id", ctx.tenantId);

  const { data: versionData } = await supabase
    .from("workflow_versions")
    .select("nodes")
    .eq("id", versionId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle<{ nodes: Array<{ data?: { type?: string; config?: Record<string, unknown> } }> }>();

  const triggerNode = versionData?.nodes.find((node) => node.data?.type === "trigger");
  const triggerType = triggerNode?.data?.config?.triggerType as string | undefined;
  if (triggerType === "Schedule") {
    const cron = String(triggerNode?.data?.config?.scheduleCron || "").trim();
    const timezone = triggerNode?.data?.config?.scheduleTimezone
      ? String(triggerNode.data.config.scheduleTimezone)
      : null;
    if (cron) {
      const secret =
        (await settingsDb.get(ctx.tenantId, "workflow_builder_webhook_secret")) ||
        process.env.WORKFLOW_BUILDER_WEBHOOK_SECRET ||
        null;
      await syncWorkflowSchedule({
        workflowId,
        cron,
        timezone,
        secret,
      });
    }
  } else {
    await clearWorkflowSchedule(workflowId);
  }

  const companyId = await getCompanyId(supabase, ctx.tenantId);

  return NextResponse.json({ success: true, versionId, companyId });
}
