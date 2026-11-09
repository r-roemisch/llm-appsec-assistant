import { LoadError, LoadingRows } from "@/components/common/QueryState";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { PageHeader } from "@/components/shell/PageHeader";
import { useProfile } from "@/hooks/useProfile";
import { useTargets } from "@/hooks/useTargets";

export function ProfilePage() {
  const profile = useProfile();
  const targets = useTargets();

  return (
    <>
      <PageHeader title="Project Profile" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
          <p className="max-w-prose text-[15px] leading-relaxed text-muted-foreground">
            The assistant receives this profile at the start of every turn as context from you. Attach your registered
            Targets so it can offer to run the injection suite against them.
          </p>
          {profile.isPending ? (
            <LoadingRows rows={4} label="Loading your Project Profile" />
          ) : profile.isError ? (
            <LoadError error={profile.error} onRetry={() => void profile.refetch()} />
          ) : (
            // A new server copy (saved or deleted) resets the form.
            <ProfileForm key={profile.data.updated_at ?? "none"} profile={profile.data} targets={targets.data ?? []} />
          )}
        </div>
      </div>
    </>
  );
}
