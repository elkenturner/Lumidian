'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { getBrands, Brand, parseApiError } from '@/lib/api';

const STORAGE_KEY = 'clarity_active_brand_id';

interface BrandContextValue {
  brands: Brand[];
  activeBrandId: number | null;
  activeBrand: Brand | null;
  setActiveBrandId: (id: number) => void;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const BrandContext = createContext<BrandContextValue>({
  brands: [],
  activeBrandId: null,
  activeBrand: null,
  setActiveBrandId: () => {},
  loading: true,
  error: null,
  refetch: () => {},
});

export function BrandProvider({ children }: { children: ReactNode }) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [activeBrandId, setActiveBrandIdState] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBrands = useCallback(() => {
    setError(null);
    getBrands()
      .then((raw) => {
        // Defend against a malformed payload slipping through — a non-array
        // here would crash every consumer's .find/.map and take down the app.
        const b = Array.isArray(raw) ? raw : [];
        setBrands(b);
        setActiveBrandIdState((prev) => {
          // Restore from localStorage, fallback to first brand
          const stored = typeof window !== 'undefined'
            ? parseInt(localStorage.getItem(STORAGE_KEY) ?? '', 10)
            : NaN;
          const validStored = !isNaN(stored) && b.some((br) => br.id === stored);
          if (validStored) return stored;
          // Stale stored ID — clear it so it doesn't linger
          if (!isNaN(stored) && typeof window !== 'undefined') {
            localStorage.removeItem(STORAGE_KEY);
          }
          if (prev && b.some((br) => br.id === prev)) return prev;
          return b[0]?.id ?? null;
        });
      })
      .catch((err) => {
        console.error('[BrandContext] Failed to load brands:', err);
        setError(parseApiError(err, 'Failed to load brands. Please try again.'));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchBrands(); }, [fetchBrands]);

  function setActiveBrandId(id: number) {
    setActiveBrandIdState(id);
    try { localStorage.setItem(STORAGE_KEY, String(id)); } catch {}
  }

  const activeBrand = brands.find((b) => b.id === activeBrandId) ?? null;

  return (
    <BrandContext.Provider value={{ brands, activeBrandId, activeBrand, setActiveBrandId, loading, error, refetch: fetchBrands }}>
      {children}
    </BrandContext.Provider>
  );
}

export function useBrand() {
  return useContext(BrandContext);
}
