import "dotenv/config";
import hre from "hardhat";
import { type Address, type Hex, type WalletClient } from "viem";
import type { Account } from "viem/accounts";
import { privateKeyToAccount } from "viem/accounts";

const CORE_ABI = [
  {
    inputs: [
      {
        internalType: "address",
        name: "ops",
        type: "address",
      },
    ],
    name: "setOpsTreasury",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

type NetworkConnection = Awaited<ReturnType<typeof hre.network.connect>>;

//// bsc
// const coreAddress = "0xcE6f2F55898050C0D1769164c4Ceb828B4fC54f8" as Address;
// const opsAddress = "0x3d2D26cB046E71f49C8E2fFdC30E560cc0d1a7b5" as Address;

// base
const coreAddress = "0x8D5Ac3CdDa57b23EeC1BF9E6469c5694500573a2" as Address;
const opsAddress = "0x3d2D26cB046E71f49C8E2fFdC30E560cc0d1a7b5" as Address;

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
  const chain = walletClient.chain ?? undefined;

  console.log(
    `Setting ops treasury on ${coreAddress} (network ${connection.networkName}) to ops=${opsAddress}`
  );

  const txHash = await walletClient.writeContract({
    abi: CORE_ABI,
    address: coreAddress,
    functionName: "setOpsTreasury",
    args: [opsAddress],
    account,
    chain,
  });

  console.log(`Submitted transaction: ${txHash}`);

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  if (receipt.status !== "success") {
    throw new Error(`setOpsTreasury failed with status ${receipt.status}`);
  }

  console.log(`Ops treasury updated in tx ${receipt.transactionHash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
