import type { ThrowsList } from "../types/error";
import { isError } from "../definers/tools";

type ThrowOwner = {
  kind:
    | "task"
    | "resource"
    | "hook"
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
    `Invalid throws entry for ${owner.kind} ${owner.id}: expected error id string or Error helper, got ${got}`,
  );
}

function toErrorIdList(owner: ThrowOwner, list: ThrowsList): readonly string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const item of list) {
    let id: string;
    if (typeof item === "string") {
      if (item.trim().length === 0) {
        throw invalidThrowsEntryError(owner, item);
      }
      id = item;
    } else if (isError(item)) {
      id = item.id;
      if (typeof id !== "string" || id.trim().length === 0) {
        throw invalidThrowsEntryError(owner, item);
      }
    } else {
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
  throwsList: ThrowsList | undefined,
): readonly string[] | undefined {
  if (throwsList === undefined) return undefined;
  return toErrorIdList(owner, throwsList);
}
