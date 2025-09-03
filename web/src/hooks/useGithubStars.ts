import { useEffect, useMemo, useState } from "react";

export interface UseGithubStarsOptions {
  ttlMs?: number; // cache TTL in milliseconds (default: 6 hours)
  repo?: string; // full repo name, default: "bluelibs/runner"
}

export interface UseGithubStarsResult {
  count: number | null;
  loading: boolean;
  error: Error | null;
  updatedAt: number | null; // epoch ms of when the value was last updated
}

/**
 * Fetches GitHub stargazers_count for a public repo with simple localStorage caching.
 * Note: Unauthenticated GitHub API calls are rate limited (60/hour/IP). We cache to reduce calls.
 */
export function useGithubStars(
  options: UseGithubStarsOptions = {},
): UseGithubStarsResult {
  const { ttlMs = 6 * 60 * 60 * 1000, repo = "bluelibs/runner" } = options;

  const storageKey = useMemo(
    () => (typeof window !== "undefined" ? `gh:stars:${repo}` : ""),
    [repo],
  );

  const [state, setState] = useState<UseGithubStarsResult>(() => {
    if (typeof window === "undefined") {
      return { count: null, loading: true, error: null, updatedAt: null };
    }
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          count: number;
          updatedAt: number;
        };
        return {
          count: parsed.count ?? null,
          loading: false,
          error: null,
          updatedAt: parsed.updatedAt ?? null,
        };
      }
    } catch {
      // ignore
    }
    return { count: null, loading: true, error: null, updatedAt: null };
  });

  useEffect(() => {
    let cancelled = false;
    if (typeof window === "undefined") return;

    const now = Date.now();
    const freshEnough = state.updatedAt && now - state.updatedAt < ttlMs;
    if (freshEnough) return; // use cached value

    const url = `https://api.github.com/repos/${repo}`;
    const controller = new AbortController();

    (async () => {
      try {
        setState((s) => ({ ...s, loading: true }));
        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            Accept: "application/vnd.github+json",
          },
        });
        if (!res.ok) {
          throw new Error(`GitHub API error: ${res.status}`);
        }
        const data = (await res.json()) as { stargazers_count?: number };
        const count =
          typeof data.stargazers_count === "number"
            ? data.stargazers_count
            : null;
        const updatedAt = Date.now();
        if (cancelled) return;
        setState({ count, loading: false, error: null, updatedAt });
        try {
          localStorage.setItem(
            storageKey,
            JSON.stringify({ count, updatedAt }),
          );
        } catch {
          // storage may be full or disabled
        }
      } catch (error) {
        if (cancelled) return;
        setState((s) => ({ ...s, loading: false, error: error as Error }));
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // We intentionally depend on repo and ttlMs; storageKey is derived
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, ttlMs]);

  return state;
}

export function formatStarCount(count: number | null): string {
  if (count == null) return "—";
  if (count < 1000) return String(count);
  if (count < 1_000_000) {
    const v = count / 1000;
    return `${v.toFixed(v < 10 ? 1 : 0)}k`;
  }
  const v = count / 1_000_000;
  return `${v.toFixed(v < 10 ? 1 : 0)}m`;
}
