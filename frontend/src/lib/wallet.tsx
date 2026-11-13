"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { SEPOLIA_CHAIN_ID_HEX, SEPOLIA_RPC_URL, explainChainError } from "@/lib/config";

export type Eip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  isMetaMask?: boolean;
  isRabby?: boolean;
  providers?: Eip1193[];
};

type WalletInfo = { uuid: string; name: string; icon: string };
type AnnouncedWallet = { info: WalletInfo; provider: Eip1193 };

type WalletContextValue = {
  account: string;
  provider: Eip1193 | undefined;
  error: string;
  connect: () => Promise<void>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

function walletName(provider: Eip1193, index: number) {
  if (provider.isMetaMask) return "MetaMask";
  if (provider.isRabby) return "Rabby";
  return index === 0 ? "Browser wallet" : `Browser wallet ${index + 1}`;
}

function readInjected(): AnnouncedWallet[] {
  if (typeof window === "undefined") return [];
  const injected = window.ethereum as Eip1193 | undefined;
  if (!injected) return [];
  const list = injected.providers?.length ? injected.providers : [injected];
  return list.map((provider, index) => ({
    info: { uuid: `injected-${index}`, name: walletName(provider, index), icon: "" },
    provider,
  }));
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [announced, setAnnounced] = useState<AnnouncedWallet[]>([]);
  const [provider, setProvider] = useState<Eip1193 | undefined>();
  const [account, setAccount] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const found = new Map<string, AnnouncedWallet>();
    const remember = (wallet: AnnouncedWallet) => {
      found.set(wallet.info.uuid, wallet);
      setAnnounced([...found.values()]);
    };
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<AnnouncedWallet>).detail;
      if (!detail?.info?.uuid || !detail.provider) return;
      remember(detail);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const refreshInjected = () => {
      for (const wallet of readInjected()) remember(wallet);
    };
    refreshInjected();
    const timer = window.setInterval(refreshInjected, 400);
    const stop = window.setTimeout(() => window.clearInterval(timer), 8000);
    window.addEventListener("ethereum#initialized", refreshInjected);
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      window.removeEventListener("ethereum#initialized", refreshInjected);
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, []);

  const wallets = useMemo(() => (announced.length ? announced : readInjected()), [announced]);

  const sepoliaChain = {
    chainId: SEPOLIA_CHAIN_ID_HEX,
    chainName: "Sepolia",
    nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: [SEPOLIA_RPC_URL],
    blockExplorerUrls: ["https://sepolia.etherscan.io"],
  };

  async function useSepolia(next: Eip1193) {
    const chainId = (await next.request({ method: "eth_chainId" })) as string;
    if (chainId === SEPOLIA_CHAIN_ID_HEX) return;
    try {
      await next.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
      });
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code !== 4902) throw err;
      await next.request({ method: "wallet_addEthereumChain", params: [sepoliaChain] });
    }
  }

  async function connectWith(next: Eip1193) {
    setError("");
    const accounts = (await next.request({ method: "eth_requestAccounts" })) as string[];
    await useSepolia(next);
    setProvider(next);
    setAccount(accounts[0] ?? "");
    setOpen(false);
    try {
      await next.request({ method: "eth_blockNumber" });
    } catch (err) {
      try {
        await next.request({ method: "wallet_addEthereumChain", params: [sepoliaChain] });
        await next.request({ method: "eth_blockNumber" });
      } catch {
        setError(explainChainError(err));
      }
    }
  }

  async function connect() {
    const list = announced.length ? announced : readInjected();
    if (list.length === 0) {
      setError("Chrome does not see a wallet yet. Install MetaMask or Rabby, then reload this page.");
      setOpen(true);
      return;
    }
    if (list.length === 1) {
      try {
        await connectWith(list[0].provider);
      } catch (err) {
        setError(explainChainError(err));
      }
      return;
    }
    setOpen(true);
  }

  const value = useMemo(
    () => ({ account, provider, error, connect }),
    [account, provider, error],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      {open && wallets.length > 1 && (
        <div className="wallet-list wrap">
          {wallets.map((wallet) => (
            <button key={wallet.info.uuid} type="button" onClick={() => void connectWith(wallet.provider)}>
              {wallet.info.name}
            </button>
          ))}
        </div>
      )}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error("WalletProvider is missing.");
  return value;
}

export function WalletButton() {
  const { account, error, connect } = useWallet();
  const label = account ? `Wallet ${account.slice(0, 6)}…${account.slice(-4)}` : "Connect wallet";
  return (
    <span className="wallet-slot">
      <button type="button" onClick={() => void connect()}>
        {label}
      </button>
      {error && <span className="wallet-error">{error}</span>}
    </span>
  );
}
