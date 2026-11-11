import Link from "next/link";
import s from "./cli-list.module.css";

export const dynamic = "force-dynamic";

export default function CliToolsPage() {
  return (
    <>
      <header className={s.header}>
        <div className={s.intro}>
          <span className="eyebrow">Clients</span>
          <h1 className="page-title">CLI Tools</h1>
          <p className="lede">
            Choose a CLI to route through the proxy and set which model each of its slots runs on.
          </p>
        </div>
      </header>

      <div className={s.grid}>
        {/* Claude Code Card */}
        <Link href="/cli-tools/claude-code" className={s.card}>
          <div className={s.cardTop}>
            <div className={s.tile} style={{ background: "rgba(232, 145, 107, 0.14)", color: "#E8916B" }}>
              CC
            </div>
            <div className={s.cardInfo}>
              <div className={s.cardTitleRow}>
                <h2 className={s.cardTitle}>Claude Code</h2>
                <span className={s.badgeConfigured}>
                  <span className={s.dot} /> Configured
                </span>
              </div>
              <p className={s.cardDesc}>Anthropic&apos;s CLI for coding</p>
            </div>
          </div>
          <div className={s.cardBottom}>
            <span className={s.modelsCount}>4 models mapped</span>
            <span className={s.openLink}>Open &rarr;</span>
          </div>
        </Link>

        {/* Codex CLI Card */}
        <div className={`${s.card} ${s.disabled}`}>
          <div className={s.cardTop}>
            <div className={s.tile} style={{ background: "rgba(215, 219, 224, 0.14)", color: "#D7DBE0" }}>
              CX
            </div>
            <div className={s.cardInfo}>
              <div className={s.cardTitleRow}>
                <h2 className={s.cardTitle}>Codex CLI</h2>
                <span className={s.badgeComingSoon}>Coming soon</span>
              </div>
              <p className={s.cardDesc}>OpenAI&apos;s CLI for coding</p>
            </div>
          </div>
        </div>

        {/* OpenCode Card */}
        <div className={`${s.card} ${s.disabled}`}>
          <div className={s.cardTop}>
            <div className={s.tile} style={{ background: "rgba(127, 168, 255, 0.14)", color: "#7FA8FF" }}>
              OC
            </div>
            <div className={s.cardInfo}>
              <div className={s.cardTitleRow}>
                <h2 className={s.cardTitle}>OpenCode</h2>
                <span className={s.badgeComingSoon}>Coming soon</span>
              </div>
              <p className={s.cardDesc}>Open-source terminal agent</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
