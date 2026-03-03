import "dotenv/config";
import hre from "hardhat";
import { type Address, type Hex, type WalletClient } from "viem";
import type { Account } from "viem/accounts";
import { privateKeyToAccount } from "viem/accounts";

const ABI = [
  {
    inputs: [
      {
        internalType: "address",
        name: "spender",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256",
      },
    ],
    name: "approve",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

type NetworkConnection = Awaited<ReturnType<typeof hre.network.connect>>;

const coreAddress = "0xcE6f2F55898050C0D1769164c4Ceb828B4fC54f8" as Address;
const tokenAddress = "0x2e591b13d3caf27adf1db47d75278315d0754444" as Address;

const value = BigInt(80000000 * 10 ** 18);

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
    `Approve on ${tokenAddress} (network ${connection.networkName}) to spender ${coreAddress} with value=${value}`
  );

  const txHash = await walletClient.writeContract({
    abi: ABI,
    address: tokenAddress,
    functionName: "approve",
    args: [coreAddress, value],
    account,
    chain,
  });

  console.log(`Submitted transaction: ${txHash}`);

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  if (receipt.status !== "success") {
    throw new Error(`Approvefailed with status ${receipt.status}`);
  }

  console.log(`Approval updated in tx ${receipt.transactionHash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
