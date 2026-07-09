import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  createNewVersion,
  ensureWorkflowRecord,
  getCompanyId,
} from "@/lib/builder/workflow-db";
import { syncWorkflowSchedule, clearWorkflowSchedule } from "@/lib/builder/workflow-schedule";
import { settingsDb } from "@/lib/supabase-db";
import { getTenantContext } from "@/lib/tenant-context";

type RouteParams = {
  params: Promise<{ workflowId: string }>;
};

export async function POST(_request: Request, { params }: RouteParams) {
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

  const companyId = await getCompanyId(supabase);
  const record = await ensureWorkflowRecord(supabase, workflowId, companyId);

  const previousVersionId = record.workflow.active_version_id;
  const published = await createNewVersion(supabase, workflowId, {
    nodes: record.version.nodes,
    edges: record.version.edges,
    status: "published",
  });

  const now = new Date().toISOString();
  await supabase.from("workflows").update({
    active_version_id: published.id,
    status: "published",
    updated_at: now,
  }).eq("id", workflowId);

  if (previousVersionId) {
    await supabase
      .from("workflow_versions")
      .update({ status: "archived", updated_at: now })
      .eq("id", previousVersionId);
  }

  const triggerNode = record.version.nodes.find(
    (node) => node.data.type === "trigger"
  );
  const triggerType = triggerNode?.data.config?.triggerType as string | undefined;
  if (triggerType === "Schedule") {
    const cron = String(triggerNode?.data.config?.scheduleCron || "").trim();
    const timezone = triggerNode?.data.config?.scheduleTimezone
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

  return NextResponse.json({
    success: true,
    versionId: published.id,
    version: published.version,
  });
}
