"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IndexedDBStorage, indexedDBStorage } from "@zama-fhe/sdk";
import { sepolia as fheSepolia } from "@zama-fhe/sdk/chains";
import { createConfig } from "@zama-fhe/sdk/ethers";
import type { EIP1193Provider } from "@zama-fhe/sdk/ethers";
import { web } from "@zama-fhe/sdk/web";
import { ZamaProvider } from "@zama-fhe/react-sdk";
import { JsonRpcProvider } from "ethers";
import { SEPOLIA_RPC_URL } from "@/lib/config";
import { useWallet } from "@/lib/wallet";

const permitDBStorage = new IndexedDBStorage("PermitStore");
const queryClient = new QueryClient();

const relayerProxyUrl =
  typeof window === "undefined" ? "http://localhost/api/relayer" : `${window.location.origin}/api/relayer`;

const fallbackProvider = {
  request: async ({ method }: { method: string }) => {
    if (method === "eth_accounts") return [];
    if (method === "eth_chainId") return `0x${fheSepolia.id.toString(16)}`;
    throw new Error("Connect a wallet on Sepolia.");
  },
  on: () => {},
  removeListener: () => {},
};

export function Providers({ children }: { children: ReactNode }) {
  const { provider, account } = useWallet();
  const liveAccountsRef = useRef<string[]>([]);
  const refSeededRef = useRef(false);
  const [walletKey, setWalletKey] = useState(0);

  useEffect(() => {
    const ethereum = provider;
    if (!ethereum?.on || !ethereum.removeListener) return;
    (ethereum.request({ method: "eth_accounts" }) as Promise<string[]>).then(
      (accounts) => {
        liveAccountsRef.current = accounts;
        refSeededRef.current = true;
      },
      () => {
        refSeededRef.current = true;
      },
    );
    const handleAccountsChanged = (accounts: unknown) => {
      const next = accounts as string[];
      const prev = liveAccountsRef.current[0];
      liveAccountsRef.current = next;
      if (!refSeededRef.current) return;
      if (next[0] !== prev) setWalletKey((k) => k + 1);
    };
    const handleChainChanged = () => setWalletKey((k) => k + 1);
    ethereum.on("accountsChanged", handleAccountsChanged);
    ethereum.on("chainChanged", handleChainChanged);
    return () => {
      ethereum.removeListener?.("accountsChanged", handleAccountsChanged);
      ethereum.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [provider]);

  const zamaConfig = useMemo(() => {
    const ethereum = (provider ?? fallbackProvider) as EIP1193Provider;
    const rpc = new JsonRpcProvider(SEPOLIA_RPC_URL);
    const chain = {
      ...fheSepolia,
      relayerUrl: relayerProxyUrl,
      network: SEPOLIA_RPC_URL,
    } as const;
    return createConfig({
      chains: [chain],
      ethereum,
      provider: rpc,
      storage: indexedDBStorage,
      permitStorage: permitDBStorage,
      relayers: { [chain.id]: web() },
    });
  }, [provider, account, walletKey]);

  return (
    <QueryClientProvider client={queryClient}>
      <ZamaProvider config={zamaConfig} key={`${account}:${walletKey}`}>
        {children}
      </ZamaProvider>
    </QueryClientProvider>
  );
}
