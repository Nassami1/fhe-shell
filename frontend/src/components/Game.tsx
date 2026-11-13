"use client";

import { useEffect, useState } from "react";
import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";
import { useDecryptValues, useEncrypt, useGrantPermit, useHasPermit, useShield } from "@zama-fhe/react-sdk";
import { cusdtAbi, erc20Abi, mysteryBoxAbi } from "@/lib/abi";
import {
  BOX_PRICE,
  BUY_TX,
  CONTRACT_ADDRESS,
  CUSDT,
  EXPLORER,
  PRIZE_NAMES,
  SEPOLIA_RPC_URL,
  UNDERLYING,
  addressUrl,
  txUrl,
} from "@/lib/config";
import { getEthereumProvider } from "@/lib/ethereum";
import { useWallet } from "@/lib/wallet";

type Opened = {
  boxId: string;
  prizeHandle: string;
  randHandle: string;
  txHash: string;
  kind: number;
};

function explain(err: unknown) {
  const raw = err instanceof Error ? err.message : "Transaction failed";
  return raw.length > 280 ? `${raw.slice(0, 280)}…` : raw;
}

export function Game() {
  const { account, connect, provider: walletProvider, error: walletError } = useWallet();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [opened, setOpened] = useState<Opened | null>(null);
  const [fallbackReady, setFallbackReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wantDecrypt, setWantDecrypt] = useState(false);

  const encrypt = useEncrypt();
  const shield = useShield({ address: CUSDT });
  const { mutateAsync: grantPermit, isPending: granting } = useGrantPermit();
  const { data: hasPermit } = useHasPermit({
    contractAddresses: CONTRACT_ADDRESS ? [CONTRACT_ADDRESS] : [],
  });

  const decryptInputs =
    opened && CONTRACT_ADDRESS
      ? [{ encryptedValue: opened.prizeHandle as `0x${string}`, contractAddress: CONTRACT_ADDRESS }]
      : [];
  const decrypt = useDecryptValues(decryptInputs, {
    enabled: wantDecrypt && !!hasPermit && decryptInputs.length > 0,
  });

  const prizeValue = opened ? decrypt.data?.[opened.prizeHandle as `0x${string}`] : undefined;
  const prizeLabel =
    typeof prizeValue === "bigint" ? PRIZE_NAMES[Number(prizeValue)] ?? `Prize ${prizeValue}` : "";

  async function signer() {
    const ethereum = walletProvider ?? getEthereumProvider();
    if (!ethereum) throw new Error("No wallet found.");
    const provider = new BrowserProvider(ethereum);
    return provider.getSigner();
  }

  async function readOpened(receiptHash: string, buyer: string, boxIdHint?: bigint) {
    const reader = new Contract(CONTRACT_ADDRESS, mysteryBoxAbi, new JsonRpcProvider(SEPOLIA_RPC_URL));
    const boxId = boxIdHint ?? (await reader.boxCount(buyer));
    let prizeHandle = "0x" + "0".repeat(64);
    let randHandle = prizeHandle;
    let kind = 0;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      prizeHandle = await reader.getBox(buyer, boxId);
      randHandle = await reader.getRoll(buyer, boxId);
      kind = Number(await reader.paymentKind(buyer, boxId));
      if (prizeHandle !== "0x" + "0".repeat(64)) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    setOpened({
      boxId: boxId.toString(),
      prizeHandle,
      randHandle,
      txHash: receiptHash,
      kind,
    });
    setWantDecrypt(false);
  }

  async function ensureClearUsdt(buyer: string) {
    const wallet = await signer();
    const token = new Contract(UNDERLYING, erc20Abi, wallet);
    const balance = (await token.balanceOf(buyer)) as bigint;
    if (balance >= BOX_PRICE) return;
    setStatus("Minting test USDT for this wallet…");
    const mintTx = await token.mint(buyer, BOX_PRICE);
    await mintTx.wait();
  }

  async function ensureOperator(buyer: string) {
    const wallet = await signer();
    const token = new Contract(CUSDT, cusdtAbi, wallet);
    const approved = (await token.isOperator(buyer, CONTRACT_ADDRESS)) as boolean;
    if (approved) return;
    setStatus("Approving the box contract as a cUSDT operator…");
    const until = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
    const tx = await token.setOperator(CONTRACT_ADDRESS, until);
    await tx.wait();
  }

  async function buyConfidential() {
    if (!CONTRACT_ADDRESS || !account) return;
    setBusy(true);
    setError("");
    setFallbackReady(false);
    setOpened(null);
    try {
      await ensureClearUsdt(account);
      setStatus("Shielding 1 USDT into cUSDT…");
      await shield.mutateAsync({ amount: BOX_PRICE });
      await ensureOperator(account);
      setStatus("Encrypting the price…");
      const encrypted = await encrypt.mutateAsync({
        values: [{ value: BOX_PRICE, type: "euint64" }],
        contractAddress: CONTRACT_ADDRESS,
        userAddress: account as `0x${string}`,
      });
      setStatus("Submitting the cUSDT buy…");
      const wallet = await signer();
      const box = new Contract(CONTRACT_ADDRESS, mysteryBoxAbi, wallet);
      const tx = await box.buyBox(encrypted.encryptedValues[0], encrypted.inputProof);
      setStatus("Waiting for the Sepolia receipt…");
      const receipt = await tx.wait();
      await readOpened(receipt.hash, account);
      setStatus("Box opened. The prize is still encrypted.");
    } catch (err) {
      setStatus("");
      setError(`cUSDT buy failed: ${explain(err)}`);
      setFallbackReady(true);
    } finally {
      setBusy(false);
    }
  }

  async function buyFallback() {
    if (!CONTRACT_ADDRESS || !account) return;
    setBusy(true);
    setError("");
    try {
      await ensureClearUsdt(account);
      const wallet = await signer();
      const token = new Contract(UNDERLYING, erc20Abi, wallet);
      const allowance = (await token.allowance(account, CONTRACT_ADDRESS)) as bigint;
      if (allowance < BOX_PRICE) {
        setStatus("Fallback Payment: approving clear test USDT…");
        const approveTx = await token.approve(CONTRACT_ADDRESS, BOX_PRICE);
        await approveTx.wait();
      }
      setStatus("Fallback Payment: buying the box…");
      const box = new Contract(CONTRACT_ADDRESS, mysteryBoxAbi, wallet);
      const tx = await box.buyBoxFallback();
      setStatus("Waiting for the Sepolia receipt…");
      const receipt = await tx.wait();
      await readOpened(receipt.hash, account);
      setStatus("Box opened with Fallback Payment. The prize is still encrypted.");
      setFallbackReady(false);
    } catch (err) {
      setError(`Fallback Payment failed: ${explain(err)}`);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function decryptPrize() {
    if (!CONTRACT_ADDRESS || !opened) return;
    setError("");
    try {
      if (!hasPermit) {
        setStatus("Sign the decryption permit in your wallet…");
        await grantPermit([CONTRACT_ADDRESS]);
      }
      setWantDecrypt(true);
      setStatus("Decrypting your prize…");
    } catch (err) {
      setStatus("");
      setError(explain(err));
    }
  }

  useEffect(() => {
    if (wantDecrypt && prizeLabel) setStatus("Prize decrypted for this wallet only.");
  }, [wantDecrypt, prizeLabel]);

  return (
    <div>
      <div className="row">
        <button type="button" onClick={() => void connect()}>
          {account ? `Wallet ${account.slice(0, 6)}…${account.slice(-4)}` : "Connect wallet"}
        </button>
        <button type="button" disabled={!account || !CONTRACT_ADDRESS || busy} onClick={() => void buyConfidential()}>
          {busy ? "Working…" : "Buy box"}
        </button>
        {fallbackReady && (
          <button type="button" className="ghost" disabled={busy} onClick={() => void buyFallback()}>
            Fallback Payment
          </button>
        )}
      </div>

      <p className="status">{status}</p>
      {(error || walletError) && <p>{error || walletError}</p>}
      {!CONTRACT_ADDRESS && <p>The Sepolia contract address is not set yet. Deploy, then refresh.</p>}

      <div className="card">
        <h2>Public odds</h2>
        <table>
          <thead>
            <tr>
              <th>Prize</th>
              <th>Published</th>
              <th>Exact bucket</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Common</td>
              <td>60%</td>
              <td>614 / 1024</td>
            </tr>
            <tr>
              <td>Rare</td>
              <td>25%</td>
              <td>256 / 1024</td>
            </tr>
            <tr>
              <td>Epic</td>
              <td>12%</td>
              <td>123 / 1024</td>
            </tr>
            <tr>
              <td>Legendary</td>
              <td>3%</td>
              <td>31 / 1024</td>
            </tr>
          </tbody>
        </table>
      </div>

      {opened && (
        <div className="card">
          <h2>Box {opened.boxId}</h2>
          <p>{opened.kind === 2 ? "Paid with Fallback Payment (clear test USDT)." : "Paid with confidential cUSDT."}</p>
          <p>
            Transaction: <a href={txUrl(opened.txHash)}>{opened.txHash}</a>
          </p>
          <p className="mono">Prize handle: {opened.prizeHandle}</p>
          <p className="mono">Roll handle: {opened.randHandle}</p>
          <p>
            <a href={`${EXPLORER}/tx/${opened.txHash}#eventlog`}>View handles on Sepolia</a>
          </p>
          <button type="button" disabled={granting || decrypt.isFetching} onClick={() => void decryptPrize()}>
            {granting || decrypt.isFetching ? "Decrypting…" : "Decrypt my prize"}
          </button>
          {(granting || decrypt.isFetching || (wantDecrypt && !prizeLabel)) && <p className="status">Decryption in progress. The page stays usable.</p>}
          {prizeLabel && <p className="prize">{prizeLabel}</p>}
        </div>
      )}

      <div className="card">
        <h2>Audit</h2>
        <p>
          Contract:{" "}
          {CONTRACT_ADDRESS ? <a href={addressUrl(CONTRACT_ADDRESS)}>{CONTRACT_ADDRESS}</a> : "not deployed"}
        </p>
        {BUY_TX && (
          <p>
            Reference buy: <a href={txUrl(BUY_TX)}>{BUY_TX}</a>
          </p>
        )}
      </div>
    </div>
  );
}
