import hre from "hardhat";
import { randomBytes } from "crypto";
import { bytesToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const LUCK_MODULO = 101n;
const BPS_DENOMINATOR = 10000n;
const MYTHIC_ROLL = 9999n;

const randomWord = () => {
  return BigInt(bytesToHex(randomBytes(32)));
};

const randomSuffix = () => {
  return BigInt("0x" + randomBytes(4).toString("hex"));
};

const randomLuck = () => {
  return BigInt(randomBytes(1)[0] % Number(LUCK_MODULO));
};

const buildMythicWords = (): [bigint, bigint] => {
  const seedOne = randomWord();
  const suffix = randomSuffix();
  const luck = randomLuck();

  const base = MYTHIC_ROLL + BPS_DENOMINATOR * suffix;
  const seedTwo = base * LUCK_MODULO + luck;

  return [seedOne, seedTwo];
};

const coreAddress = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9";
const vrfAddress = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9";

async function main() {
  const connection = await hre.network.connect();
  const publicClient = await connection.viem.getPublicClient();

  let walletClient = undefined;

  if (connection.networkName !== "localhost") {
    const privateKey =
      process.env.AUTO_FILL_PRIVATE_KEY ?? process.env.BSC_PRIVATE_KEY;
    const account = privateKeyToAccount(`0x${privateKey}` as `0x${string}`);
    walletClient = await connection.viem.getWalletClient(account.address, {
      account,
    });
  }

  const core = await connection.viem.getContractAt(
    "QLWYFortuneCore",
    coreAddress
  );
  const vrf = await connection.viem.getContractAt(
    "VRFCoordinatorMock",
    vrfAddress
  );

  console.log(`Listening for CastRequested events on core ${coreAddress}`);

  const seenRequests = new Set<string>();

  publicClient.watchContractEvent({
    address: core.address,
    abi: core.abi,
    eventName: "CastRequested",
    onLogs: async (listenerArgs: any[]) => {
      const event = listenerArgs[listenerArgs.length - 1] as { args: any };
      const args = event.args ?? {};
      const castId: bigint = args.castId ?? (listenerArgs[0] as bigint);
      const user: string = args.user ?? (listenerArgs[1] as string);
      const requestId: bigint = args.requestId ?? (listenerArgs[2] as bigint);

      const requestKey = requestId.toString();
      if (seenRequests.has(requestKey)) {
        return;
      }
      seenRequests.add(requestKey);
      try {
        console.log(
          `→ CastRequested: castId=${castId.toString()} user=${user} requestId=${requestId.toString()}`
        );
        const words = buildMythicWords();
        const luckValue = words[1] % LUCK_MODULO;
        const rarityRoll = (words[1] / LUCK_MODULO) % BPS_DENOMINATOR;
        const tx = await vrf.write.fulfillRandomWords([
          requestId,
          coreAddress,
          words,
        ]);

        const receipt = await publicClient.waitForTransactionReceipt({
          hash: tx,
        });
        console.log(
          `  VRF fulfilled for cast ${castId.toString()} in tx ${
            receipt?.transactionHash ?? "<pending>"
          } (words=${words
            .map((w) => w.toString())
            .join(",")}, rarityRoll=${rarityRoll.toString()}, luck=${luckValue.toString()})`
        );
      } catch (error) {
        console.error("  Failed to fulfill request", error);
      }
    },
  });

  console.log("Auto-fulfill worker is running. Press Ctrl+C to exit.");
  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
