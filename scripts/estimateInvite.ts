import { ethers } from "hardhat";

const CUSDT = "0x4E7B06D78965594eB5EF5414c357ca21E1554491";
const UNDERLYING = "0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0";

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  const fee = await ethers.provider.getFeeData();
  const factory = await ethers.getContractFactory("MysteryBoxInvite");
  const tx = await factory.getDeployTransaction(CUSDT, UNDERLYING, false);
  const gas = await ethers.provider.estimateGas({ ...tx, from: deployer.address });
  const price = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  console.log("balance", balance.toString());
  console.log("gas", gas.toString());
  console.log("maxFeePerGas", (fee.maxFeePerGas ?? 0n).toString());
  console.log("gasPrice", (fee.gasPrice ?? 0n).toString());
  console.log("maxCost", (gas * price).toString());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
