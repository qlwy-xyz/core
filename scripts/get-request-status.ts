import hre from "hardhat";
import { parseAbiItem } from "viem";

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
    name: "getRequestStatus",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "subId", type: "uint256" },
      { name: "requestId", type: "uint256" },
    ],
    outputs: [
      { name: "fulfilled", type: "bool" },
      { name: "randomWords", type: "uint256[]" },
      { name: "payments", type: "uint96[]" },
      { name: "reverts", type: "uint256" },
      { name: "lastError", type: "bytes" },
    ],
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

const subId =
  38750191076683763643600661173834067593126258046985712337359642410579178335518n;

const requestId =
  8504604385354134086954261435084392566898748410746077600122355068028262076093n;

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

  const REQUEST_ID =
    8504604385354134086954261435084392566898748410746077600122355068028262076093n;
  const COORDINATOR = "0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE";

  const fulfilled = parseAbiItem(
    "event RandomWordsFulfilled(uint256 requestId,uint256 outputSeed,uint96 payment,bool success)"
  );

  const logs = await publicClient.getLogs({
    address: COORDINATOR,
    event: fulfilled,
    args: { requestId: REQUEST_ID },
  });

  console.log(logs);

  console.log(logs.length ? logs[0].args : "not fulfilled yet");
}

main().catch((err) => {
  console.log(err);
  console.error(err.shortMessage);
  console.error(err.data); // 如果是自定义错误, 这里能看到原始 revert data
});
