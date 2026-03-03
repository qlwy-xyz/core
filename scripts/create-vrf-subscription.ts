import "dotenv/config";
import hre from "hardhat";
import {
  decodeEventLog,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import type { Account } from "viem/accounts";
import { privateKeyToAccount } from "viem/accounts";

// // testnet
// const vrfAddress = "0xa2d23627bC0314f4Cbd08Ff54EcB89bb45685053";

// mainnet
const vrfAddress = "0x9632ADE542f12114f5E5AD4d6F8e47fB993955da";

// //base sepolia
// const vrfAddress = "0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE";
// base sepolia
// const vrfAddress = "0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634";

const VRF_COORDINATOR_ABI = [
  {
    inputs: [],
    name: "createSubscription",
    outputs: [{ internalType: "uint64", name: "", type: "uint64" }],
    stateMutability: "nonpayable",
    type: "function",
  },

  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint64",
        name: "subId",
        type: "uint64",
      },
      {
        indexed: false,
        internalType: "address",
        name: "owner",
        type: "address",
      },
    ],
    name: "SubscriptionCreated",
    type: "event",
  },
  // {
  //   anonymous: false,
  //   inputs: [
  //     {
  //       indexed: true,
  //       internalType: "uint256",
  //       name: "subId",
  //       type: "uint256",
  //     },
  //     {
  //       indexed: false,
  //       internalType: "address",
  //       name: "owner",
  //       type: "address",
  //     },
  //   ],
  //   name: "SubscriptionCreated",
  //   type: "event",
  // },
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

  console.log(
    `Creating VRF subscription via coordinator ${vrfAddress} on network ${connection.networkName} using ${account.address}`
  );

  const txHash = await walletClient.writeContract({
    abi: VRF_COORDINATOR_ABI,
    address: vrfAddress,
    functionName: "createSubscription",
    chain: walletClient.chain,
    account,
  });
  console.log(`Submitted transaction: ${txHash}`);

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  if (receipt.status !== "success") {
    throw new Error(`Transaction failed with status ${receipt.status}`);
  }

  let createdSubId: bigint | undefined;
  let owner: Address | undefined;
  let sender: Address | undefined;

  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: VRF_COORDINATOR_ABI,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName === "SubscriptionCreated") {
        const args = decoded.args as {
          subId: bigint;
          owner: Address;
          sender: Address;
        };
        createdSubId = args.subId;
        owner = args.owner;
        sender = args.sender;
        break;
      }
    } catch (err) {
      console.log("Failed to decode log:", err);
      // ignore logs that don't match the event
    }
  }

  if (!createdSubId) {
    console.warn("SubscriptionCreated event not found in logs.");
  } else {
    console.log(
      `Subscription created: subId=${createdSubId.toString()} owner=${
        owner ?? "<unknown>"
      }`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
