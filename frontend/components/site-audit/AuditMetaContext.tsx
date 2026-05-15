'use client';

import { createContext, useContext, type ReactNode } from 'react';

export interface AuditMeta {
  /** Map of prompt id → prompt text, for surfacing tracking-prompt linkage on fix cards. */
  promptsById: Record<number, string>;
  /** Detected CMS platform for this brand's site (Wix / Shopify / Webflow / WordPress / Squarespace / null). */
  cmsPlatform: string | null;
}

const Ctx = createContext<AuditMeta>({ promptsById: {}, cmsPlatform: null });

export function AuditMetaProvider({
  promptsById,
  cmsPlatform,
  children,
}: AuditMeta & { children: ReactNode }) {
  return <Ctx.Provider value={{ promptsById, cmsPlatform }}>{children}</Ctx.Provider>;
}

export function useAuditMeta(): AuditMeta {
  return useContext(Ctx);
}
