export function getEthereumProvider() {
  if (typeof window === "undefined") return undefined;
  return window.ethereum;
}
