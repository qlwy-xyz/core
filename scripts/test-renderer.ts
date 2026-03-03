import hre from "hardhat";
import fs from "fs";
import path from "path";

const coreAddress =
  "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6" as `0x${string}`;
const rendererAddress =
  "0xc0F115A19107322cFBf1cDBC7ea011C19EbDB4F8" as `0x${string}`;
const tokenId = 1;

const contentPackAddress =
  "0x59b670e9fA9D0A427751Af201D676719a970857b" as `0x${string}`;

const contentPackABI = [
  {
    inputs: [
      {
        internalType: "string",
        name: "initialBaseImageUri",
        type: "string",
      },
      {
        internalType: "string",
        name: "initialFont1Uri",
        type: "string",
      },
      {
        internalType: "string",
        name: "initialFont2Uri",
        type: "string",
      },
    ],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    inputs: [],
    name: "baseImageUri",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "font1Uri",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "font2Uri",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "fontStyle",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "fontStyleTag",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint16",
        name: "id",
        type: "uint16",
      },
    ],
    name: "hexagramJudgment",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint16",
        name: "id",
        type: "uint16",
      },
    ],
    name: "hexagramName",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint16",
        name: "id",
        type: "uint16",
      },
    ],
    name: "hexagramPinyin",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint16",
        name: "id",
        type: "uint16",
      },
    ],
    name: "hexagramShortName",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint16",
        name: "id",
        type: "uint16",
      },
    ],
    name: "hexagramShortNamePinyin",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint16",
        name: "id",
        type: "uint16",
      },
      {
        internalType: "uint8",
        name: "rarity",
        type: "uint8",
      },
    ],
    name: "imageUri",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "owner",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint8",
        name: "rarity",
        type: "uint8",
      },
    ],
    name: "rarityLabel",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "string",
        name: "newUri",
        type: "string",
      },
    ],
    name: "setBaseImageUri",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "string",
        name: "newUri",
        type: "string",
      },
    ],
    name: "setFont1Uri",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "string",
        name: "newUri",
        type: "string",
      },
    ],
    name: "setFont2Uri",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint8",
        name: "rarity",
        type: "uint8",
      },
    ],
    name: "strokeColor",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
];

const coreABI = [
  {
    inputs: [
      {
        internalType: "uint256",
        name: "tokenId",
        type: "uint256",
      },
    ],
    name: "tokenView",
    outputs: [
      {
        components: [
          {
            internalType: "uint8",
            name: "rarity",
            type: "uint8",
          },
          {
            internalType: "uint8",
            name: "luck",
            type: "uint8",
          },
          {
            internalType: "uint8[6]",
            name: "lines",
            type: "uint8[6]",
          },
          {
            internalType: "uint16",
            name: "id",
            type: "uint16",
          },
        ],
        internalType: "struct QLWYFortuneCore.TokenView",
        name: "view_",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
];

const ABI = [
  {
    name: "tokenURI",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
];

async function main() {
  const connection = await hre.network.connect();
  const publicClient = await connection.viem.getPublicClient();

  console.log(`🎨 Reading tokenURI(${tokenId}) from ${rendererAddress}...`);

  const uri = (await publicClient.readContract({
    abi: ABI,
    address: rendererAddress,
    functionName: "tokenURI",
    args: [12],
  })) as any;

  const base64Json = uri.split(",")[1];
  const json = JSON.parse(Buffer.from(base64Json, "base64").toString("utf8"));
  const base64Svg = json.image.split(",")[1];
  const svg = Buffer.from(base64Svg, "base64").toString("utf8");

  console.log(json);
  const out = path.resolve(`render_${tokenId}.svg`);
  fs.writeFileSync(out, svg, "utf8");
  console.log(`✅ Saved to ${out}`);
}

main().catch(console.error);
