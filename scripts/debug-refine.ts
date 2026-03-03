import { createPublicClient, http, formatEther } from "viem";
import { bsc } from "viem/chains";

const REFINERY_ADDRESS = "0x1D3365855A1C33A5973bf36E583706904bEd073e";
const USER_ADDRESS = "0xfE4EA61657b3BE3254ce5B35D9BA1f078d9A6174";
const TOKEN_IDS = [2234n, 2138n, 2013n];

// 使用公共 RPC
const publicClient = createPublicClient({
  chain: bsc,
  transport: http("https://bsc-dataseed1.binance.org"),
});

const ERC721_ABI = [
  {
    inputs: [{ type: "uint256" }],
    name: "ownerOf",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ type: "uint256" }],
    name: "tokenRarityOf",
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ type: "address" }, { type: "address" }],
    name: "isApprovedForAll",
    outputs: [{ type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const ERC20_ABI = [
  {
    inputs: [{ type: "address" }, { type: "address" }],
    name: "allowance",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ type: "address" }],
    name: "balanceOf",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const REFINERY_ABI = [
  {
    inputs: [],
    name: "fortuneCore",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "qlwyToken",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "paused",
    outputs: [{ type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ type: "uint256" }],
    name: "refineFees",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

async function main() {
  console.log("=== Debug Refine ===");
  console.log("Refinery:", REFINERY_ADDRESS);
  console.log("User:", USER_ADDRESS);
  console.log("Token IDs:", TOKEN_IDS.map(String).join(", "));

  // 1. 获取 Core 和 QLWY 地址
  const [coreAddress, qlwyAddress, paused] = await Promise.all([
    publicClient.readContract({
      address: REFINERY_ADDRESS as `0x${string}`,
      abi: REFINERY_ABI,
      functionName: "fortuneCore",
    }),
    publicClient.readContract({
      address: REFINERY_ADDRESS as `0x${string}`,
      abi: REFINERY_ABI,
      functionName: "qlwyToken",
    }),
    publicClient.readContract({
      address: REFINERY_ADDRESS as `0x${string}`,
      abi: REFINERY_ABI,
      functionName: "paused",
    }),
  ]);

  console.log("\n--- Contract Addresses ---");
  console.log("Core:", coreAddress);
  console.log("QLWY:", qlwyAddress);
  console.log("Paused:", paused);

  if (paused) {
    console.log("\n❌ CONTRACT IS PAUSED!");
    return;
  }

  // 2. 检查每个 NFT 的所有权和稀有度
  console.log("\n--- NFT Status ---");
  const rarities: number[] = [];

  for (const tokenId of TOKEN_IDS) {
    try {
      const [owner, rarity] = await Promise.all([
        publicClient.readContract({
          address: coreAddress as `0x${string}`,
          abi: ERC721_ABI,
          functionName: "ownerOf",
          args: [tokenId],
        }),
        publicClient.readContract({
          address: coreAddress as `0x${string}`,
          abi: ERC721_ABI,
          functionName: "tokenRarityOf",
          args: [tokenId],
        }),
      ]);

      const isOwner = owner.toLowerCase() === USER_ADDRESS.toLowerCase();
      rarities.push(rarity);
      console.log(`Token ${tokenId}: owner=${isOwner ? "✅ USER" : "❌ " + owner}, rarity=${rarity}`);
    } catch (e: any) {
      console.log(`Token ${tokenId}: ❌ ERROR - ${e.message}`);
    }
  }

  // 检查稀有度一致性
  if (rarities.length === 3) {
    const allSame = rarities.every(r => r === rarities[0]);
    console.log(`Rarity consistency: ${allSame ? "✅ All same" : "❌ Different rarities!"}`);

    if (rarities[0] === 0) {
      console.log("❌ Common (0) cannot be refined!");
    } else if (rarities[0] >= 4) {
      console.log("❌ Mythic (4+) cannot be refined!");
    }
  }

  // 3. 检查 NFT 授权
  console.log("\n--- Approvals ---");
  const isNFTApproved = await publicClient.readContract({
    address: coreAddress as `0x${string}`,
    abi: ERC721_ABI,
    functionName: "isApprovedForAll",
    args: [USER_ADDRESS as `0x${string}`, REFINERY_ADDRESS as `0x${string}`],
  });
  console.log(`NFT approved: ${isNFTApproved ? "✅" : "❌"}`);

  // 4. 检查 QLWY 余额和授权
  const [qlwyBalance, qlwyAllowance] = await Promise.all([
    publicClient.readContract({
      address: qlwyAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [USER_ADDRESS as `0x${string}`],
    }),
    publicClient.readContract({
      address: qlwyAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [USER_ADDRESS as `0x${string}`, REFINERY_ADDRESS as `0x${string}`],
    }),
  ]);

  // 获取需要的费用
  const baseRarity = rarities[0] || 1;
  const feeIndex = baseRarity - 1;
  const refineFee = await publicClient.readContract({
    address: REFINERY_ADDRESS as `0x${string}`,
    abi: REFINERY_ABI,
    functionName: "refineFees",
    args: [BigInt(feeIndex)],
  });

  console.log(`QLWY balance: ${formatEther(qlwyBalance)} (need ${formatEther(refineFee)})`);
  console.log(`QLWY allowance: ${formatEther(qlwyAllowance)} ${qlwyAllowance >= refineFee ? "✅" : "❌"}`);

  // 5. 总结
  console.log("\n=== Summary ===");
  const issues: string[] = [];

  if (paused) issues.push("Contract is paused");
  if (!isNFTApproved) issues.push("NFT not approved for Refinery");
  if (qlwyBalance < refineFee) issues.push(`Insufficient QLWY balance (need ${formatEther(refineFee)})`);
  if (qlwyAllowance < refineFee) issues.push(`Insufficient QLWY allowance (need ${formatEther(refineFee)})`);
  if (rarities.length === 3 && !rarities.every(r => r === rarities[0])) {
    issues.push("NFTs have different rarities");
  }
  if (rarities[0] === 0) issues.push("Common tokens cannot be refined");
  if (rarities[0] >= 4) issues.push("Mythic tokens cannot be refined");

  if (issues.length === 0) {
    console.log("✅ All checks passed! The issue might be VRF related.");
  } else {
    console.log("❌ Issues found:");
    issues.forEach(i => console.log(`   - ${i}`));
  }
}

main().catch(console.error);

