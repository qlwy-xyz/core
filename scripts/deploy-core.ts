import hre from "hardhat";
import QLWYFortuneCore from "../ignition/modules/QLWYFortuneCore.js";
import { zeroAddress } from "viem";
import { randomBytes } from "crypto";
import { bytesToHex } from "viem";

const tokenAddress = zeroAddress;


// v3 router
const routerAddress = zeroAddress;
const routerType = 1; // 0 = V2, 1 = V3
const routerPoolFee = 500; // Only used for v3

// // localnet vrf config
// const vrfCoordinatorAddress = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9";
// const vrfKeyHash = bytesToHex(randomBytes(32));
// const vrfSubscriptionId = 0n;
// const vrfMinConfirmations = 3;
// const vrfCallbackGasLimit = 500_000;
// const wbnbAddress = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";

// // testnet vrf config
// const vrfCoordinatorAddress = "0xa2d23627bC0314f4Cbd08Ff54EcB89bb45685053";
// const vrfKeyHash = "0x617abc3f53ae11766071d04ada1c7b0fbd49833b9542e9e91da4d3191c70cc80";
// const vrfSubscriptionId = 434n;
// const vrfMinConfirmations = 3;
// const vrfCallbackGasLimit = 500_000;
// const wbnbAddress = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";

// // mainnet vrf config
// const vrfCoordinatorAddress = "0x9632ADE542f12114f5E5AD4d6F8e47fB993955da";
// const vrfKeyHash = "0xcd65a78499993598be303c914c3e37b0103ead6b1f279d1dbfa0ef080e7141a4";
// const vrfSubscriptionId = 102n;
// const vrfMinConfirmations = 3;
// const vrfCallbackGasLimit = 500_000;
// const wbnbAddress = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

// // // base sepolia vrf config
// const vrfCoordinatorAddress = "0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE";
// const vrfKeyHash = "0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71";
// const vrfSubscriptionId = 38750191076683763643600661173834067593126258046985712337359642410579178335518n;
// const vrfMinConfirmations = 1;
// const vrfCallbackGasLimit = 500_000;
// const wbnbAddress = "0x4200000000000000000000000000000000000006";

// base
const vrfCoordinatorAddress = "0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634";
const vrfKeyHash = "0xdc2f87677b01473c763cb0aee938ed3341512f6057324a584e5944e786144d70";
const vrfSubscriptionId = 6365286977517996260482348856412290795318028311528020766656842489133998147812n;
const vrfMinConfirmations = 1;
const vrfCallbackGasLimit = 500_000;
const wbnbAddress = "0x4200000000000000000000000000000000000006";

async function main() {
  const connection = await hre.network.connect();
  const { core } = await connection.ignition.deploy(QLWYFortuneCore, {
    parameters: {
      QLWYFortuneCoreModule: {
        tokenAddress,
        routerAddress,
        routerType,
        wbnbAddress,
        routerPoolFee,
        vrfCoordinatorAddress,
        vrfKeyHash,
        vrfSubscriptionId,
        vrfMinConfirmations,
        vrfCallbackGasLimit,
      },
    },
  });

  console.log(`Core deployed to: ${core.address}`);
}

main().catch(console.error);
