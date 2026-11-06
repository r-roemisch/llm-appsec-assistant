import { useSearchParams } from "react-router";

import { AdminUsageTab } from "@/components/admin/AdminUsageTab";
import { ModelsTab } from "@/components/admin/ModelsTab";
import { NotAllowed } from "@/components/admin/NotAllowed";
import { UsersTab } from "@/components/admin/UsersTab";
import { PageHeader } from "@/components/shell/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCurrentUser } from "@/hooks/useSession";

const TABS = ["users", "models", "usage"] as const;
type Tab = (typeof TABS)[number];

function isTab(value: string | null): value is Tab {
  return TABS.some((tab) => tab === value);
}

export function AdminPage() {
  const user = useCurrentUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("tab");
  const tab: Tab = isTab(requested) ? requested : "users";

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
            <TabsList variant="line">
              <TabsTrigger value="users">Users</TabsTrigger>
              <TabsTrigger value="models">Models</TabsTrigger>
              <TabsTrigger value="usage">Usage</TabsTrigger>
            </TabsList>
            <TabsContent value="users" className="pt-6">
              <UsersTab />
            </TabsContent>
            <TabsContent value="models" className="pt-6">
              <ModelsTab />
            </TabsContent>
            <TabsContent value="usage" className="pt-6">
              <AdminUsageTab />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  );
}
