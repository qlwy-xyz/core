import hre from "hardhat";

// 已部署的合约地址
const spiritAgentAddress = "0x49F138C893A03EAe32764650636255BFaB0f1eBc";
const spiritLogicAddress = "0x2F82830a1dAB5ff45317C96197fe5198f214d7A4";

async function main() {
  console.log("Setting default logic address on SpiritAgent...");
  console.log(`  SpiritAgent: ${spiritAgentAddress}`);
  console.log(`  SpiritLogic: ${spiritLogicAddress}`);
  console.log("");

  const connection = await hre.network.connect();
  const [signer] = await connection.viem.getWalletClients();
  const publicClient = await connection.viem.getPublicClient();

  const hash = await signer.writeContract({
    address: spiritAgentAddress as `0x${string}`,
    abi: [{
      inputs: [{ internalType: "address", name: "_logic", type: "address" }],
      name: "setDefaultLogic",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function",
    }],
    functionName: "setDefaultLogic",
    args: [spiritLogicAddress as `0x${string}`],
  });

  console.log(`Transaction hash: ${hash}`);
  console.log("Waiting for confirmation...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`);
  console.log("");
  console.log("Default logic address has been set successfully!");
  console.log("");
  console.log("Deployed contracts summary:");
  console.log(`  SpiritAgent: ${spiritAgentAddress}`);
  console.log(`  SpiritLogic: ${spiritLogicAddress}`);
  console.log(`  BattleV2: 0x196A3C8c6187d2FF092F3b0F1c2292978C7C1a4E`);
}

main().catch(console.error);

