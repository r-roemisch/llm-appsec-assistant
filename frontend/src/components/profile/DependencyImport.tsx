import { FileUpIcon } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useImportDependencyFile, usePreviewDependencyFile } from "@/hooks/useProfile";
import { errorMessage } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import type { DependencyFileOut } from "@/lib/types";

/** Rows of the preview shown before "Show all". */
const PREVIEW_ROWS = 20;
/** The largest file the page reads; the server refuses more. */
const MAX_FILE_BYTES = 5_000_000;

/**
 * (M7) Import a Dependency File into the Project Profile: paste it or choose a file, review what
 * the server read from it, then merge it into the packages (or replace them). The server parses
 * the file without a Model and never stores it.
 */
export function DependencyImport() {
  const preview = usePreviewDependencyFile();
  const importFile = useImportDependencyFile();
  const fileInput = useRef<HTMLInputElement>(null);
  const [content, setContent] = useState("");
  const [filename, setFilename] = useState<string | null>(null);
  const [replace, setReplace] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [result, setResult] = useState<DependencyFileOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = preview.isPending || importFile.isPending;

  function reset(nextContent: string, nextName: string | null) {
    setContent(nextContent);
    setFilename(nextName);
    setResult(null);
    setShowAll(false);
    setError(null);
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError(`The file is larger than ${formatNumber(MAX_FILE_BYTES / 1_000_000)} MB.`);
      return;
    }
    reset(await file.text(), file.name);
  }

  function onPreview() {
    setError(null);
    preview.mutate({ content, filename }, { onSuccess: setResult, onError: (err) => setError(errorMessage(err)) });
  }

  function onImport() {
    setError(null);
    importFile.mutate(
      { content, filename, replace },
      { onSuccess: () => reset("", null), onError: (err) => setError(errorMessage(err)) },
    );
  }

  const rows = result ? (showAll ? result.packages : result.packages.slice(0, PREVIEW_ROWS)) : [];

  return (
    <section aria-labelledby="dependency-import-title" className="space-y-4 rounded-xl border p-4">
      <div className="space-y-1">
        <h2 id="dependency-import-title" className="text-sm font-medium">
          Import a Dependency File
        </h2>
        <p className="text-xs text-muted-foreground">
          requirements.txt, uv.lock, poetry.lock, package-lock.json, pyproject.toml or package.json. Rampart reads the
          package names and versions without a model and does not keep the file. Packages without an exact version are
          kept but cannot be checked for vulnerabilities.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <Label htmlFor="dependency-file-content">File contents</Label>
          <div className="flex items-center gap-2">
            {filename ? <span className="truncate font-mono text-xs text-muted-foreground">{filename}</span> : null}
            <input
              ref={fileInput}
              type="file"
              accept=".txt,.in,.lock,.json,.toml"
              className="sr-only"
              aria-label="Choose a Dependency File"
              onChange={(event) => void onFile(event)}
            />
            <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={pending}>
              <FileUpIcon />
              Choose file
            </Button>
          </div>
        </div>
        <Textarea
          id="dependency-file-content"
          value={content}
          onChange={(event) => reset(event.target.value, filename)}
          disabled={pending}
          placeholder={"django==4.2.1\nrequests==2.25.0"}
          className="min-h-24 font-mono text-xs"
          spellCheck={false}
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="space-y-3">
          <p className="text-sm">
            Read as <span className="font-mono">{result.format}</span>: {formatNumber(result.packages.length)} packages,{" "}
            {formatNumber(result.pinned)} with an exact version, {formatNumber(result.unpinned)} without.
          </p>
          {result.packages.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Ecosystem</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Version</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((pkg) => (
                    <tr key={`${pkg.ecosystem}:${pkg.name}:${pkg.version ?? ""}`} className="border-t">
                      <td className="px-3 py-1.5">{pkg.ecosystem}</td>
                      <td className="px-3 py-1.5 font-mono break-all">{pkg.name}</td>
                      <td className="px-3 py-1.5">
                        {pkg.pinned ? <span className="font-mono">{pkg.version}</span> : <Badge variant="outline">no exact version</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {result.packages.length > PREVIEW_ROWS && !showAll ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll(true)}>
              Show all {formatNumber(result.packages.length)}
            </Button>
          ) : null}
          {result.skipped.length > 0 ? (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">{formatNumber(result.skipped.length)} lines not read</summary>
              <ul className="mt-2 space-y-1 font-mono">
                {result.skipped.map((line) => (
                  <li key={line} className="break-all">
                    {line}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={replace}
              onChange={(event) => setReplace(event.target.checked)}
              disabled={pending}
              className="size-4 accent-primary"
            />
            Replace all packages in the profile
          </label>
          <p className="text-xs text-muted-foreground">
            {replace
              ? "The profile's package list becomes exactly this file's packages."
              : "Packages already in the profile take the versions from this file; new ones are added; nothing is removed."}{" "}
            The import is saved at once, and unsaved edits in the form below are discarded.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={onPreview} disabled={pending || !content.trim()}>
          {preview.isPending ? "Reading" : "Preview"}
        </Button>
        <Button type="button" onClick={onImport} disabled={pending || !result || result.packages.length === 0}>
          {importFile.isPending ? "Importing" : "Add to profile"}
        </Button>
      </div>
    </section>
  );
}
