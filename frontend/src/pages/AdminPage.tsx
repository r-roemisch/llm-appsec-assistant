import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router";

import { AdminUsageTab } from "@/components/admin/AdminUsageTab";
import { ApprovalsTab } from "@/components/admin/ApprovalsTab";
import { AuditTab } from "@/components/admin/AuditTab";
import { EvaluationTab } from "@/components/admin/EvaluationTab";
import { FeedbackTab } from "@/components/admin/FeedbackTab";
import { ModelsTab } from "@/components/admin/ModelsTab";
import { NotAllowed } from "@/components/admin/NotAllowed";
import { PluginsTab } from "@/components/admin/PluginsTab";
import { SettingsTab } from "@/components/admin/SettingsTab";
import { ToolsTab } from "@/components/admin/ToolsTab";
import { UsersTab } from "@/components/admin/UsersTab";
import { PageHeader } from "@/components/shell/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePendingAdminApprovals } from "@/hooks/useAdmin";
import { usePlugins } from "@/hooks/usePlugins";
import { useCurrentUser } from "@/hooks/useSession";
import { needsReview } from "@/lib/plugins";

const TABS = [
  "users",
  "models",
  "usage",
  "tools",
  "plugins",
  "approvals",
  "audit",
  "feedback",
  "evaluation",
  "settings",
] as const;
type Tab = (typeof TABS)[number];

function isTab(value: string | null): value is Tab {
  return TABS.some((tab) => tab === value);
}

function TabCount({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={label}
      className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-warning/15 px-1 text-[0.6875rem] font-semibold text-warning tabular-nums"
    >
      {count}
    </span>
  );
}

/** The Approvals tab, with the number of Approvals that wait for an administrator. */
function ApprovalsTrigger() {
  const pending = usePendingAdminApprovals();
  const count = pending.data?.length ?? 0;
  return (
    <TabsTrigger value="approvals">
      Approvals
      <TabCount count={count} label={`${count} waiting`} />
    </TabsTrigger>
  );
}

/** The Plugins tab, with the number of Plugins whose definitions wait for a review (first listing or drift). */
function PluginsTrigger() {
  const plugins = usePlugins();
  const count = plugins.data?.plugins.filter(needsReview).length ?? 0;
  return (
    <TabsTrigger value="plugins">
      Plugins
      <TabCount count={count} label={`${count} to review`} />
    </TabsTrigger>
  );
}

export function AdminPage() {
  const user = useCurrentUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("tab");
  const tab: Tab = isTab(requested) ? requested : "users";
  const strip = useRef<HTMLDivElement>(null);

  // On a phone the strip scrolls; keep the open tab in view (for example after a link to ?tab=settings).
  useEffect(() => {
    strip.current?.querySelector('[role="tab"][data-state="active"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);

  if (user.role !== "admin") {
    return (
      <>
        <PageHeader title="Admin" />
        <NotAllowed />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Admin" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">
          <Tabs value={tab} onValueChange={(value) => setSearchParams({ tab: value }, { replace: true })}>
            {/* Ten tabs do not fit a phone: the strip scrolls sideways instead of the page. */}
            <div ref={strip} className="-mx-4 overflow-x-auto px-4 pb-1.5 md:mx-0 md:px-0">
              <TabsList variant="line" className="w-max">
                <TabsTrigger value="users">Users</TabsTrigger>
                <TabsTrigger value="models">Models</TabsTrigger>
                <TabsTrigger value="usage">Usage</TabsTrigger>
                <TabsTrigger value="tools">Tools</TabsTrigger>
                <PluginsTrigger />
                <ApprovalsTrigger />
                <TabsTrigger value="audit">Audit</TabsTrigger>
                <TabsTrigger value="feedback">Feedback</TabsTrigger>
                <TabsTrigger value="evaluation">Evaluation</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="users" className="pt-5">
              <UsersTab />
            </TabsContent>
            <TabsContent value="models" className="pt-5">
              <ModelsTab />
            </TabsContent>
            <TabsContent value="usage" className="pt-5">
              <AdminUsageTab />
            </TabsContent>
            <TabsContent value="tools" className="pt-5">
              <ToolsTab />
            </TabsContent>
            <TabsContent value="plugins" className="pt-5">
              <PluginsTab />
            </TabsContent>
            <TabsContent value="approvals" className="pt-5">
              <ApprovalsTab />
            </TabsContent>
            <TabsContent value="audit" className="pt-5">
              <AuditTab />
            </TabsContent>
            <TabsContent value="feedback" className="pt-5">
              <FeedbackTab />
            </TabsContent>
            <TabsContent value="evaluation" className="pt-5">
              <EvaluationTab />
            </TabsContent>
            <TabsContent value="settings" className="pt-5">
              <SettingsTab />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  );
}
