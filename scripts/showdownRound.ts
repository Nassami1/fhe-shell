import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { Wallet } from "ethers";

const SHOWDOWN = "0xAB2A568152705A74370D9B06265A21406Df6499A";
const UNDERLYING = "0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0";
const FEE = 1_000_000n;

async function main() {
  await fhevm.initializeCLIApi();
  const [host] = await ethers.getSigners();
  const rival = Wallet.createRandom().connect(ethers.provider);
  console.log("host", host.address);
  console.log("rival", rival.address);
  console.log("eth", ethers.formatEther(await ethers.provider.getBalance(host.address)));

  const fund = await host.sendTransaction({ to: rival.address, value: ethers.parseEther("0.006") });
  console.log("fund", fund.hash);
  await fund.wait();

  const showdown = await ethers.getContractAt("MysteryBoxShowdown", SHOWDOWN, host);
  const rivalBox = showdown.connect(rival);
  const ercAbi = [
    "function mint(address to, uint256 amount)",
    "function approve(address spender, uint256 amount) returns (bool)",
  ];
  const hostToken = new ethers.Contract(UNDERLYING, ercAbi, host);
  const rivalToken = hostToken.connect(rival);
  await (await hostToken.mint(host.address, FEE * 2n)).wait();
  await (await rivalToken.mint(rival.address, FEE * 2n)).wait();
  await (await hostToken.approve(SHOWDOWN, FEE * 2n)).wait();
  await (await rivalToken.approve(SHOWDOWN, FEE * 2n)).wait();

  const roundId = await showdown.createRound.staticCall();
  const created = await showdown.createRound();
  console.log("create", created.hash);
  await created.wait();

  const joinHost = await showdown.joinRoundFallback(roundId);
  console.log("join-host", joinHost.hash);
  await joinHost.wait();
  const joinRival = await rivalBox.joinRoundFallback(roundId);
  console.log("join-rival", joinRival.hash);
  await joinRival.wait();

  const hostHandle = await showdown.getPlayerBox(host.address, roundId);
  const rivalHandle = await showdown.getPlayerBox(rival.address, roundId);
  const hostPower = await fhevm.userDecryptEuint(FhevmType.euint32, hostHandle, SHOWDOWN, host);
  const rivalPower = await fhevm.userDecryptEuint(FhevmType.euint32, rivalHandle, SHOWDOWN, rival);
  console.log("host-power", hostPower.toString());
  console.log("rival-power", rivalPower.toString());

  await (await showdown.beginChallenge(roundId)).wait();
  const challengeHost = await showdown.challengeFallback(roundId);
  console.log("challenge-host", challengeHost.hash);
  await challengeHost.wait();
  await (await rivalBox.challengeFallback(roundId)).wait();

  const resolved = await showdown.resolve(roundId);
  console.log("resolve", resolved.hash);
  await resolved.wait();

  const winnerHandle = await showdown.getWinnerHandle(roundId);
  const revealed = await fhevm.publicDecrypt([winnerHandle]);
  const winner = revealed.clearValues[winnerHandle];
  console.log("winner", winner);
  const expected = hostPower > rivalPower ? host.address : rivalPower > hostPower ? rival.address : host.address;
  if (String(winner).toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`winner ${winner} did not match higher power ${expected}`);
  }

  const claimed = await showdown.claim(roundId, revealed.abiEncodedClearValues, revealed.decryptionProof);
  console.log("claim", claimed.hash);
  await claimed.wait();
  console.log("round", roundId.toString());
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
