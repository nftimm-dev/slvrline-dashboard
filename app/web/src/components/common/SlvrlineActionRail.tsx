import { SlvrlineActions } from "./SlvrlineActionLink";

export default function SlvrlineActionRail() {
  return (
    <section
      className="mb-9 flex flex-col gap-4 border-y py-4 sm:flex-row sm:items-center sm:justify-between"
      style={{ borderColor: "var(--color-silver-800)" }}
      aria-label="Take action on slvrline.fun"
    >
      <div className="max-w-[36rem]">
        <div
          className="font-mono uppercase"
          style={{
            color: "var(--color-apr)",
            fontSize: "0.625rem",
            fontWeight: 700,
            letterSpacing: "0.12em",
            marginBottom: 5,
          }}
        >
          Put the data to work
        </div>
        <p
          style={{
            color: "var(--color-silver-300)",
            fontSize: "0.8125rem",
            lineHeight: 1.5,
          }}
        >
          Auto-Staking handles claimed ETH rewards with your Hold / Buy +
          Permanent Lock split.
        </p>
      </div>
      <SlvrlineActions
        actions={["autoStaking", "mining", "swapBridge"]}
        compact={false}
        className="sm:justify-end"
      />
    </section>
  );
}
