import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { StudioWorkflow } from "../../src/shared/types.js";
import type { StudioApi } from "./api.js";
import { workflowPage } from "../../src/shared/workflowPage.js";

export const WorkflowApiContext = createContext<StudioApi | null>(null);

/** Server-side catalog search with bounded cached pages and stale-response protection. */
export function useWorkflowFeed(fallback: StudioWorkflow[], query: string) {
  const api = useContext(WorkflowApiContext);
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  const localSource = api ? null : fallback;
  const [state, setState] = useState(() => ({
    ...workflowPage(fallback, { query }),
    offset: 0,
    loading: false,
    error: "",
  }));
  const starts = useRef<Array<string | undefined>>([]);
  const previous = useRef<Array<string | undefined>>([]);
  const next = useRef<string | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const [reset, setReset] = useState(0);
  const load = useCallback(
    async (direction: "first" | "next" | "previous") => {
      if (
        busy.current ||
        (direction === "next" && next.current === null) ||
        (direction === "previous" && !previous.current.length)
      )
        return;
      const version = generation.current;
      busy.current = true;
      setState((current) => ({ ...current, loading: true, error: "" }));
      try {
        const filters = {
          query,
          cursor:
            direction === "next"
              ? next.current!
              : direction === "previous"
                ? previous.current.at(-1)
                : undefined,
          limit: 20,
        };
        const page = api
          ? await api.listWorkflowPage(filters)
          : workflowPage(fallbackRef.current, filters);
        if (version !== generation.current) return;
        next.current = page.nextCursor;
        if (direction === "first") {
          starts.current = [undefined];
          previous.current = [];
        } else if (direction === "next") {
          starts.current.push(filters.cursor);
          if (starts.current.length > 10)
            previous.current.push(starts.current.shift());
        } else {
          starts.current.unshift(previous.current.pop());
          if (starts.current.length > 10) next.current = starts.current.pop()!;
        }
        const offset = previous.current.length * 20;
        const nextCursor = next.current;
        setState((current) => ({
          ...page,
          nextCursor,
          offset,
          workflows:
            direction === "next"
              ? [...current.workflows, ...page.workflows].slice(
                  Math.max(0, offset - current.offset),
                )
              : direction === "previous"
                ? [...page.workflows, ...current.workflows].slice(0, 200)
                : page.workflows,
          loading: false,
          error: "",
        }));
      } catch (error) {
        if (version === generation.current)
          setState((current) => ({
            ...current,
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : "Could not load workflows.",
          }));
      } finally {
        if (version === generation.current) busy.current = false;
      }
    },
    [api, localSource, query],
  );
  useEffect(() => {
    generation.current++;
    busy.current = false;
    next.current = null;
    starts.current = [];
    previous.current = [];
    setState((current) => ({
      ...current,
      workflows: [],
      loading: true,
      error: "",
    }));
    const timer = window.setTimeout(() => void load("first"), query ? 200 : 0);
    return () => {
      generation.current++;
      window.clearTimeout(timer);
    };
  }, [load, reset]);
  return {
    ...state,
    loadMore: () => load("next"),
    loadPrevious: () => load("previous"),
    retry: () => setReset((value) => value + 1),
  };
}
