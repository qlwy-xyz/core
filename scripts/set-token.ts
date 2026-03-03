import "dotenv/config";
import hre from "hardhat";
import { type Address, type Hex, type WalletClient } from "viem";
import type { Account } from "viem/accounts";
import { privateKeyToAccount } from "viem/accounts";

const CORE_ABI = [
  {
    inputs: [
      {
        internalType: "contract IERC20",
        name: "token_",
        type: "address",
      },
    ],
    name: "setQLWYToken",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

type NetworkConnection = Awaited<ReturnType<typeof hre.network.connect>>;

const coreAddress = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9" as Address;
const tokenAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;

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
    `Setting token on ${coreAddress} (network ${connection.networkName}) to token=${tokenAddress}`
  );

  const txHash = await walletClient.writeContract({
    abi: CORE_ABI,
    address: coreAddress,
    functionName: "setQLWYToken",
    args: [tokenAddress],
    account,
    chain,
  });

  console.log(`Submitted transaction: ${txHash}`);

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  if (receipt.status !== "success") {
    throw new Error(`Set token address failed with status ${receipt.status}`);
  }

  console.log(`Token address updated in tx ${receipt.transactionHash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
