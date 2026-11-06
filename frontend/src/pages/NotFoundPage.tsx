import { Link } from "react-router";

import { RampartMark } from "@/components/common/Brand";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <RampartMark className="size-8" />
      <div>
        <h1 className="text-lg font-semibold">There is nothing here</h1>
        <p className="mt-1 text-sm text-muted-foreground">The address does not match a page in Rampart.</p>
      </div>
      <Button asChild variant="outline">
        <Link to="/">Go to Conversations</Link>
      </Button>
    </div>
  );
}
