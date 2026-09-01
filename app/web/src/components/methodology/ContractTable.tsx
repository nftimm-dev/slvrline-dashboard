import { getBlockscoutUrl } from "@/lib/labels";
import AddressLabel from "@/components/common/AddressLabel";

// Full registry — keep in sync with labels.ts
const ALL_CONTRACTS: {
  address: string;
  label: string;
  purpose: string;
  status: "Production" | "Historical" | "Infrastructure";
}[] = [
  {
    address: "0x791229E3EbD6CFdC3D8157f48722684173C29aD9",
    label: "SLVR Token",
    purpose: "ERC-20; supply, tax, emissions, burns, routing",
    status: "Production",
  },
  {
    address: "0xa1e5213505772B195FD7AE3b4a6b27B58Cf72A3D",
    label: "Grid Mining",
    purpose: "Current mining/game generation (rounds 33,500+)",
    status: "Production",
  },
  {
    address: "0x2070b4B0c57EaF070CF86cD8321a6054f3D25260",
    label: "Miner State Vault",
    purpose: "Permanent unrefined SLVR, dividends, and refining clocks",
    status: "Production",
  },
  {
    address: "0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71",
    label: "Grid Mining (Legacy)",
    purpose: "Gas-optimized generation (rounds 12,500–33,499)",
    status: "Historical",
  },
  {
    address: "0x284Eb4016305Fa7FbC162Fb68F27227271001c7f",
    label: "Grid Mining (Legacy)",
    purpose: "V1 contract (ended block 17,440,150); historical dividends",
    status: "Historical",
  },
  {
    address: "0x8C756B6738BdD687C3376C748C63419bE0412FDD",
    label: "Genesis Game",
    purpose: "Early game contract",
    status: "Historical",
  },
  {
    address: "0x34DD8699E4E9CB6bBA58e28F0233F6e23CeC0387",
    label: "AutoCommit V3",
    purpose: "Current automated recurring bet plans",
    status: "Production",
  },
  {
    address: "0x5FD69EE67472495CDc0BE784898647782E073Ff5",
    label: "AutoCommit V3 (Legacy)",
    purpose: "Previous recurring bet plans",
    status: "Historical",
  },
  {
    address: "0x314C8D5755468224AC60C36FB5494F0D7D5AbB3B",
    label: "AutoCommit V2",
    purpose: "Older auto-commit version",
    status: "Historical",
  },
  {
    address: "0x1399115FCF2A9C41E5080547A9214156A4bf8a45",
    label: "AutoCommit V1",
    purpose: "Original auto-commit version",
    status: "Historical",
  },
  {
    address: "0x44B3D5b8D31251D49Ca4c88b6a82594947693A5C",
    label: "ClaimLocker V2",
    purpose: "Current claims-to-vote-escrow locker",
    status: "Production",
  },
  {
    address: "0x83F84C5d431a986a1AB209F902B954b5D3550d8c",
    label: "ClaimLocker V2 (Legacy)",
    purpose: "Previous claims-to-vote-escrow locker",
    status: "Historical",
  },
  {
    address: "0x2FD3BE762Eb9D8Ee293DD923D8809DBd3d653Dd7",
    label: "ClaimLocker V1",
    purpose: "Original claim locker",
    status: "Historical",
  },
  {
    address: "0x740A66fc9201962f39802d924D4C2347cdf823A1",
    label: "MultiClaim",
    purpose: "Current batch-claim helper",
    status: "Production",
  },
  {
    address: "0x9F34a8561f97E388D4A1589c1D046C61d6915323",
    label: "MultiClaim (Legacy)",
    purpose: "Previous batch-claim helper",
    status: "Historical",
  },
  {
    address: "0x32783F1301147F6fB45C049A9546819655F81415",
    label: "MultiClaim V1",
    purpose: "Original multi-claim",
    status: "Historical",
  },
  {
    address: "0x1F3B0992FaBCF77d4df7Baa416b9185e464d58f3",
    label: "Drand Provider",
    purpose: "Randomness for round resolution",
    status: "Production",
  },
  {
    address: "0x24B723e2Da172961F60Cd6a4699654c89D4aC6cd",
    label: "Jackpot",
    purpose: "Holds/pays the protocol jackpot",
    status: "Production",
  },
  {
    address: "0x3942CdA122eF303f47d4509A6Be57736E323cEE4",
    label: "Game Registry",
    purpose: "Registry/status for all lottery deployments",
    status: "Production",
  },
  {
    address: "0x55FC0daaB486E46fBF1d60787420c0311d9Dd57f",
    label: "SLVR Hub",
    purpose: "Protocol revenue/reward hub",
    status: "Production",
  },
  {
    address: "0xd9b8FBD61033145c5496132153CE675756313B71",
    label: "Vote Escrow NFT",
    purpose: "Locks SLVR, issues veSLVR NFTs",
    status: "Production",
  },
  {
    address: "0xaF68598eBd245DC3cB92FF16E9Ba1814DD137200",
    label: "veSLVR Staking",
    purpose: "Stakes veSLVR, distributes protocol revenue",
    status: "Production",
  },
  {
    address: "0x7D888f4Ca88Fc3578aEfc45C82482Bd66415DfeA",
    label: "LP Staking",
    purpose: "Stakes SLVR/WETH V2 LP tokens",
    status: "Production",
  },
  {
    address: "0xFAfcBd4D09C096Eb06Aa2256C7A65CEAB2db39F5",
    label: "Team Vesting",
    purpose: "Team allocation (locked veNFT)",
    status: "Infrastructure",
  },
  {
    address: "0x1A1633FDB2f19082099A6AD6C3d4F1Ec6BCE9729",
    label: "Growth Fund",
    purpose: "Growth allocation + revenue routing",
    status: "Infrastructure",
  },
  {
    address: "0x4ba36b684350471c6fA03f4EBdEF9120496db45F",
    label: "veSLVR Metadata",
    purpose: "On-chain veSLVR NFT metadata renderer",
    status: "Production",
  },
  {
    address: "0x85b10820F5b7EF2BBf9F5b59dA64860Dd6bFB9f0",
    label: "Liquidity Zap",
    purpose: "Single-side liquidity provision helper",
    status: "Production",
  },
  {
    address: "0xF9D2540662F48F21364b98240574384Fe88E8f2f",
    label: "Jackpot Insurance",
    purpose: "Jackpot insurance mechanism",
    status: "Production",
  },
  {
    address: "0xe365b92239097Ed3322131411DbE15a5c4068eff",
    label: "SLVR/WETH V2 Pair",
    purpose: "Primary DEX liquidity pool (price source)",
    status: "Production",
  },
  {
    address: "0x89E5DB8B5aa49Aa85aC63f691524311aEB649eba",
    label: "Uniswap V2 Router",
    purpose: "DEX swap router",
    status: "Infrastructure",
  },
  {
    address: "0x8BceAa40B9acdfaedf85ADF4ff01F5aD6517937f",
    label: "Uniswap V2 Factory",
    purpose: "DEX pair factory",
    status: "Infrastructure",
  },
  {
    address: "0x0BD7D308F8E1639FAb988dF18a8011F41EAcAD73",
    label: "WETH",
    purpose: "Wrapped ETH token",
    status: "Infrastructure",
  },
  {
    address: "0x5FC5360D0400A0Fd4F2Af552add042D716F1D168",
    label: "USDG",
    purpose: "USDG stablecoin",
    status: "Infrastructure",
  },
  {
    address: "0x11111972fE1b7E52d36609bCaF8702C65B025B46",
    label: "Protocol Deployer",
    purpose: "Deployer EOA",
    status: "Infrastructure",
  },
  {
    address: "0x4444479b89B684e79392924b3a70Be03733190DE",
    label: "Growth Recipient",
    purpose: "Growth fund recipient wallet",
    status: "Infrastructure",
  },
];

