'use client';
import { createContext, useContext, type ReactNode } from 'react';

export interface ClientViewState {
  /** True when rendered inside the /client/[token] portal shell. */
  isClientView: boolean;
  /** The token from the URL — used to construct API calls. */
  token: string | null;
  /** The resolved brand id (loaded after first /brand call). */
  brandId: number | null;
}

const ClientViewContext = createContext<ClientViewState>({
  isClientView: false,
  token: null,
  brandId: null,
});

export function ClientViewProvider({
  token,
  brandId,
  children,
}: {
  token: string;
  brandId: number | null;
  children: ReactNode;
}) {
  return (
    <ClientViewContext.Provider value={{ isClientView: true, token, brandId }}>
      {children}
    </ClientViewContext.Provider>
  );
}

export function useClientView(): ClientViewState {
  return useContext(ClientViewContext);
}
