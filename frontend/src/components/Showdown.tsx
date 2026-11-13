"use client";

import { useState } from "react";
import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";
import {
  useDecryptPublicValues,
  useDecryptValues,
  useEncrypt,
  useGrantPermit,
  useHasPermit,
  useShield,
} from "@zama-fhe/react-sdk";
import { cusdtAbi, erc20Abi } from "@/lib/abi";
import {
  BOX_PRICE,
  CUSDT,
  EXPLORER,
  SHOWDOWN_ADDRESS,
  SHOWDOWN_RESOLVE_TX,
  SHOWDOWN_ROUND_TX,
  SEPOLIA_RPC_URL,
  UNDERLYING,
  addressUrl,
  explainChainError,
  txUrl,
} from "@/lib/config";
import { showdownAbi } from "@/lib/showdownAbi";
import { getEthereumProvider } from "@/lib/ethereum";
import { useWallet } from "@/lib/wallet";

const PHASE = ["Empty", "Open", "Challenge", "Resolved"];
const STAKE = 1_000_000n;

type RoundView = {
  host: string;
  phase: number;
  paymentKind: number;
  pot: bigint;
  playerCount: bigint;
  winner: string;
  claimed: boolean;
  players: string[];
  decisions: number[];
  powerHandle: string;
  rollHandle: string;
  winnerHandle: string;
};

function explain(err: unknown) {
  return explainChainError(err);
}