const STATUS_COLORS: Record<string, string> = {
  Production: "var(--color-fresh)",
  Historical: "var(--color-silver-400)",
  Infrastructure: "var(--color-accent)",
};

export default function ContractTable() {
  return (
    <div className="flex flex-col gap-8">
      <div className="overflow-x-auto">
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "0.8125rem",
          }}
        >
          <thead>
            <tr
              style={{
                backgroundColor: "var(--color-silver-900)",
              }}
            >
              {["Label", "Purpose", "Address", "Status"].map((col) => (
                <th
                  key={col}
                  style={{
                    padding: "10px 12px",
                    textAlign: "left",
                    color: "var(--color-silver-400)",
                    fontWeight: 600,
                    fontSize: "0.6875rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    borderBottom: "1px solid var(--color-silver-800)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALL_CONTRACTS.map((c, i) => (
              <tr
                key={c.address}
                style={{
                  backgroundColor:
                    i % 2 === 0
                      ? "var(--color-silver-950)"
                      : "var(--color-silver-900)",
                  borderBottom: "1px solid var(--color-silver-800)",
                }}
              >
                <td
                  style={{
                    padding: "8px 12px",
                    color: "var(--color-silver-200)",
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.label}
                </td>
                <td
                  style={{
                    padding: "8px 12px",
                    color: "var(--color-silver-400)",
                    maxWidth: 280,
                  }}
                >
                  {c.purpose}
                </td>
                <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                  <AddressLabel address={c.address} showFull />
                </td>
                <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                  <span
                    style={{
                      fontSize: "0.625rem",
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: STATUS_COLORS[c.status],
                    }}
                  >
                    {c.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p
        style={{
          fontSize: "0.75rem",
          color: "var(--color-silver-400)",
        }}
      >
        All addresses on Robinhood Chain (ID 4663). Links open{" "}
        <a
          href="https://robinhoodchain.blockscout.com"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--color-accent)", textDecoration: "none" }}
        >
          Blockscout Explorer
        </a>
        .
      </p>
    </div>
  );
}
