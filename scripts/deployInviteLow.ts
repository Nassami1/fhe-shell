import { ethers } from "hardhat";

const CUSDT = "0x4E7B06D78965594eB5EF5414c357ca21E1554491";
const UNDERLYING = "0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0";

async function main() {
  const factory = await ethers.getContractFactory("MysteryBoxInvite");
  const fee = 1_000_000n;
  const contract = await factory.deploy(CUSDT, UNDERLYING, false, {
    maxFeePerGas: fee,
    maxPriorityFeePerGas: fee,
  });
  const tx = contract.deploymentTransaction();
  console.log("tx", tx?.hash);
  await contract.waitForDeployment();
  console.log("address", await contract.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
