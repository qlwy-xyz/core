import hre from "hardhat";
import RouterMock from "../ignition/modules/RouterMock.js";

const tokenAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as `0x${string}`;
const mockRate = 1000;

async function main() {
  const connection = await hre.network.connect();
  const publicClient = await connection.viem.getPublicClient();

  const { routerMock } = await connection.ignition.deploy(RouterMock, {
    parameters: {
      RouterMockModule: {
        tokenAddress,
        mockRate,
      },
    },
  });

  console.log(`Router mock deployed to: ${routerMock.address}`);

  const token = await connection.viem.getContractAt("QLWYToken", tokenAddress);
  const minterTxHash = await token.write.setMinter([routerMock.address, true]);
  await publicClient.waitForTransactionReceipt({ hash: minterTxHash });

  console.log(
    `Granted minter role on token ${tokenAddress} to router mock at ${routerMock.address}`,
  );
}

main().catch(console.error);
