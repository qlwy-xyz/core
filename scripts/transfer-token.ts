import "dotenv/config";
import hre from "hardhat";
import type { Account } from "viem/accounts";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, WalletClient } from "viem";

const ERC20_ABI = [
  {
    inputs: [{ internalType: "address", name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "value", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

type NetworkConnection = Awaited<ReturnType<typeof hre.network.connect>>;

const tokenAddress = "0xba4A531F3A9C4Ec459c30aD7113C372869cA8EcB" as Address;
const recipientAddress = "0x4dfCa5bcB506e90120f4592937c113CFBf7FEF97" as Address;
const amount = 700000000n * 10n ** 18n; // 1,000 tokens (18 decimals)

async function resolveWalletClient(
  connection: NetworkConnection
): Promise<{ walletClient: WalletClient; account: Account }> {
  const privateKey = process.env.BSC_PRIVATE_KEY;

  if (privateKey) {
    const account = privateKeyToAccount(`0x${privateKey}` as `0x${string}`);
    const walletClient = await connection.viem.getWalletClient(account.address, {
      account,
    });
    return { walletClient, account };
  }

  const walletClients = await connection.viem.getWalletClients();
  if (walletClients.length === 0) {
    throw new Error("No wallet client available. Set BSC_PRIVATE_KEY in .env.");
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
    `Transferring ${amount.toString()} tokens from ${account.address} to ${recipientAddress} on ${connection.networkName}`
  );

  const [senderBalanceBefore, recipientBalanceBefore] = await Promise.all([
    publicClient.readContract({
      abi: ERC20_ABI,
      address: tokenAddress,
      functionName: "balanceOf",
      args: [account.address],
    }),
    publicClient.readContract({
      abi: ERC20_ABI,
      address: tokenAddress,
      functionName: "balanceOf",
      args: [recipientAddress],
    }),
  ]);

  console.log(
    `Balances before: sender=${senderBalanceBefore.toString()} recipient=${recipientBalanceBefore.toString()}`
  );

  const txHash = await walletClient.writeContract({
    abi: ERC20_ABI,
    address: tokenAddress,
    functionName: "transfer",
    args: [recipientAddress, amount],
    account,
    chain,
  });

  console.log(`Submitted transaction: ${txHash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`Transfer failed with status ${receipt.status}`);
  }

  console.log(`Transfer confirmed in tx ${receipt.transactionHash}`);

  const [senderBalanceAfter, recipientBalanceAfter] = await Promise.all([
    publicClient.readContract({
      abi: ERC20_ABI,
      address: tokenAddress,
      functionName: "balanceOf",
      args: [account.address],
    }),
    publicClient.readContract({
      abi: ERC20_ABI,
      address: tokenAddress,
      functionName: "balanceOf",
      args: [recipientAddress],
    }),
  ]);

  console.log(
    `Balances after: sender=${senderBalanceAfter.toString()} recipient=${recipientBalanceAfter.toString()}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
