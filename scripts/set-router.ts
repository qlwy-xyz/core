import "dotenv/config";
import hre from "hardhat";
import { type Address, type Hex, type WalletClient } from "viem";
import type { Account } from "viem/accounts";
import { privateKeyToAccount } from "viem/accounts";

const CORE_ABI = [
  {
    inputs: [
      {
        internalType: "enum QLWYFortuneCore.RouterType",
        name: "routerType_",
        type: "uint8",
      },
      {
        internalType: "address",
        name: "routerAddress_",
        type: "address",
      },
      {
        internalType: "address",
        name: "wbnb_",
        type: "address",
      },
      {
        internalType: "uint24",
        name: "poolFee_",
        type: "uint24",
      },
    ],
    name: "setRouterConfig",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

type NetworkConnection = Awaited<ReturnType<typeof hre.network.connect>>;

type RouterType = 0 | 1; // 0 = v2, 1 = v3

const coreAddress = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9" as Address;
const wbnbAddress = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" as Address;

// // v3 config
// const routerAddress = "0x1b81D678ffb9C0263b24A97847620C99d213eB14" as Address;
// const routerType: RouterType = 1;
// const poolFee = 500;

// v2 config
const routerAddress = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as Address;
const routerType: RouterType = 0;
const poolFee = 0;

async function resolveWalletClient(
  connection: NetworkConnection
): Promise<{ walletClient: WalletClient; account: Account }> {
  const privateKey = process.env.BSC_PRIVATE_KEY;

  if (privateKey && connection.networkName !== "localhost") {
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
  const chain = walletClient.chain ?? undefined;

  console.log(
    `Setting router config on ${coreAddress} (network ${
      connection.networkName
    }) to router=${routerAddress}, wbnb=${wbnbAddress}, type=${
      routerType === 0 ? "v2" : "v3"
    }, poolFee=${poolFee}`
  );

  const txHash = await walletClient.writeContract({
    abi: CORE_ABI,
    address: coreAddress,
    functionName: "setRouterConfig",
    args: [routerType, routerAddress, wbnbAddress, poolFee],
    account,
    chain,
  });

  console.log(`Submitted transaction: ${txHash}`);

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  if (receipt.status !== "success") {
    throw new Error(`setRouterConfig failed with status ${receipt.status}`);
  }

  console.log(`Router configuration updated in tx ${receipt.transactionHash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
