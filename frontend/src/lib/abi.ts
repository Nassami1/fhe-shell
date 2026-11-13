export const mysteryBoxAbi = [
  "function getOdds() view returns (string[4] names, uint256[4] percent, uint256[4] bucketWeight, uint256 modulus)",
  "function getBox(address buyer, uint256 boxId) view returns (bytes32)",
  "function getRoll(address buyer, uint256 boxId) view returns (bytes32)",
  "function boxCount(address buyer) view returns (uint256)",
  "function paymentKind(address buyer, uint256 boxId) view returns (uint8)",
  "function buyBox(bytes32 encryptedAmount, bytes inputProof) returns (uint256)",
  "function buyBoxFallback() returns (uint256)",
  "function BOX_PRICE() view returns (uint64)",
  "function FALLBACK_PRICE() view returns (uint256)",
  "function cUsdt() view returns (address)",
  "function underlyingToken() view returns (address)",
  "event BoxOpened(address indexed buyer, uint256 indexed boxId, bytes32 prizeHandle, bytes32 randHandle)",
] as const;

export const erc20Abi = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function mint(address to, uint256 amount)",
] as const;

export const cusdtAbi = [
  "function isOperator(address holder, address spender) view returns (bool)",
  "function setOperator(address operator, uint48 until)",
  "function decimals() view returns (uint8)",
] as const;
