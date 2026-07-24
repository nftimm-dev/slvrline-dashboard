import { createConfig } from "ponder";
import { SlvrTokenAbi } from "./abis/SlvrToken";
import { GridLotteryAbi } from "./abis/GridLottery";
// --- Phase 2 additions ---
import { SlvrVoteEscrowAbi } from "./abis/SlvrVoteEscrow";
import { SlvrVoteEscrowStakingAbi } from "./abis/SlvrVoteEscrowStaking";
import { SlvrLiquidityStakingAbi } from "./abis/SlvrLiquidityStaking";
import { SlvrHubAbi } from "./abis/SlvrHub";
import { UniswapV2PairAbi } from "./abis/UniswapV2Pair";
import { UniswapV4PoolManagerAbi } from "./abis/UniswapV4PoolManager";

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
    // --- Phase 2 additions ---
    SlvrVoteEscrow: {
      abi: SlvrVoteEscrowAbi,
      chain: "robinhoodChain",
      address: "0xd9b8FBD61033145c5496132153CE675756313B71",
      startBlock: 5_574_784,
    },
    SlvrVoteEscrowStaking: {
      abi: SlvrVoteEscrowStakingAbi,
      chain: "robinhoodChain",
      address: "0xaF68598eBd245DC3cB92FF16E9Ba1814DD137200",
      startBlock: 5_574_808,
    },
    SlvrLiquidityStaking: {
      abi: SlvrLiquidityStakingAbi,
      chain: "robinhoodChain",
      address: "0x7D888f4Ca88Fc3578aEfc45C82482Bd66415DfeA",
      startBlock: 5_574_869,
    },
    SlvrHub: {
      abi: SlvrHubAbi,
      chain: "robinhoodChain",
      address: "0x55FC0daaB486E46fBF1d60787420c0311d9Dd57f",
      startBlock: 5_574_804,
    },
    UniswapV2Pair: {
      abi: UniswapV2PairAbi,
      chain: "robinhoodChain",
      address: "0xe365b92239097Ed3322131411DbE15a5c4068eff",
      startBlock: 5_574_866,
    },
    UniswapV4PoolManager: {
      abi: UniswapV4PoolManagerAbi,
      chain: "robinhoodChain",
      address: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
      startBlock: 5_574_866,  // Use V2 pair block (not PoolManager deploy 9,070)
                               // No SLVR pool can exist before the SLVR token (5,574,774);
                               // using 5,574,866 avoids scanning ~5.5M empty blocks.
    },
  },
});
