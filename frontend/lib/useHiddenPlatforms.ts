"use client";

import { useCallback, useEffect, useState } from "react";

function storageKey(brandId: number): string {
  return `cluster-hidden-platforms:${brandId}`;
}

function readHidden(brandId: number): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(storageKey(brandId));
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter((x) => typeof x === "string")) : new Set();
  } catch {
    return new Set();
  }
}

/**
 * Per-brand, view-only set of platforms hidden from cluster surfaces.
 * Persisted in localStorage. Does NOT affect generation — purely a render filter.
 */
export function useHiddenPlatforms(brandId: number): {
  hidden: Set<string>;
  toggle: (platform: string) => void;
  isVisible: (platform: string) => boolean;
} {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  // Hydrate from localStorage after mount (avoids SSR/client mismatch).
  useEffect(() => {
    setHidden(readHidden(brandId));
  }, [brandId]);

  const toggle = useCallback(
    (platform: string) => {
      setHidden((prev) => {
        const next = new Set(prev);
        if (next.has(platform)) {
          next.delete(platform);
        } else {
          next.add(platform);
        }
        try {
          window.localStorage.setItem(storageKey(brandId), JSON.stringify(Array.from(next)));
        } catch {
          /* ignore quota/availability errors — filter is best-effort */
        }
        return next;
      });
    },
    [brandId],
  );

  const isVisible = useCallback((platform: string) => !hidden.has(platform), [hidden]);

  return { hidden, toggle, isVisible };
}
