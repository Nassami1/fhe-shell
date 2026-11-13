# fhe-shell-casino

A provably-fair **shell game** on Zama's fhEVM (Fully Homomorphic Encryption on Ethereum). Two players each play **three free hands**, then pay **$1 to commit** their hidden score. The higher encrypted total takes the **$2 pot** — and neither player's score is ever revealed on-chain.

The ball and the score come from `FHE.randEuint32` and `FHE.select`. A hand that hits scores a random power (10 / 30 / 70 / 150); a miss scores 0. The three hands are summed on ciphertext, and the contract compares the two totals without decrypting them.

> This repo also contains two companion contracts: a single-player **MysteryBox** and a **2–5 player showdown**. The shell game (`MysteryBoxInvite`) is the main deliverable.

## What's inside

| Contract | Game | Players |
| --- | --- | --- |
| `MysteryBoxInvite` | Shell game: 3 free hands → $1 commit → higher score wins $2 | 2 |
| `MysteryBoxShowdown` | Buy a box, decrypt your power, challenge or fold | 2–5 |
| `MysteryBox` | Open a box for a buyer-only prize | 1 |

All draws use `FHE.randEuint32(1024)` with published odds: Common 614, Rare 256, Epic 123, Legendary 31.

## Stack

- **Contracts**: Solidity `^0.8.27` on the official [`fhevm-hardhat-template`](https://github.com/zama-ai/fhevm-hardhat-template) (`ZamaEthereumConfig`).
- **Network**: Ethereum Sepolia (chain id `11155111`), Zama fhEVM testnet.
- **Frontend**: Next.js (App Router) + TypeScript, ethers v6, `@zama-fhe/sdk` + `@zama-fhe/react-sdk`.
- **Relayer**: proxied through `frontend/src/app/api/relayer` to `https://relayer.testnet.zama.org` (no API key needed for the public testnet).

## Prerequisites

- Node.js `>= 20`
- A browser wallet (MetaMask or Rabby) with **Sepolia ETH** for gas
- A Sepolia private key with a little ETH for deploying contracts

## Quick start

```bash
# 1. Clone
git clone https://github.com/Nassami1/fhe-shell-casino.git
cd fhe-shell-casino

# 2. Install contract dependencies
npm install

# 3. Configure the deployer key (never commit .env)
cp .env.example .env
# edit .env and set PRIVATE_KEY=<your-sepolia-private-key>

# 4. (optional) run the contract tests
npm test

# 5. Deploy the shell-game contract to Sepolia
npx hardhat deploy --network sepolia --tags MysteryBoxInvite
```

The deploy prints the new contract address. Put it into `frontend/src/lib/deployment.json` under `"invite"`, then:

```bash
# 6. Install frontend dependencies and run the dev server
cd frontend
npm install
npm run dev
```

Open **http://localhost:3000/play** in your browser.

## How to play (shell game)

1. Connect a Sepolia wallet (the **Connect wallet** button is in the header).
2. Click **Open a table** — this is free.
3. Play **three hands**: pick a cup each round. Playing is free.
4. Click **Pay $1 and commit score** — the $1 stake is paid only here. The app tries confidential cUSDT first; if that reverts, use **Fallback Payment** (clear test USDT, auto-minted by the UI).
5. Copy the invite link and send it to the second player.
6. The second player takes the seat, plays three hands, and pays $1 to commit. The **second commit seals the round** and picks the winner on ciphertext.
7. Click **Pay the $2 prize** — this submits the public decryption proof and pays the winner.

Playing the three hands never requires payment; only committing the score costs $1.

## Contract addresses (Sepolia)

| Contract | Address |
| --- | --- |
| `MysteryBoxInvite` (shell game) | `0xBa72092d9078E82912864ebB2a6fCa505f95AFB3` |
| `MysteryBoxShowdown` | `0xAB2A568152705A74370D9B06265A21406Df6499A` |
| `MysteryBox` | `0x82d75EFbCA8e086565cB2CCEb270B0625dE6b348` |
| cUSDT mock | `0x4E7B06D78965594eB5EF5414c357ca21E1554491` |
| Underlying test USDT | `0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0` |

## Project structure

```
contracts/
  MysteryBoxInvite.sol      # shell game (main)
  MysteryBoxShowdown.sol    # 2–5 player showdown
  MysteryBox.sol            # single-player box
  mocks/                    # MockCUSDT + MockERC20 for local tests
deploy/                     # hardhat-deploy scripts (one per contract)
test/                       # hardhat tests (MysteryBoxInvite, Showdown, MysteryBox)
frontend/                   # Next.js app
  src/components/InviteTable.tsx   # shell-game UI
  src/components/Showdown.tsx       # showdown UI
  src/lib/deployment.json           # deployed addresses (edit after redeploy)
scripts/                    # ad-hoc Sepolia helper scripts
```

## Tests

```bash
npm test                        # all contract tests (local fhevm mock)
npm run test -- test/MysteryBoxInvite.ts   # just the shell game
```

The shell-game tests cover: the three-free-hands flow, "commit requires three hands", buyer-only score decryption, the encrypted comparison, refund on expiry, and both confidential and fallback commits.

## Known limits

- The winner address is FHE-encrypted, so paying the pot needs a `claim` call with a public decryption proof (the UI's **Pay the $2 prize** button).
- A confidential underpayment is not reverted; the committed score becomes 0.
- Both players in a round must use the same payment method (cUSDT or fallback).
- The 48-hour link window only gates joining/playing; `block.timestamp` is not used for the draw.
- The odds are published as percentages (60/25/12/3) but the contract draws from 1024 power-of-two slots (614/256/123/31) because `FHE.randEuint32` requires a power-of-two bound.

## Links

- https://docs.zama.org/protocol
- https://github.com/zama-ai/fhevm-hardhat-template
- https://github.com/zama-ai/sdk