export function Showdown() {
  const { account, provider: walletProvider } = useWallet();
  const [roundId, setRoundId] = useState("1");
  const [round, setRound] = useState<RoundView | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fallbackJoin, setFallbackJoin] = useState(false);
  const [fallbackStake, setFallbackStake] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [wantDecrypt, setWantDecrypt] = useState(false);
  const [revealedWinner, setRevealedWinner] = useState("");

  const encrypt = useEncrypt();
  const shield = useShield({ address: CUSDT });
  const publicDecrypt = useDecryptPublicValues();
  const { mutateAsync: grantPermit, isPending: granting } = useGrantPermit();
  const { data: hasPermit } = useHasPermit({
    contractAddresses: SHOWDOWN_ADDRESS ? [SHOWDOWN_ADDRESS] : [],
  });
  const decryptInputs =
    round && account && SHOWDOWN_ADDRESS && round.powerHandle !== `0x${"0".repeat(64)}`
      ? [{ encryptedValue: round.powerHandle as `0x${string}`, contractAddress: SHOWDOWN_ADDRESS }]
      : [];
  const decrypt = useDecryptValues(decryptInputs, {
    enabled: wantDecrypt && !!hasPermit && decryptInputs.length > 0,
  });
  const powerValue = round ? decrypt.data?.[round.powerHandle as `0x${string}`] : undefined;

  async function signer() {
    const ethereum = walletProvider ?? getEthereumProvider();
    if (!ethereum) throw new Error("Connect a wallet first.");
    return new BrowserProvider(ethereum).getSigner();
  }

  function reader() {
    return new Contract(SHOWDOWN_ADDRESS, showdownAbi, new JsonRpcProvider(SEPOLIA_RPC_URL));
  }

  async function refresh(id = roundId) {
    if (!SHOWDOWN_ADDRESS) return;
    const box = reader();
    const snapshot = await box.getRound(id);
    const players = (await box.getPlayers(id)) as string[];
    const decisions = await Promise.all(players.map((player) => box.decision(id, player).then(Number)));
    const powerHandle = account ? ((await box.getPlayerBox(account, id)) as string) : `0x${"0".repeat(64)}`;
    const rollHandle = account ? ((await box.getRoll(account, id)) as string) : `0x${"0".repeat(64)}`;
    const winnerHandle = (await box.getWinnerHandle(id)) as string;
    setRound({
      host: snapshot.host,
      phase: Number(snapshot.phase),
      paymentKind: Number(snapshot.paymentKind),
      pot: snapshot.pot,
      playerCount: snapshot.playerCount,
      winner: snapshot.winner,
      claimed: snapshot.claimed,
      players,
      decisions,
      powerHandle,
      rollHandle,
      winnerHandle,
    });
  }

  async function ensureClear(amount: bigint) {
    if (!account) return;
    const wallet = await signer();
    const token = new Contract(UNDERLYING, erc20Abi, wallet);
    const balance = (await token.balanceOf(account)) as bigint;
    if (balance >= amount) return;
    setStatus("Minting test USDT…");
    await (await token.mint(account, amount)).wait();
  }

  async function ensureOperator() {
    if (!account) return;
    const wallet = await signer();
    const token = new Contract(CUSDT, cusdtAbi, wallet);
    if (await token.isOperator(account, SHOWDOWN_ADDRESS)) return;
    setStatus("Approving the showdown contract as a cUSDT operator…");
    const until = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
    await (await token.setOperator(SHOWDOWN_ADDRESS, until)).wait();
  }

  async function payConfidential(amount: bigint) {
    await ensureClear(amount);
    setStatus("Shielding test USDT into cUSDT…");
    await shield.mutateAsync({ amount });
    await ensureOperator();
    setStatus("Encrypting the payment…");
    return encrypt.mutateAsync({
      values: [{ value: amount, type: "euint64" }],
      contractAddress: SHOWDOWN_ADDRESS,
      userAddress: account as `0x${string}`,
    });
  }

  async function create() {
    setBusy(true);
    setError("");
    try {
      setStatus("Creating a round…");
      const box = new Contract(SHOWDOWN_ADDRESS, showdownAbi, await signer());
      const tx = await box.createRound();
      const receipt = await tx.wait();
      const parsed = receipt.logs
        .map((log: { topics: string[]; data: string }) => {
          try {
            return box.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((item: { name?: string } | null) => item?.name === "RoundCreated");
      const id = (parsed?.args?.roundId as bigint | undefined)?.toString() ?? roundId;
      setRoundId(id);
      setTxHash(receipt.hash);
      setStatus(`Round ${id} is open.`);
      await refresh(id);
    } catch (err) {
      setError(explain(err));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function joinConfidential() {
    setBusy(true);
    setError("");
    setFallbackJoin(false);
    try {
      const encrypted = await payConfidential(BOX_PRICE);
      setStatus("Joining with cUSDT…");
      const box = new Contract(SHOWDOWN_ADDRESS, showdownAbi, await signer());
      const tx = await box.joinRound(roundId, encrypted.encryptedValues[0], encrypted.inputProof);
      const receipt = await tx.wait();
      setTxHash(receipt.hash);
      setStatus("You are seated. Your power is still encrypted.");
      await refresh();
    } catch (err) {
      setError(`cUSDT join failed: ${explain(err)}`);
      setFallbackJoin(true);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function joinFallback() {
    setBusy(true);
    setError("");
    try {
      await ensureClear(BOX_PRICE);
      const wallet = await signer();
      const token = new Contract(UNDERLYING, erc20Abi, wallet);
      if ((await token.allowance(account, SHOWDOWN_ADDRESS)) < BOX_PRICE) {
        setStatus("Fallback Payment: approving clear test USDT…");
        await (await token.approve(SHOWDOWN_ADDRESS, BOX_PRICE)).wait();
      }
      setStatus("Fallback Payment: joining the round…");
      const box = new Contract(SHOWDOWN_ADDRESS, showdownAbi, wallet);
      const tx = await box.joinRoundFallback(roundId);
      const receipt = await tx.wait();
      setTxHash(receipt.hash);
      setFallbackJoin(false);
      setStatus("You are seated with Fallback Payment.");
      await refresh();
    } catch (err) {
      setError(`Fallback Payment failed: ${explain(err)}`);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function stakeConfidential() {
    setBusy(true);
    setError("");
    setFallbackStake(false);
    try {
      const encrypted = await payConfidential(STAKE);
      setStatus("Submitting the cUSDT challenge…");
      const box = new Contract(SHOWDOWN_ADDRESS, showdownAbi, await signer());
      const receipt = await (await box.challenge(roundId, encrypted.encryptedValues[0], encrypted.inputProof)).wait();
      setTxHash(receipt.hash);
      setStatus("Challenge recorded.");
      await refresh();
    } catch (err) {
      setError(`cUSDT challenge failed: ${explain(err)}`);
      setFallbackStake(true);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function stakeFallback() {
    setBusy(true);
    setError("");
    try {
      await ensureClear(STAKE);
      const wallet = await signer();
      const token = new Contract(UNDERLYING, erc20Abi, wallet);
      if ((await token.allowance(account, SHOWDOWN_ADDRESS)) < STAKE) {
        setStatus("Fallback Payment: approving the challenge stake…");
        await (await token.approve(SHOWDOWN_ADDRESS, STAKE)).wait();
      }
      setStatus("Fallback Payment: challenging…");
      const box = new Contract(SHOWDOWN_ADDRESS, showdownAbi, wallet);
      const receipt = await (await box.challengeFallback(roundId)).wait();
      setTxHash(receipt.hash);
      setFallbackStake(false);
      setStatus("Challenge recorded with Fallback Payment.");
      await refresh();
    } catch (err) {
      setError(`Fallback Payment failed: ${explain(err)}`);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function send(label: string, call: (box: Contract) => Promise<{ wait: () => Promise<{ hash: string }> }>) {
    setBusy(true);
    setError("");
    try {
      setStatus(label);
      const box = new Contract(SHOWDOWN_ADDRESS, showdownAbi, await signer());
      const receipt = await (await call(box)).wait();
      setTxHash(receipt.hash);
      setStatus("Confirmed.");
      await refresh();
    } catch (err) {
      setError(explain(err));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function decryptPower() {
    setError("");
    try {
      if (!hasPermit) {
        setStatus("Sign the decryption permit in your wallet…");
        await grantPermit([SHOWDOWN_ADDRESS]);
      }
      setWantDecrypt(true);
      setStatus("Decrypting your power…");
    } catch (err) {
      setError(explain(err));
      setStatus("");
    }
  }

  async function revealAndClaim() {
    if (!round) return;
    setBusy(true);
    setError("");
    try {
      setStatus("Publicly decrypting the winner…");
      const revealed = await publicDecrypt.mutateAsync([round.winnerHandle as `0x${string}`]);
      const winner = revealed.clearValues[round.winnerHandle as `0x${string}`];
      setRevealedWinner(String(winner));
      setStatus("Claiming the pot…");
      const box = new Contract(SHOWDOWN_ADDRESS, showdownAbi, await signer());
      const receipt = await (
        await box.claim(roundId, revealed.abiEncodedClearValues, revealed.decryptionProof)
      ).wait();
      setTxHash(receipt.hash);
      setStatus("Pot paid to the winner.");
      await refresh();
    } catch (err) {
      setError(explain(err));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="row">
        <button type="button" disabled={!account || !SHOWDOWN_ADDRESS || busy} onClick={() => void create()}>
          Create round
        </button>
        <label>
          Round{" "}
          <input value={roundId} onChange={(event) => setRoundId(event.target.value)} style={{ width: 64 }} />
        </label>
        <button type="button" className="ghost" disabled={busy} onClick={() => void refresh()}>
          Refresh
        </button>
        <button type="button" disabled={!account || busy || round?.phase !== 1} onClick={() => void joinConfidential()}>
          Buy box
        </button>
        {fallbackJoin && (
          <button type="button" className="ghost" disabled={busy} onClick={() => void joinFallback()}>
            Fallback Payment
          </button>
        )}
      </div>
      <p className="status">{status}</p>
      {error && <p>{error}</p>}
      {!SHOWDOWN_ADDRESS && <p>The showdown contract is not on Sepolia yet.</p>}

      <div className="card">
        <h2>Public odds and power</h2>
        <table>
          <thead>
            <tr>
              <th>Box</th>
              <th>Odds</th>
              <th>Power</th>
              <th>Bucket</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Common</td><td>60%</td><td>10</td><td>614 / 1024</td></tr>
            <tr><td>Rare</td><td>25%</td><td>30</td><td>256 / 1024</td></tr>
            <tr><td>Epic</td><td>12%</td><td>70</td><td>123 / 1024</td></tr>
            <tr><td>Legendary</td><td>3%</td><td>150</td><td>31 / 1024</td></tr>
          </tbody>
        </table>
      </div>

      {round && (
        <div className="card">
          <h2>Round {roundId}</h2>
          <p>Phase: {PHASE[round.phase] ?? "Unknown"}. Players: {round.playerCount.toString()} / 5. Pot: {round.pot.toString()} base units.</p>
          <p>{round.paymentKind === 2 ? "This round uses Fallback Payment." : round.paymentKind === 1 ? "This round uses cUSDT." : "Payment is chosen by the first player."}</p>
          <ul>
            {round.players.map((player, index) => (
              <li key={player} className="mono">
                {player} · {round.decisions[index] === 1 ? "Challenge" : round.decisions[index] === 2 ? "Fold" : "Waiting"}
              </li>
            ))}
          </ul>
          {round.phase === 1 && round.playerCount >= 2n && (
            <button type="button" disabled={busy} onClick={() => void send("Opening the challenge phase…", (box) => box.beginChallenge(roundId))}>
              Start challenge
            </button>
          )}
          {round.phase === 2 && (
            <div className="row">
              <button type="button" disabled={busy} onClick={() => void stakeConfidential()}>Challenge</button>
              {fallbackStake && (
                <button type="button" className="ghost" disabled={busy} onClick={() => void stakeFallback()}>
                  Fallback Payment
                </button>
              )}
              <button type="button" className="ghost" disabled={busy} onClick={() => void send("Folding…", (box) => box.fold(roundId))}>
                Fold
              </button>
              <button type="button" disabled={busy} onClick={() => void send("Comparing encrypted powers…", (box) => box.resolve(roundId))}>
                Resolve
              </button>
            </div>
          )}
          {account && round.powerHandle !== `0x${"0".repeat(64)}` && (
            <div>
              <p className="mono">Power handle: {round.powerHandle}</p>
              <p className="mono">Roll handle: {round.rollHandle}</p>
              <button type="button" disabled={granting || decrypt.isFetching} onClick={() => void decryptPower()}>
                {granting || decrypt.isFetching ? "Decrypting…" : "Decrypt my power"}
              </button>
              {(granting || decrypt.isFetching || (wantDecrypt && typeof powerValue !== "bigint")) && (
                <p className="status">Decryption in progress. The page stays usable.</p>
              )}
              {typeof powerValue === "bigint" && <p className="prize">Power {powerValue.toString()}</p>}
            </div>
          )}
          {round.winnerHandle !== `0x${"0".repeat(64)}` && (
            <div>
              <p className="mono">Winner handle: {round.winnerHandle}</p>
              {!round.claimed && (
                <button type="button" disabled={busy} onClick={() => void revealAndClaim()}>
                  Reveal winner and pay pot
                </button>
              )}
              {revealedWinner && <p className="prize">Winner {revealedWinner}</p>}
              {round.claimed && <p className="prize">Paid {round.winner}</p>}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h2>Audit</h2>
        <p>Contract: {SHOWDOWN_ADDRESS ? <a href={addressUrl(SHOWDOWN_ADDRESS)}>{SHOWDOWN_ADDRESS}</a> : "pending"}</p>
        {txHash && <p>Latest transaction: <a href={txUrl(txHash)}>{txHash}</a></p>}
        {SHOWDOWN_ROUND_TX && <p>Reference round: <a href={txUrl(SHOWDOWN_ROUND_TX)}>{SHOWDOWN_ROUND_TX}</a></p>}
        {SHOWDOWN_RESOLVE_TX && <p>Reference resolve: <a href={txUrl(SHOWDOWN_RESOLVE_TX)}>{SHOWDOWN_RESOLVE_TX}</a></p>}
        {txHash && <p><a href={`${EXPLORER}/tx/${txHash}#eventlog`}>View handles on Sepolia</a></p>}
      </div>
    </div>
  );
}
