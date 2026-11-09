import { PuzzleIcon } from "lucide-react";

/**
 * What approving a Plugin Tool (M5) means: it is not part of Rampart but
 * third-party code that runs on the server, and its output is untrusted.
 */
export function PluginApprovalNote({ pluginId }: { pluginId: string }) {
  return (
    <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs">
      <PuzzleIcon aria-hidden="true" className="mt-px size-3.5 shrink-0 text-warning" />
      <span>
        This Tool comes from the Plugin <span className="font-mono font-medium wrap-anywhere">{pluginId}</span>:
        third-party code that runs on the Rampart server, not part of Rampart itself. Approve only a call you expect,
        with these arguments; whatever it returns is treated as untrusted data.
      </span>
    </p>
  );
}
