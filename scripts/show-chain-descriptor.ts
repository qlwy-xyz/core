import { config } from "hardhat";

async function main() {
  // chainDescriptors resolves to a Map with BigInt keys
  const descriptor = await config.chainDescriptors.get(56n);
  console.log(JSON.stringify(descriptor, (_key, value) => {
    if (value instanceof Map) {
      return {
        dataType: "Map",
        value: Array.from(value.entries()),
      };
    }
    return value;
  }));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
