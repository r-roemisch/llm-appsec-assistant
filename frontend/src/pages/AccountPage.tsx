import { ChangePasswordForm } from "@/components/account/ChangePasswordForm";
import { MyUsage } from "@/components/account/MyUsage";
import { RoleBadge } from "@/components/common/ModelBadges";
import { PageHeader } from "@/components/shell/PageHeader";
import { useCurrentUser } from "@/hooks/useSession";
import { formatDateTime } from "@/lib/format";

export function AccountPage() {
  const user = useCurrentUser();

  return (
    <>
      <PageHeader title="Account" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-6 md:px-6 md:py-8">
          <section className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold">{user.username}</h2>
            <RoleBadge role={user.role} />
            <span className="text-sm text-muted-foreground">Member since {formatDateTime(user.created_at)}</span>
          </section>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
            <section className="space-y-4">
              <h2 className="text-base font-semibold">Change password</h2>
              <ChangePasswordForm />
            </section>
            <section className="space-y-4">
              <h2 className="text-base font-semibold">Your usage</h2>
              <MyUsage />
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
