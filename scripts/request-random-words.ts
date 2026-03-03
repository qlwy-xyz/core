import hre from "hardhat";
import {
  concatHex,
  encodeAbiParameters,
  keccak256,
  stringToBytes,
  type Hex,
} from "viem";

// const abi = [
//   {
//     type: "function",
//     name: "requestRandomWords",
//     inputs: [
//       { name: "keyHash", type: "bytes32" },
//       { name: "subId", type: "uint256" },
//       { name: "minimumRequestConfirmations", type: "uint16" },
//       { name: "callbackGasLimit", type: "uint32" },
//       { name: "numWords", type: "uint32" },
//     ],
//     outputs: [{ name: "requestId", type: "uint256" }],
//     stateMutability: "nonpayable",
//   },
// ];

const abi = [
  {
    inputs: [
      {
        components: [
          { internalType: "bytes32", name: "keyHash", type: "bytes32" },
          { internalType: "uint256", name: "subId", type: "uint256" },
          {
            internalType: "uint16",
            name: "requestConfirmations",
            type: "uint16",
          },
          {
            internalType: "uint32",
            name: "callbackGasLimit",
            type: "uint32",
          },
          { internalType: "uint32", name: "numWords", type: "uint32" },
          { internalType: "bytes", name: "extraArgs", type: "bytes" },
        ],
        internalType: "struct VRFV2PlusClient.RandomWordsRequest",
        name: "req",
        type: "tuple",
      },
    ],
    name: "requestRandomWords",
    outputs: [{ internalType: "uint256", name: "requestId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
];

// // testnet
// const coordinator = "0xa2d23627bC0314f4Cbd08Ff54EcB89bb45685053";
// const keyHash =
//   "0x617abc3f53ae11766071d04ada1c7b0fbd49833b9542e9e91da4d3191c70cc80";
// const subId = 434n;
// const minConfirmations = 3;
// const callbackGasLimit = 100_000;
// const numWords = 2;
// const core = "0xE7b805442569ddd8e81AFc0628B8D8921f4BA67A";

// base sepolia
const coordinator = "0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE";
const keyHash =
  "0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71";
const subId =
  38750191076683763643600661173834067593126258046985712337359642410579178335518n;
const minConfirmations = 3;
const callbackGasLimit = 100_000;
const numWords = 2;
const core = "0xcCCE1eA9fdE6b845B48d64E12E2151Be5A1C6ee3";

// // localhost
// const coordinator = "0xDC11f7E700A4c898AE5CAddB1082cFfa76512aDD";
// const keyHash =
//   "0x617abc3f53ae11766071d04ada1c7b0fbd49833b9542e9e91da4d3191c70cc80";
// const subId = 426n;
// const minConfirmations = 3;
// const callbackGasLimit = 100_000;
// const numWords = 2;
// const core = "0xdbC43Ba45381e02825b14322cDdd15eC4B3164E6";

async function main() {
  const publicClient = await (
    await hre.network.connect()
  ).viem.getPublicClient();

  const extraArgs = buildExtraArgs({ nativePayment: true });

  const res = await publicClient.simulateContract({
    address: coordinator,
    abi,
    functionName: "requestRandomWords",
    args: [
      {
        keyHash,
        subId,
        requestConfirmations: minConfirmations,
        callbackGasLimit,
        numWords,
        extraArgs,
      },
    ],
    account: core as `0x${string}`,
  });

  console.log(res);
}

function buildExtraArgs({ nativePayment }: { nativePayment: boolean }): Hex {
  const selector = keccak256(stringToBytes("VRF ExtraArgsV1")).slice(0, 10) as Hex;
  const encoded = encodeAbiParameters(
    [{ name: "nativePayment", type: "bool" }],
    [nativePayment]
  );
  return concatHex([selector as Hex, encoded]);
}

main().catch((err) => {
  console.log(err);
  console.error(err.shortMessage);
  console.error(err.data); // 如果是自定义错误, 这里能看到原始 revert data
});
