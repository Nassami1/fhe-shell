import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import {
  CUSDT,
  EXPLORER,
  SHOWDOWN_ADDRESS,
  SHOWDOWN_DEPLOY_TX,
  SHOWDOWN_RESOLVE_TX,
  SHOWDOWN_ROUND_TX,
  UNDERLYING,
  addressUrl,
  txUrl,
} from "@/lib/config";

const ROWS = [
  ["Common", "60%", "10", "614 / 1024"],
  ["Rare", "25%", "30", "256 / 1024"],
  ["Epic", "12%", "70", "123 / 1024"],
  ["Legendary", "3%", "150", "31 / 1024"],
];

export default function HomePage() {
  const contract = SHOWDOWN_ADDRESS || "Pending Sepolia deployment";
  return (
    <>
      <SiteHeader />
      <main className="wrap">
        <section>
          <h1>Mystery Box Showdown</h1>
          <p className="lede">
            Open a 48-hour invite. Two players play three free shell hands and pay $1 to commit their score, even hours apart. The higher encrypted score takes $2, and neither score is revealed.
          </p>
          <Link href="/play" className="btn">
            Open a table
          </Link>
        </section>

        <section>
          <h2>Invite link</h2>
          <p>
            Opening the table and playing the three hands are free. Each player pays $1 only to commit their score. The link stays open for 48 hours, so the second player can play later.
            The contract compares the two encrypted scores and pays the $2 prize to the winner. The score values stay encrypted.
          </p>
        </section>

        <section>
          <h2>How the 2–5 player showdown works</h2>
          <ol>
            <li>Two to five players buy a box for 1 test token, in cUSDT or a labeled Fallback Payment.</li>
            <li>Each player receives a private power from <code>FHE.randEuint32(1024)</code> and <code>FHE.select</code>.</li>
            <li>Only that player can decrypt the score, then challenge with more stake or fold.</li>
            <li>The contract compares the remaining encrypted powers and the highest wins the pot.</li>
            <li>Anyone can audit the public odds and the on-chain roll handles.</li>
          </ol>
        </section>

        <section id="odds">
          <h2>Public odds and power</h2>
          <p>The published odds are 60 / 25 / 12 / 3. The draw uses 1024 slots because the random bound must be a power of two.</p>
          <table>
            <thead>
              <tr>
                <th>Box</th>
                <th>Odds</th>
                <th>Power</th>
                <th>Exact bucket</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([name, odds, power, bucket]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{odds}</td>
                  <td>{power}</td>
                  <td>{bucket}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section id="audit">
          <h2>Fairness / audit</h2>
          <p>
            Joining emits <code>PlayerJoined(roundId, player, powerHandle, randHandle)</code>. The roll is publicly
            decryptable. The power handle is allowed only to that player. Resolution emits a publicly decryptable winner handle.
          </p>
          <p>
            Explorer: <a href={EXPLORER}>Sepolia Etherscan</a>
          </p>
          <p className="mono">Contract: {contract.startsWith("0x") ? <a href={addressUrl(contract)}>{contract}</a> : contract}</p>
        </section>

        <section id="judging">
          <h2>Judging pack / Documentation</h2>
          <ul>
            <li>Network: Ethereum Sepolia (chain id 11155111).</li>
            <li>Contract: <span className="mono">{contract}</span></li>
            <li>cUSDT mock: <a href={addressUrl(CUSDT)}>{CUSDT}</a></li>
            <li>Underlying test USDT: <a href={addressUrl(UNDERLYING)}>{UNDERLYING}</a></li>
            <li>Deploy tx: {SHOWDOWN_DEPLOY_TX ? <a href={txUrl(SHOWDOWN_DEPLOY_TX)}>{SHOWDOWN_DEPLOY_TX}</a> : "Filled in the README after deploy."}</li>
            <li>Round tx: {SHOWDOWN_ROUND_TX ? <a href={txUrl(SHOWDOWN_ROUND_TX)}>{SHOWDOWN_ROUND_TX}</a> : "Filled in the README after the first round."}</li>
            <li>Resolve tx: {SHOWDOWN_RESOLVE_TX ? <a href={txUrl(SHOWDOWN_RESOLVE_TX)}>{SHOWDOWN_RESOLVE_TX}</a> : "Filled in the README after the encrypted comparison."}</li>
          </ul>
          <h3>Rules</h3>
          <p>Entry and challenge each cost 1.000000 token. Fold keeps the entry in the pot. A tie goes to the earlier challenger. Power 0 means the confidential payment check failed.</p>
          <h3>ABI summary</h3>
          <ul>
            <li><code>createRound()</code> opens a table for 2–5 players.</li>
            <li><code>joinRound</code> / <code>joinRoundFallback</code> take payment and store an encrypted power.</li>
            <li><code>challenge</code> / <code>challengeFallback</code> / <code>fold</code> record the decision.</li>
            <li><code>resolve</code> selects the highest encrypted power.</li>
            <li><code>claim</code> checks the public decryption proof and pays the pot.</li>
            <li><code>getOdds</code> and <code>getPlayerBox(player, roundId)</code> expose the table and the private handle.</li>
          </ul>
        </section>

        <section>
          <h2>Creator</h2>
          <p>air</p>
          <p>Role: Something else</p>
          <p>Contact: hackathon submission wallet on Sepolia. The key stays in a local <code>.env</code> file and is not in this repo.</p>
        </section>

        <section>
          <h2>Links</h2>
          <ul>
            <li><a href="https://docs.zama.org/protocol">Zama protocol docs</a></li>
            <li><a href="https://github.com/zama-ai/fhevm-hardhat-template">fhevm-hardhat-template</a></li>
            <li><a href="https://docs.zama.org/protocol/examples/">Protocol examples</a></li>
            <li><a href="https://community.zama.ai/">Zama forum</a></li>
          </ul>
        </section>
      </main>
      <footer className="wrap">Mystery Box Showdown · Zama Developer Program Season 5</footer>
    </>
  );
}
