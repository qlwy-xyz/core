import hre from "hardhat";
import QLWYRenderer from "../ignition/modules/QLWYRenderer.js";

// // localhost
// const coreAddress = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9";
// const contentPackAddress = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707";

// // testnet
// const coreAddress = "0xE7b805442569ddd8e81AFc0628B8D8921f4BA67A";
// const contentPackAddress = "0x111BadfECfB9612AA134af70F01508b228673973";

// // mainnet
// const coreAddress = "0xcE6f2F55898050C0D1769164c4Ceb828B4fC54f8";
// const contentPackAddress = "0x25f289D4b66C44eDc3673B2420F115c21AcF21b1";

// // base sepolia
// const coreAddress = "0xcCCE1eA9fdE6b845B48d64E12E2151Be5A1C6ee3";
// const contentPackAddress = "0x335a7FC3d5B373afE4951B890a89Dc48c4160C53";

// base
const coreAddress = "0x8D5Ac3CdDa57b23EeC1BF9E6469c5694500573a2";
const contentPackAddress = "0xcE6f2F55898050C0D1769164c4Ceb828B4fC54f8";

async function main() {
  const connection = await hre.network.connect();
  const { renderer } = await connection.ignition.deploy(QLWYRenderer, {
    parameters: {
      QLWYRendererModule: {
        coreAddress,
        contentPackAddress,
      },
    },
  });

  console.log(`Renderer deployed to: ${renderer.address}`);
}

main().catch(console.error);
