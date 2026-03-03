import "dotenv/config";
import hre from "hardhat";
import { parseEther, type Address, type Hex, type WalletClient } from "viem";
import type { Account } from "viem/accounts";
import { privateKeyToAccount } from "viem/accounts";

//// testnet
// const vrfAddress = "0xa2d23627bC0314f4Cbd08Ff54EcB89bb45685053";
// const subscriptionId = 434n;

// mainnet
const vrfAddress = "0x9632ADE542f12114f5E5AD4d6F8e47fB993955da";
const subscriptionId = 121n;

// // base sepolia
// const vrfAddress = "0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE";
// const subscriptionId =
//   38750191076683763643600661173834067593126258046985712337359642410579178335518n;

// // base
// const vrfAddress = "0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634";
// const subscriptionId =
//   6365286977517996260482348856412290795318028311528020766656842489133998147812n;

const fundAmount = parseEther("0.05");

const VRF_COORDINATOR_ABI = [
  {
    inputs: [{ internalType: "uint256", name: "subId", type: "uint256" }],
    name: "fundSubscriptionWithNative",
    outputs: [],
    stateMutability: "payable",
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

  const chain = walletClient.chain ?? undefined;

  const balanceBefore = await publicClient.getBalance({ address: vrfAddress });

  console.log(
    `Funding subscription ${subscriptionId.toString()} with ${fundAmount.toString()} wei on ${
      connection.networkName
    } via ${vrfAddress}`
  );

  const txHash = await walletClient.writeContract({
    abi: VRF_COORDINATOR_ABI,
    address: vrfAddress,
    functionName: "fundSubscriptionWithNative",
    args: [subscriptionId],
    value: fundAmount,
    account,
    chain,
  });
  console.log(`Submitted transaction: ${txHash}`);

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  if (receipt.status !== "success") {
    throw new Error(`Deposit transaction failed with status ${receipt.status}`);
  }

  const balanceAfter = await publicClient.getBalance({ address: vrfAddress });
  const delta = balanceAfter - balanceBefore;

  console.log(
    `Deposit confirmed in ${
      receipt.transactionHash
    }. Coordinator balance increased by ${delta.toString()} wei.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
