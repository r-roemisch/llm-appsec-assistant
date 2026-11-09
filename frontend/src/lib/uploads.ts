import { formatBytes, formatNumber } from "@/lib/format";
import type { KnowledgeStatusOut } from "@/lib/types";

/** ".md" for "Notes.MD"; "" without an extension (a dotfile has none). */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/** "a", "a or b", "a, b or c". */
function joinOr(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/**
 * Why `file` cannot be uploaded, checked before sending, or null. The server
 * checks the count, the type (by content as well) and the size again and has
 * the last word.
 */
export function checkUpload(file: Pick<File, "name" | "size">, status: KnowledgeStatusOut): string | null {
  if (status.uploads >= status.max_uploads) {
    return `You already have ${formatNumber(status.max_uploads)} uploads, the most allowed. Delete one first.`;
  }
  const types = status.upload_types.map((type) => type.toLowerCase());
  if (!types.includes(fileExtension(file.name))) {
    return `${file.name} is not a supported file type. Upload a ${joinOr(types)} file.`;
  }
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > status.max_upload_bytes) {
    return `${file.name} is ${formatBytes(file.size)}; the limit is ${formatBytes(status.max_upload_bytes)}.`;
  }
  return null;
}
