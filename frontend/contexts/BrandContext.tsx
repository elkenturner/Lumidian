'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { getBrands, Brand } from '@/lib/api';

const STORAGE_KEY = 'clarity_active_brand_id';

interface BrandContextValue {
  brands: Brand[];
  activeBrandId: number | null;
  activeBrand: Brand | null;
  setActiveBrandId: (id: number) => void;
  loading: boolean;
  refetch: () => void;
}

const BrandContext = createContext<BrandContextValue>({
  brands: [],
  activeBrandId: null,
  activeBrand: null,
  setActiveBrandId: () => {},
  loading: true,
  refetch: () => {},
});

export function BrandProvider({ children }: { children: ReactNode }) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [activeBrandId, setActiveBrandIdState] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchBrands = useCallback(() => {
    getBrands()
      .then((b) => {
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
      .catch((err) => { console.error('[BrandContext] Failed to load brands:', err); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchBrands(); }, [fetchBrands]);

  function setActiveBrandId(id: number) {
    setActiveBrandIdState(id);
    try { localStorage.setItem(STORAGE_KEY, String(id)); } catch {}
  }

  const activeBrand = brands.find((b) => b.id === activeBrandId) ?? null;

  return (
    <BrandContext.Provider value={{ brands, activeBrandId, activeBrand, setActiveBrandId, loading, refetch: fetchBrands }}>
      {children}
    </BrandContext.Provider>
  );
}

export function useBrand() {
  return useContext(BrandContext);
}
