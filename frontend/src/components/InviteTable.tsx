"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";
import { useDecryptPublicValues, useDecryptValues, useEncrypt, useGrantPermit, useHasPermit, useShield } from "@zama-fhe/react-sdk";
import { cusdtAbi, erc20Abi } from "@/lib/abi";
import {
  BOX_PRICE,
  CUSDT,
  INVITE_ADDRESS,
  SEPOLIA_RPC_URL,
  UNDERLYING,
  addressUrl,
  explainChainError,
} from "@/lib/config";
import { inviteAbi } from "@/lib/inviteAbi";
import { useWallet } from "@/lib/wallet";

const HANDS = 3;

type InviteView = {
  host: string;
  deadline: number;
  phase: number;
  pot: bigint;
  player0: string;
  player1: string;
  winner: string;
  claimed: boolean;
  winnerHandle: string;
  hostHands: number;
  guestHands: number;
  hostCommitted: boolean;
  guestCommitted: boolean;
  ballHandle: string;
};

function short(address: string) {
  if (!address || address === "0x0000000000000000000000000000000000000000") return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function same(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

function timeLeft(deadline: number, now: number) {
  const left = deadline * 1000 - now;
  if (left <= 0) return "The 48-hour link is closed";
  const hours = Math.floor(left / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m left on this link`;
}

export function InviteTable() {
  const params = useSearchParams();
  const invited = params.get("invite") ?? "";
  const { account, provider: walletProvider } = useWallet();
  const [inviteId, setInviteId] = useState(invited);
  const [invite, setInvite] = useState<InviteView | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<number | null>(null);
  const [wantBall, setWantBall] = useState(false);
  const encrypt = useEncrypt();
  const shield = useShield({ address: CUSDT });
  const publicDecrypt = useDecryptPublicValues();
  const { mutateAsync: grantPermit } = useGrantPermit();
  const { data: hasPermit } = useHasPermit({
    contractAddresses: INVITE_ADDRESS ? [INVITE_ADDRESS] : [],
  });
  const ballReady = !!invite?.ballHandle && !/^0x0{64}$/i.test(invite.ballHandle);
  const ballDecrypt = useDecryptValues(
    ballReady ? [{ encryptedValue: invite.ballHandle as `0x${string}`, contractAddress: INVITE_ADDRESS }] : [],
    { enabled: wantBall && !!hasPermit && ballReady },
  );

  const link = useMemo(() => {
    if (!inviteId || typeof window === "undefined") return "";
    return `${window.location.origin}/play?invite=${inviteId}`;
  }, [inviteId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!invited) return;
    setInviteId(invited);
    void refresh(invited);
    const timer = window.setInterval(() => void refresh(invited), 12_000);
    return () => window.clearInterval(timer);
  }, [invited, account]);

  function reader() {
    return new Contract(INVITE_ADDRESS, inviteAbi, new JsonRpcProvider(SEPOLIA_RPC_URL));
  }

  async function signer() {
    const ethereum = walletProvider;
    if (!ethereum) throw new Error("Connect a wallet on Sepolia.");
    return new BrowserProvider(ethereum).getSigner();
  }

  async function refresh(id = inviteId) {
    if (!INVITE_ADDRESS || !id) return;
    const box = reader();
    const snap = await box.getInvite(id);
    if (snap.host === "0x0000000000000000000000000000000000000000") {
      setInvite(null);
      setError("This invite link is not an open table.");
      return;
    }
    const seats = await box.getSeats(id);
    const hands = await box.getHands(id);
    const committed = await box.getCommitted(id);
    const mine = same(account, seats.player0) ? 0 : same(account, seats.player1) ? 1 : -1;
    const iPlayed = mine === 0 ? hands.hostHands > 0 : mine === 1 ? hands.guestHands > 0 : false;
    const ballHandle = iPlayed ? ((await box.getBallHandle(id, mine)) as string) : `0x${"0".repeat(64)}`;
    setInvite({
      host: snap.host,
      deadline: Number(snap.deadline),
      phase: Number(snap.phase),
      pot: snap.pot,
      player0: seats.player0,
      player1: seats.player1,
      winner: snap.winner,
      claimed: snap.claimed,
      winnerHandle: snap.winnerHandle,
      hostHands: Number(hands.hostHands),
      guestHands: Number(hands.guestHands),
      hostCommitted: committed.hostCommitted,
      guestCommitted: committed.guestCommitted,
      ballHandle,
    });
  }

  async function ensureClear() {
    const wallet = await signer();
    const token = new Contract(UNDERLYING, erc20Abi, wallet);
    if ((await token.balanceOf(account)) >= BOX_PRICE) return;
    setStatus("Minting test USDT…");
    await (await token.mint(account, BOX_PRICE)).wait();
  }

  async function payConfidential() {
    await ensureClear();
    setStatus("Shielding $1 into cUSDT…");
    await shield.mutateAsync({ amount: BOX_PRICE });
    const wallet = await signer();
    const token = new Contract(CUSDT, cusdtAbi, wallet);
    if (!(await token.isOperator(account, INVITE_ADDRESS))) {
      setStatus("Approving the invite contract as a cUSDT operator…");
      const until = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
      await (await token.setOperator(INVITE_ADDRESS, until)).wait();
    }
    setStatus("Encrypting the $1 stake…");
    return encrypt.mutateAsync({
      values: [{ value: BOX_PRICE, type: "euint64" }],
      contractAddress: INVITE_ADDRESS,
      userAddress: account as `0x${string}`,
    });
  }

  function remember(id: string) {
    setInviteId(id);
    const next = `/play?invite=${id}`;
    window.history.replaceState(null, "", next);
  }

  async function createTable() {
    setBusy(true);
    setError("");
    try {
      setStatus("Opening the 48-hour link…");
      const box = new Contract(INVITE_ADDRESS, inviteAbi, await signer());
      const receipt = await (await box.createInvite()).wait();
      const id = readInviteId(box, receipt) ?? inviteId;
      remember(id);
      setStatus("Link is open. Play your three hands free, then pay $1 to commit your score.");
      await refresh(id);
    } catch (err) {
      setError(explainChainError(err));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function joinTable() {
    setBusy(true);
    setError("");
    try {
      setStatus("Taking the open seat…");
      const box = new Contract(INVITE_ADDRESS, inviteAbi, await signer());
      await (await box.joinInvite(inviteId)).wait();
      setStatus("Seat taken. Play your three hands free, then pay $1 to commit your score.");
      await refresh();
    } catch (err) {
      setError(explainChainError(err));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function commitConfidential() {
    setBusy(true);
    setError("");
    setFallback(false);
    try {
      const encrypted = await payConfidential();
      setStatus("Paying $1 and committing your score…");
      const box = new Contract(INVITE_ADDRESS, inviteAbi, await signer());
      await (await box.commit(inviteId, encrypted.encryptedValues[0], encrypted.inputProof)).wait();
      setStatus("Score committed. The other player commits to resolve the round.");
      await refresh();
    } catch (err) {
      setError(`cUSDT stake failed: ${explainChainError(err)}`);
      setFallback(true);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function commitClear() {
    setBusy(true);
    setError("");
    try {
      await ensureClear();
      const wallet = await signer();
      const token = new Contract(UNDERLYING, erc20Abi, wallet);
      if ((await token.allowance(account, INVITE_ADDRESS)) < BOX_PRICE) {
        setStatus("Fallback Payment: approving $1…");
        await (await token.approve(INVITE_ADDRESS, BOX_PRICE)).wait();
      }
      setStatus("Fallback Payment: committing your score…");
      const box = new Contract(INVITE_ADDRESS, inviteAbi, wallet);
      await (await box.commitFallback(inviteId)).wait();
      setFallback(false);
      setStatus("Score committed. The other player commits to resolve the round.");
      await refresh();
    } catch (err) {
      setError(`Fallback Payment failed: ${explainChainError(err)}`);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  function startRound() {
    setChosen(null);
    setWantBall(false);
    setPicking(false);
    setStatus("Shuffling the cups…");
    window.setTimeout(() => {
      setPicking(true);
      setStatus(`Hand ${myHands + 1} of ${HANDS} — pick a cup. Playing is free.`);
    }, 900);
  }

  async function playCup(cup: number) {
    setBusy(true);
    setError("");
    setChosen(cup);
    try {
      setStatus("Sealing your hand…");
      const box = new Contract(INVITE_ADDRESS, inviteAbi, await signer());
      await (await box.play(inviteId, cup)).wait();
      if (!hasPermit) {
        setStatus("Sign the permit to see your own cup…");
        await grantPermit([INVITE_ADDRESS]);
      }
      setWantBall(true);
      setPicking(false);
      setStatus(myHands + 1 >= HANDS ? "Three hands played. Pay $1 to commit your score." : "Hand sealed. Play the next one.");
      await refresh();
    } catch (err) {
      setError(explainChainError(err));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function claim() {
    if (!invite || /^0x0{64}$/i.test(invite.winnerHandle)) return;
    setBusy(true);
    setError("");
    try {
      setStatus("Proving the winner address. Scores stay encrypted…");
      const revealed = await publicDecrypt.mutateAsync([invite.winnerHandle as `0x${string}`]);
      const box = new Contract(INVITE_ADDRESS, inviteAbi, await signer());
      await (await box.claim(inviteId, revealed.abiEncodedClearValues, revealed.decryptionProof)).wait();
      setStatus("The $2 prize is paid. Neither score was revealed.");
      await refresh();
    } catch (err) {
      setError(explainChainError(err));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function refund() {
    setBusy(true);
    setError("");
    try {
      setStatus("Returning the committed stake…");
      const box = new Contract(INVITE_ADDRESS, inviteAbi, await signer());
      await (await box.refundExpired(inviteId)).wait();
      setStatus("The committed stake is back.");
      await refresh();
    } catch (err) {
      setError(explainChainError(err));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  const mySlot = invite && same(account, invite.player0) ? 0 : invite && same(account, invite.player1) ? 1 : -1;
  const seated = mySlot >= 0;
  const myHands = mySlot === 0 ? invite?.hostHands ?? 0 : mySlot === 1 ? invite?.guestHands ?? 0 : 0;
  const myCommitted = mySlot === 0 ? !!invite?.hostCommitted : mySlot === 1 ? !!invite?.guestCommitted : false;
  const otherCommitted = mySlot === 0 ? !!invite?.guestCommitted : mySlot === 1 ? !!invite?.hostCommitted : false;
  const open = invite?.phase === 1;
  const expired = open && invite.deadline * 1000 <= now;
  const waiting = open && !expired && invite.player1 === "0x0000000000000000000000000000000000000000";
  const sealed = invite?.phase === 2 && !invite.claimed;
  const canPlay = seated && open && !expired && myHands < HANDS;
  const canCommit = seated && open && !expired && myHands >= HANDS && !myCommitted;
  const myBall = ballReady ? Number(ballDecrypt.data?.[invite.ballHandle as `0x${string}`]) : NaN;
  const ballKnown = Number.isInteger(myBall);

  return (
    <main className="table-room">
      <div className="curtain left" />
      <div className="curtain right" />
      <div className="bulbs" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => (
          <i key={index} />
        ))}
      </div>
      <header className="marquee">
        <div className="over">★ ★ ★ TWO SEATS ★ ★ ★</div>
        <h1>Shell table</h1>
        <p>Play three free hands. Pay $1 to commit your score. The higher hidden total takes $2.</p>
      </header>
      <div className="hud">
        <div className="chip-stat">
          <b>$1</b>
          <span>EACH STAKE</span>
        </div>
        <div className="chip-stat">
          <b>$2</b>
          <span>WINNER PRIZE</span>
        </div>
        <div className="chip-stat">
          <b>3</b>
          <span>FREE HANDS</span>
        </div>
        <div className="chip-stat">
          <b>48h</b>
          <span>LINK STAYS OPEN</span>
        </div>
      </div>
      <div className="felt-wrap">
        <div className="felt">
          <div className="felt-logo">♦ PICK A CUP ♦</div>
          <div className={`cups ${picking ? "picking" : ""}`}>
            {[0, 1, 2].map((cup) => (
              <button
                key={cup}
                type="button"
                className={`cup ${ballKnown && myBall === cup ? "lift" : ""} ${chosen === cup ? "chosen" : ""}`}
                aria-label={`Cup ${cup + 1}`}
                disabled={!picking || busy}
                onClick={() => void playCup(cup)}
              >
                <span className={`ball ${ballKnown && myBall === cup ? "show" : ""}`} />
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className={`table-msg ${error ? "bad" : "info"}`}>
        {error ||
          status ||
          (ballKnown
            ? chosen !== null && myBall === chosen
              ? "The ball was under the cup you picked. Your score stays encrypted."
              : chosen !== null
                ? "The ball was under a different cup. Your score stays encrypted."
                : "Your cup is revealed. Your score stays encrypted."
            : "Play your three hands free. The other player does not have to be here.")}
      </p>
      <div className="table-controls">
        {!invite && (
          <button type="button" disabled={!account || !INVITE_ADDRESS || busy} onClick={() => void createTable()}>
            Open a table
          </button>
        )}
        {waiting && !seated && (
          <button type="button" disabled={!account || busy} onClick={() => void joinTable()}>
            Take the open seat
          </button>
        )}
        {canPlay && !picking && (
          <button type="button" disabled={busy} onClick={startRound}>
            Play hand {myHands + 1} of {HANDS}
          </button>
        )}
        {canCommit && (
          <button type="button" disabled={!account || busy} onClick={() => void commitConfidential()}>
            Pay $1 and commit score
          </button>
        )}
        {myCommitted && open && !otherCommitted && <span className="fast-badge">Score committed. The other player commits to resolve.</span>}
        {sealed && (
          <button type="button" disabled={!account || busy} onClick={() => void claim()}>
            Pay the $2 prize
          </button>
        )}
        {expired && (
          <button type="button" disabled={!account || busy} onClick={() => void refund()}>
            Refund the committed stake
          </button>
        )}
        {fallback && (
          <button type="button" className="ghost" disabled={!account || busy} onClick={() => void commitClear()}>
            Fallback Payment
          </button>
        )}
      </div>
      {link && invite && (
        <div className="invite-link">
          <span>Invitation link</span>
          <code>{link}</code>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              void navigator.clipboard.writeText(link);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          {open && <p>{timeLeft(invite.deadline, now)}</p>}
        </div>
      )}
      {invite?.claimed && (
        <p className="table-msg good">
          {same(account, invite.winner) ? "You won $2." : `The $2 prize went to ${short(invite.winner)}.`} Neither score was revealed.
        </p>
      )}
      {invite && (
        <p className="seat-line">
          Seat 1 {short(invite.player0) || "open"}
          {" · "}
          Seat 2 {short(invite.player1) || "open"}
          {invite.host && (
            <>
              {" · "}
              <a href={addressUrl(INVITE_ADDRESS)}>Contract</a>
            </>
          )}
        </p>
      )}
      {!INVITE_ADDRESS && <p className="table-msg bad">The invite contract is not on Sepolia yet.</p>}
      {!account && <p className="table-msg info">Connect a wallet on Sepolia. The other player can open the link later.</p>}
      <p className="seat-line">
        <Link href="/showdown">2–5 player showdown</Link>
      </p>
    </main>
  );
}

function readInviteId(box: Contract, receipt: { logs: Array<{ topics: string[]; data: string }> }) {
  const parsed = receipt.logs
    .map((log) => {
      try {
        return box.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((item) => item?.name === "InviteCreated");
  return (parsed?.args?.inviteId as bigint | undefined)?.toString();
}
