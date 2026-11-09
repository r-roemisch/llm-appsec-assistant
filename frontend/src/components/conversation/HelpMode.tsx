import { LifeBuoyIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface HelpModeToggleProps {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  disabled?: boolean;
}

/** The composer's switch between normal answers and answers from Rampart's guides. */
export function HelpModeToggle({ pressed, onPressedChange, disabled }: HelpModeToggleProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Help mode"
          aria-pressed={pressed}
          disabled={disabled}
          onClick={() => onPressedChange(!pressed)}
          className={cn(
            "text-muted-foreground",
            pressed && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary dark:hover:bg-primary/20",
          )}
        >
          <LifeBuoyIcon />
          <span className="hidden sm:inline">Help mode</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{pressed ? "Turn help mode off" : "Answer only from Rampart's own guides"}</TooltipContent>
    </Tooltip>
  );
}

/** Shown at the top of the composer while help mode is on. */
export function HelpModeNotice() {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pt-2.5 text-xs text-muted-foreground">
      <Badge className="bg-primary/10 text-primary">
        <LifeBuoyIcon aria-hidden="true" />
        Help mode
      </Badge>
      <span>Answers come only from Rampart's guides.</span>
    </div>
  );
}
