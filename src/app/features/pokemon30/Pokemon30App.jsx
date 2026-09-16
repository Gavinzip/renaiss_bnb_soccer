import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, CalendarDays, Sparkles, Ticket } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import renaissLogo from "../../assets/renaiss-logo-mark.webp";
import { PokemonPrizeStage } from "./PokemonPrizeStage";
import { PokemonTicketStatus } from "./PokemonTicketStatus";
import { buildPokemon30LoginUrl } from "./pokemon30Auth";
import {
  eventStatus,
  formatHongKongTime,
  POKEMON30_EVENT,
  POKEMON30_TICKET_RULES,
} from "./pokemon30Event";
import "./pokemon30.css";

export default function Pokemon30App() {
  const [isScrolled, setIsScrolled] = useState(false);
  const reducedMotion = useReducedMotion();
  const status = useMemo(() => eventStatus(), []);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 28);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const reveal = reducedMotion ? { duration: 0 } : { duration: 0.66, ease: [0.22, 0.76, 0.24, 1] };

  return (
    <main className="pokemon30-page">
      <header className={`pokemon-header ${isScrolled ? "pokemon-header--solid" : ""}`}>
        <a className="pokemon-header__brand" href="#top" aria-label="返回活動首頁">
          <img src={renaissLogo} alt="Renaiss" />
          <span>RENAISS</span>
        </a>
        <nav aria-label="活動導覽">
          <a href="#rules">抽獎券規則</a>
          <a href="#schedule">活動安排</a>
        </nav>
        <a className="pokemon-header__login" href={buildPokemon30LoginUrl()}>
          Renaiss SSO <ArrowUpRight size={15} />
        </a>
      </header>

      <section className="pokemon-hero" id="top">
        <motion.div
          className="pokemon-hero__copy"
          initial={reducedMotion ? false : { y: 20, filter: "blur(7px)" }}
          animate={{ y: 0, filter: "blur(0px)" }}
          transition={reveal}
        >
          <div className="pokemon-kicker"><Sparkles size={15} /> Pokémon 30th Celebration</div>
          <p className="pokemon-hero__eyebrow">2026.09.16 — 09.23 · 香港時間</p>
          <h1>Pokémon 30 週年<br />抽獎活動</h1>
          <p className="pokemon-hero__lede">活動期間，抽中各卡機的最低級並完成 buyback，即可累積 Pokémon 30 週年禮盒抽獎券。每一張票均以鏈上回收額逐筆對帳。</p>
          <div className="pokemon-hero__actions">
            <a className="pokemon-button pokemon-button--primary" href="#rules">查看抽獎券規則 <ArrowDownRight size={18} /></a>
            <a className="pokemon-button pokemon-button--quiet" href={buildPokemon30LoginUrl()}>登入查看我的資格 <Ticket size={17} /></a>
          </div>
          <PokemonTicketStatus />
          <div className="pokemon-hero__meta">
            <span className={`pokemon-live-dot pokemon-live-dot--${status.id}`} />
            <strong>{status.label}</strong>
            <span>{formatHongKongTime(POKEMON30_EVENT.start)} 至 {formatHongKongTime(POKEMON30_EVENT.end)}</span>
          </div>
        </motion.div>

        <motion.div
          className="pokemon-hero__prize"
          initial={reducedMotion ? false : { y: 24, scale: 0.97, filter: "blur(5px)" }}
          animate={{ y: 0, scale: 1, filter: "blur(0px)" }}
          transition={{ ...reveal, delay: reducedMotion ? 0 : 0.11 }}
        >
          <div className="pokemon-prize-label">
            <span>PRIZE · 01</span>
            <strong>Pokémon 30th Celebration Box</strong>
          </div>
          <PokemonPrizeStage />
        </motion.div>
      </section>

      <section className="pokemon-rules" id="rules">
        <div className="pokemon-rules__intro">
          <h2>抽中最低等級，即可獲得抽獎券。</h2>
          <p>活動期間，抽中各卡機的最低等級並完成 buyback，即可獲得對應張數的抽獎券。四台現行 PANDORA 卡機按 BBBV 的 85% 計算 instant buyback；$100 限定卡機按 90% 計算。鏈上回收額不高於該最低等級 BBBV 的對應門檻，才會獲得抽獎券。</p>
        </div>
        <ol className="pokemon-ticket-grid">
          {POKEMON30_TICKET_RULES.map((rule, index) => (
            <li key={rule.price}>
              <span>0{index + 1}</span>
              <strong>{rule.price}</strong>
              <em>{rule.tickets}</em>
              <b>張抽獎券</b>
              <small>{rule.caption}</small>
            </li>
          ))}
        </ol>
      </section>

      <section className="pokemon-schedule" id="schedule">
        <div className="pokemon-schedule__intro">
          <span className="pokemon-section-label">Activity arrangement</span>
          <h2>活動安排</h2>
          <p>所有時間均為香港時間（UTC+8）。禮盒款式、數量、開獎時間與領獎方式將於確認後另行公布。</p>
        </div>
        <div className="pokemon-timeline">
          <article>
            <span>01</span>
            <CalendarDays size={22} />
            <h3>活動開始</h3>
            <time>2026 年 9 月 16 日 · 下午 7 時</time>
          </article>
          <article>
            <span>02</span>
            <Ticket size={22} />
            <h3>累積抽獎券</h3>
            <p>完成 buyback 且符合鏈上回收額門檻，即逐筆入帳。</p>
          </article>
          <article>
            <span>03</span>
            <Sparkles size={22} />
            <h3>活動截止與開獎</h3>
            <time>2026 年 9 月 23 日 · 下午 7 時</time>
          </article>
        </div>
      </section>

      <section className="pokemon-notice">
        <p>發布前待確認：卡機價格幣別、禮盒款式與數量、開獎安排、領獎方式與期限、同一帳戶重複中獎規則，以及是否沿用舊活動的 SBT 或發帖領獎要求。</p>
      </section>

      <footer className="pokemon-footer">
        <a href="#top"><img src={renaissLogo} alt="Renaiss" /> RENAISS</a>
        <span>Pokémon 30 週年抽獎活動 · 草稿</span>
        <a href={buildPokemon30LoginUrl()}>Renaiss SSO <ArrowUpRight size={14} /></a>
      </footer>
    </main>
  );
}
