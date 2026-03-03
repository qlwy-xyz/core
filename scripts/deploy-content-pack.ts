import hre from "hardhat";
import QLWYContentPackV1 from "../ignition/modules/QLWYContentPackV1.js";

const baseImageUri =
  "ipfs://bafybeia6iqrbqhoh6cfalbtloigijuarvmwpe2inmpc2rfl5qcisyjgwh4";

const font1Uri =
  "https://scarlet-obliged-prawn-408.mypinata.cloud/ipfs/bafybeihr6d2boeq4m4st6f4wzyzzqsbbbd46vqa3g5erzp7jti2bj4cdka";
const font2Uri =
  "https://scarlet-obliged-prawn-408.mypinata.cloud/ipfs/bafkreihec7tbafq2gxeaf647jo3scjhefllqvtroiyzwfxpshhoapbvvx4";

async function main() {
  const connection = await hre.network.connect();
  const { contentPack } = await connection.ignition.deploy(QLWYContentPackV1, {
    parameters: {
      QLWYContentPackV1Module: {
        baseImageUri,
        font1Uri,
        font2Uri,
      },
    },
  });

  console.log(`ContentPack deployed to: ${contentPack.address}`);
}

main().catch(console.error);
