import { ethers, fhevm } from "hardhat";

const BOX = "0x82d75EFbCA8e086565cB2CCEb270B0625dE6b348";
const CUSDT = "0x4E7B06D78965594eB5EF5414c357ca21E1554491";
const UNDERLYING = "0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0";
const PRICE = 1_000_000n;

async function main() {
  const [signer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(signer.address);
  console.log("signer", signer.address);
  console.log("eth", ethers.formatEther(balance));

  const box = await ethers.getContractAt("MysteryBox", BOX, signer);
  const underlying = new ethers.Contract(
    UNDERLYING,
    [
      "function mint(address to, uint256 amount)",
      "function balanceOf(address) view returns (uint256)",
      "function approve(address spender, uint256 amount) returns (bool)",
      "function allowance(address owner, address spender) view returns (uint256)",
    ],
    signer,
  );
  const cusdt = new ethers.Contract(
    CUSDT,
    [
      "function wrap(address to, uint256 amount)",
      "function isOperator(address holder, address spender) view returns (bool)",
      "function setOperator(address operator, uint48 until)",
    ],
    signer,
  );

  const clear = (await underlying.balanceOf(signer.address)) as bigint;
  console.log("underlying", clear.toString());
  if (clear < PRICE) {
    const mintTx = await underlying.mint(signer.address, PRICE);
    console.log("mint", mintTx.hash);
    await mintTx.wait();
  }

  let confidentialOk = false;
  try {
    const allowance = (await underlying.allowance(signer.address, CUSDT)) as bigint;
    if (allowance < PRICE) {
      const approveTx = await underlying.approve(CUSDT, PRICE);
      console.log("approve-wrapper", approveTx.hash);
      await approveTx.wait();
    }
    const wrapTx = await cusdt.wrap(signer.address, PRICE);
    console.log("wrap", wrapTx.hash);
    await wrapTx.wait();

    const isOp = (await cusdt.isOperator(signer.address, BOX)) as boolean;
    if (!isOp) {
      const until = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
      const opTx = await cusdt.setOperator(BOX, until);
      console.log("operator", opTx.hash);
      await opTx.wait();
    }

    const encrypted = await fhevm.createEncryptedInput(BOX, signer.address).add64(PRICE).encrypt();
    const buyTx = await box.buyBox(encrypted.handles[0], encrypted.inputProof);
    console.log("buy", buyTx.hash);
    const receipt = await buyTx.wait();
    console.log("buy-status", receipt?.status);
    confidentialOk = receipt?.status === 1;
  } catch (err) {
    console.log("CUSDT_ATTEMPT_FAILED");
    console.log(err instanceof Error ? err.message : err);
  }

  if (confidentialOk) return;

  const clearAfter = (await underlying.balanceOf(signer.address)) as bigint;
  if (clearAfter < PRICE) {
    const mintTx = await underlying.mint(signer.address, PRICE);
    console.log("mint-fallback", mintTx.hash);
    await mintTx.wait();
  }
  const allowance = (await underlying.allowance(signer.address, BOX)) as bigint;
  if (allowance < PRICE) {
    const approveTx = await underlying.approve(BOX, PRICE);
    console.log("approve-fallback", approveTx.hash);
    await approveTx.wait();
  }
  const fallbackTx = await box.buyBoxFallback();
  console.log("fallback", fallbackTx.hash);
  const receipt = await fallbackTx.wait();
  console.log("fallback-status", receipt?.status);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
