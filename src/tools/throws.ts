import type { NormalizedThrowsList, ThrowsDeclaration } from "../types/error";
import { isError } from "../definers/tools";

type ThrowOwner = {
  kind:
    | "task"
    | "resource"
    | "hook"
    | "event"
    | "task-middleware"
    | "resource-middleware";
  id: string;
};

function invalidThrowsEntryError(owner: ThrowOwner, item: unknown): Error {
  const got =
    item === null
      ? "null"
      : Array.isArray(item)
        ? "array"
        : typeof item === "object"
          ? "object"
          : typeof item;
  return new Error(
    `Invalid throws entry for ${owner.kind} ${owner.id}: expected Error helper or non-empty error id, got ${got}`,
  );
}

function toErrorIdList(
  owner: ThrowOwner,
  list: ThrowsDeclaration,
): NormalizedThrowsList {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const item of list) {
    // Entries are either error helpers or already-normalized error ids.
    const id =
      typeof item === "string" ? item : isError(item) ? item.id : undefined;

    if (typeof id !== "string" || id.trim().length === 0) {
      throw invalidThrowsEntryError(owner, item);
    }

    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return ids;
}

export function normalizeThrows(
  owner: ThrowOwner,
  throwsList: ThrowsDeclaration | undefined,
): NormalizedThrowsList | undefined {
  if (throwsList === undefined) return undefined;
  return toErrorIdList(owner, throwsList);
}
