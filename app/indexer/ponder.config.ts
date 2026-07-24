import { createConfig } from "ponder";
import { SlvrTokenAbi } from "./abis/SlvrToken";
import { GridLotteryAbi } from "./abis/GridLottery";

export default createConfig({
  database: {
    kind: "postgres",
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
      startBlock: 5_574_774,
      // No endBlock — index to head for live supply tracking
    },
    GridLotteryV1: {
      abi: GridLotteryAbi,
      chain: "robinhoodChain",
      address: "0x284Eb4016305Fa7FbC162Fb68F27227271001c7f",
      startBlock: 5_649_104,
      endBlock: 17_440_150, // last-ever RoundResolved on V1 (optimization only, NOT the canonical boundary)
    },
    GridLotteryV2: {
      abi: GridLotteryAbi,
      chain: "robinhoodChain",
      address: "0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71",
      startBlock: 16_764_101,
      // No endBlock — active contract
    },
  },
});
