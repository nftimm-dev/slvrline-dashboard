import { createConfig } from "ponder";
import { SlvrTokenAbi } from "./abis/SlvrToken";

// Current head at bootstrap time: 0x1193914 (18,430,228). startBlock is head − 50,000.
// PLACEHOLDER: Replace with the real SLVR token deployment block in Phase 1 work.
const START_BLOCK = 18_380_228;

export default createConfig({
  database: {
    kind: "postgres",
    // Falls back to DATABASE_URL env var automatically when connectionString is omitted.
    // DATABASE_URL is set in .env.local (postgresql://timwilliams@localhost:5433/slvrline).
    connectionString: process.env.DATABASE_URL,
  },
  chains: {
    robinhoodChain: {
      id: 4663,
      rpc: process.env.PONDER_RPC_URL_4663 ?? "https://rpc.mainnet.chain.robinhood.com",
    },
  },
  contracts: {
    SlvrToken: {
      abi: SlvrTokenAbi,
      chain: "robinhoodChain",
      address: "0x791229E3EbD6CFdC3D8157f48722684173C29aD9",
      startBlock: START_BLOCK,
    },
  },
});
