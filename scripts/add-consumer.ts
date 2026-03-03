import "dotenv/config";
import hre from "hardhat";
import { type Address, type Hex, type WalletClient } from "viem";
import type { Account } from "viem/accounts";
import { privateKeyToAccount } from "viem/accounts";

// // testnet
// const vrfAddress = "0xa2d23627bC0314f4Cbd08Ff54EcB89bb45685053";
// const subscriptionId = 434n;
// const coreAddress = "0xE7b805442569ddd8e81AFc0628B8D8921f4BA67A";

// // mainnet
// const vrfAddress = "0x9632ADE542f12114f5E5AD4d6F8e47fB993955da";
// const subscriptionId = 102n;
// const coreAddress = "0xcE6f2F55898050C0D1769164c4Ceb828B4fC54f8";

// // baseSepolia
// const vrfAddress = "0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE";
// const subscriptionId = 38750191076683763643600661173834067593126258046985712337359642410579178335518n;
// const coreAddress = "0xcCCE1eA9fdE6b845B48d64E12E2151Be5A1C6ee3";

// base
const vrfAddress = "0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634";
const subscriptionId = 6365286977517996260482348856412290795318028311528020766656842489133998147812n;
const coreAddress = "0x8D5Ac3CdDa57b23EeC1BF9E6469c5694500573a2";

// const VRF_COORDINATOR_ABI = [
//   {
//     inputs: [
//       {
//         internalType: "uint64",
//         name: "subId",
//         type: "uint64",
//       },
//       {
//         internalType: "address",
//         name: "consumer",
//         type: "address",
//       },
//     ],
//     name: "addConsumer",
//     outputs: [],
//     stateMutability: "nonpayable",
//     type: "function",
//   },
//   {
//     inputs: [{ internalType: "uint64", name: "subId", type: "uint64" }],
//     name: "getSubscription",
//     outputs: [
//       { internalType: "uint96", name: "balance", type: "uint96" },
//       { internalType: "uint64", name: "reqCount", type: "uint64" },
//       { internalType: "address", name: "owner", type: "address" },
//       { internalType: "address[]", name: "consumers", type: "address[]" },
//     ],
//     stateMutability: "view",
//     type: "function",
//   },
// ] as const;

const VRF_COORDINATOR_ABI = [
  {
    inputs: [
      {
        internalType: "uint64",
        name: "subId",
        type: "uint256",
      },
      {
        internalType: "address",
        name: "consumer",
        type: "address",
      },
    ],
    name: "addConsumer",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "subId", type: "uint256" }],
    name: "getSubscription",
    outputs: [
      { internalType: "uint96", name: "balance", type: "uint96" },
      { internalType: "uint64", name: "reqCount", type: "uint64" },
      { internalType: "address", name: "owner", type: "address" },
      { internalType: "address[]", name: "consumers", type: "address[]" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

type NetworkConnection = Awaited<ReturnType<typeof hre.network.connect>>;

async function resolveWalletClient(
  connection: NetworkConnection
): Promise<{ walletClient: WalletClient; account: Account }> {
  const privateKey = process.env.BSC_PRIVATE_KEY;

  if (privateKey) {
    const account = privateKeyToAccount(`0x${privateKey}` as `0x${string}`);
    const walletClient = await connection.viem.getWalletClient(
      account.address,
      {
        account,
      }
    );
    return { walletClient, account };
  }

  const walletClients = await connection.viem.getWalletClients();
  if (walletClients.length === 0) {
    throw new Error(
      "No wallet client available. Set CREATE_VRF_PRIVATE_KEY (or BSC_TESTNET_PRIVATE_KEY) in .env."
    );
  }

  const walletClient = walletClients[0];
  if (!walletClient.account) {
    throw new Error("Wallet client is missing an associated account.");
  }

  return { walletClient, account: walletClient.account };
}

async function main() {
  const connection = await hre.network.connect();
  const publicClient = await connection.viem.getPublicClient();
  const { walletClient, account } = await resolveWalletClient(connection);

  const consumerAddress = coreAddress;

  const chain = walletClient.chain ?? undefined;

  console.log(
    `Adding consumer ${consumerAddress} to subscription ${subscriptionId.toString()} on ${
      connection.networkName
    } using coordinator ${vrfAddress}`
  );

  const txHash = await walletClient.writeContract({
    abi: VRF_COORDINATOR_ABI,
    address: vrfAddress,
    functionName: "addConsumer",
    args: [subscriptionId, consumerAddress as `0x${string}`],
    account,
    chain,
  });

  console.log(`Submitted transaction: ${txHash}`);

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  if (receipt.status !== "success") {
    throw new Error(
      `addConsumer transaction failed with status ${receipt.status}`
    );
  }

  const subscription = await publicClient.readContract({
    abi: VRF_COORDINATOR_ABI,
    address: vrfAddress,
    functionName: "getSubscription",
    args: [subscriptionId],
  });

  console.log("Updated subscription info:", subscription);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
