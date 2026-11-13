import deployment from "./deployment.json";

export const SEPOLIA_CHAIN_ID = 11155111;
export const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7";
export const SEPOLIA_RPC_URL =
  process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

export const SEPOLIA_RPC_FIX =
  `Rabby's Sepolia RPC (Alchemy) rejected the request. In Rabby, edit the Sepolia network and set the RPC URL to ${SEPOLIA_RPC_URL}, then reload this page.`;

export function explainChainError(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err ?? "Request failed");
  if (/coalesce|alchemy\.com|-32600|not a valid request object/i.test(raw)) return SEPOLIA_RPC_FIX;
  if (/0x301c306b|BadPhase/i.test(raw)) {
    return "This table is not open for that action. Once both scores are committed, use Pay the $2 prize. The scores stay hidden.";
  }
  return raw.length > 280 ? `${raw.slice(0, 280)}…` : raw;
}

export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_MYSTERY_BOX_ADDRESS ||
  deployment.contract) as `0x${string}`;

export const SHOWDOWN_ADDRESS = (process.env.NEXT_PUBLIC_SHOWDOWN_ADDRESS ||
  deployment.showdown) as `0x${string}`;

export const CUSDT = deployment.cUsdt as `0x${string}`;
export const UNDERLYING = deployment.underlying as `0x${string}`;
export const EXPLORER = deployment.explorer;
export const DEPLOY_TX = deployment.deployTx;
export const BUY_TX = deployment.buyTx;
export const SHOWDOWN_DEPLOY_TX = deployment.showdownDeployTx;
export const SHOWDOWN_ROUND_TX = deployment.showdownRoundTx;
export const SHOWDOWN_RESOLVE_TX = deployment.showdownResolveTx;
export const INVITE_ADDRESS = (process.env.NEXT_PUBLIC_INVITE_ADDRESS || deployment.invite || "") as `0x${string}`;

export const BOX_PRICE = 1_000_000n;
export const PRIZE_NAMES = ["No prize", "Common", "Rare", "Epic", "Legendary"] as const;

export function txUrl(hash: string) {
  return `${EXPLORER}/tx/${hash}`;
}

export function addressUrl(address: string) {
  return `${EXPLORER}/address/${address}`;
}
