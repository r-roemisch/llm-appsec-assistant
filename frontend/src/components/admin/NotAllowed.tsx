import { ShieldOffIcon } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";

export function NotAllowed() {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <ShieldOffIcon className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
      <h2 className="mt-4 text-lg font-semibold">Not allowed</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        This page is for admins. Your account has the user role.
      </p>
      <Button asChild variant="outline" className="mt-6">
        <Link to="/">Back to Conversations</Link>
      </Button>
    </div>
  );
}
