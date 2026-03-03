import "dotenv/config";
import hre from "hardhat";
import { type Address, type Hex, type WalletClient } from "viem";
import type { Account } from "viem/accounts";
import { privateKeyToAccount } from "viem/accounts";

const CORE_ABI = [
  {
    inputs: [
      {
        internalType: "contract IVRFCoordinatorV2_5",
        name: "coordinator_",
        type: "address",
      },
      {
        internalType: "bytes32",
        name: "keyHash_",
        type: "bytes32",
      },
      {
        internalType: "uint256",
        name: "subId_",
        type: "uint256",
      },
      {
        internalType: "uint16",
        name: "minConfirmations_",
        type: "uint16",
      },
      {
        internalType: "uint32",
        name: "callbackGasLimit_",
        type: "uint32",
      },
    ],
    name: "setVRFConfig",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

type NetworkConnection = Awaited<ReturnType<typeof hre.network.connect>>;

const coreAddress = "0xcE6f2F55898050C0D1769164c4Ceb828B4fC54f8" as Address;
const vrfConfig = {
  coordinator: "0x9632ADE542f12114f5E5AD4d6F8e47fB993955da" as Address,
  keyHash:
    "0xcd65a78499993598be303c914c3e37b0103ead6b1f279d1dbfa0ef080e7141a4" as Hex,
  subId: 121n,
  minConfirmations: 3,
  callbackGasLimit: 500_000,
};

// const coreAddress = "0xB80E229e15C19040d5Efb5f33f61afE12a4Fc3b3" as Address;
// const castFee = 0.00001 * 10 ** 18;

async function resolveWalletClient(
  connection: NetworkConnection,
): Promise<{ walletClient: WalletClient; account: Account }> {
  const privateKey = process.env.BSC_PRIVATE_KEY;

  if (privateKey && connection.networkName !== "localhost") {
    const account = privateKeyToAccount(`0x${privateKey}` as `0x${string}`);
    const walletClient = await connection.viem.getWalletClient(
      account.address,
      {
        account,
      },
    );
    return { walletClient, account };
  }

  const walletClients = await connection.viem.getWalletClients();
  if (walletClients.length === 0) {
    throw new Error(
      "No wallet client available. Set CREATE_VRF_PRIVATE_KEY (or BSC_TESTNET_PRIVATE_KEY) in .env.",
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
    `Setting vrf config on ${coreAddress} (network ${connection.networkName}) to vrfConfig=${vrfConfig}`,
  );

  const txHash = await walletClient.writeContract({
    abi: CORE_ABI,
    address: coreAddress,
    functionName: "setVRFConfig",
    args: [
      vrfConfig.coordinator,
      vrfConfig.keyHash,
      vrfConfig.subId,
      vrfConfig.minConfirmations,
      vrfConfig.callbackGasLimit,
    ],
    account,
    chain,
  });

  console.log(`Submitted transaction: ${txHash}`);

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  if (receipt.status !== "success") {
    throw new Error(`Set vrf config failed with status ${receipt.status}`);
  }

  console.log(`Vrf config updated in tx ${receipt.transactionHash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
