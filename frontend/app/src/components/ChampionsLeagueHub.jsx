import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CHAMPIONS_LEAGUE_FINAL,
  CHAMPIONS_LEAGUE_MARKET_GROUPS,
  CHAMPIONS_LEAGUE_NEXT_SEASON,
  CHAMPIONS_LEAGUE_ROAD,
  finalMarketOptions,
  formatCountdown,
  formatKickoff,
} from '../lib/championsLeague.js';

const surface = 'linear-gradient(150deg, rgba(0,65,112,0.28), rgba(239,1,7,0.18) 48%, rgba(212,175,55,0.18)), var(--surface1)';
const panel = 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.012)), var(--surface1)';

function pad(n) {
  return String(n).padStart(2, '0');
}

function useFinalCountdown() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return formatCountdown(CHAMPIONS_LEAGUE_FINAL.kickoffIso, now);
}

function TeamCrest({ team, size = 76 }) {
  const [failed, setFailed] = useState(false);
  if (failed || !team.crestUrl) {
    return (
      <span style={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        background: `linear-gradient(135deg, ${team.primary}, ${team.secondary})`,
        fontFamily: 'var(--font-display)',
        fontSize: Math.max(18, size * 0.28),
        letterSpacing: '0.04em',
        boxShadow: `0 0 40px ${team.primary}66`,
        flexShrink: 0,
      }}>
        {team.shortName}
      </span>
    );
  }
  return (
    <img
      src={team.crestUrl}
      alt={`${team.name} crest`}
      onError={() => setFailed(true)}
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        filter: 'drop-shadow(0 18px 30px rgba(0,0,0,0.45))',
        flexShrink: 0,
      }}
    />
  );
}

function CountdownUnit({ value, label }) {
  return (
    <div style={{
      minWidth: 74,
      padding: '12px 10px',
      borderRadius: 8,
      border: '1px solid rgba(255,255,255,0.12)',
      background: 'rgba(0,0,0,0.28)',
      textAlign: 'center',
    }}>
      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: 28,
        lineHeight: 1,
        color: 'var(--text-primary)',
      }}>
        {value}
      </div>
      <div style={{
        marginTop: 6,
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        letterSpacing: '0.14em',
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
      }}>
        {label}
      </div>
    </div>
  );
}

function ClosedPill({ children = 'Finalizado', tone = 'closed' }) {
  const dot = tone === 'open' ? 'var(--green)' : tone === 'pending' ? '#f59e0b' : '#94a3b8';
  const color = tone === 'open' ? 'var(--green)' : tone === 'pending' ? '#f59e0b' : 'var(--text-muted)';
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: 999,
      padding: '5px 9px',
      background: 'rgba(255,255,255,0.045)',
      color,
      fontFamily: 'var(--font-mono)',
      fontSize: 9,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: dot }} />
      {children}
    </span>
  );
}

function TeamColumn({ team, side }) {
  const key = side === 'home' ? 'psg' : 'arsenal';
  return (
    <div style={{
      display: 'grid',
      gap: 10,
      minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <TeamCrest team={team} size={44} />
        <div>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 24,
            color: 'var(--text-primary)',
            letterSpacing: '0.02em',
          }}>
            {team.shortName}
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--text-muted)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}>
            {team.city}
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {CHAMPIONS_LEAGUE_ROAD.map(round => (
          <div
            key={`${team.shortName}-${round.id}`}
            style={{
              display: 'grid',
              gridTemplateColumns: '86px 1fr auto',
              alignItems: 'center',
              gap: 10,
              padding: '9px 10px',
              borderRadius: 8,
              border: round.id === 'final' ? `1px solid ${team.secondary}66` : '1px solid var(--border)',
              background: round.id === 'final' ? `${team.primary}24` : 'rgba(255,255,255,0.025)',
            }}
          >
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              color: round.id === 'final' ? team.secondary : 'var(--text-muted)',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}>
              {round.label}
            </span>
            <span style={{
              fontFamily: 'var(--font-body)',
              fontSize: 12,
              color: 'var(--text-secondary)',
              minWidth: 0,
            }}>
              {round[key]}
            </span>
            <ClosedPill />
          </div>
        ))}
      </div>
    </div>
  );
}

function statusPillProps(status) {
  if (status === 'open') return { label: 'Abierto', tone: 'open' };
  if (status === 'pending') return { label: 'Por abrir', tone: 'pending' };
  return { label: 'Finalizado', tone: 'closed' };
}

function MarketArchive({ finalMarket, marketHref }) {
  const groups = CHAMPIONS_LEAGUE_MARKET_GROUPS.map(group => {
    if (group.id !== 'final-market' || !finalMarket) return group;
    return {
      ...group,
      markets: group.markets.map(market => (
        market.id === 'ucl-final-winner'
          ? {
              ...market,
              question: finalMarket.question || market.question,
              result: 'Ir al mercado',
              status: 'open',
              href: marketHref,
            }
          : market
      )),
    };
  });

  return (
    <section style={{ display: 'grid', gap: 14 }}>
      <div>
        <h2 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 28,
          letterSpacing: '0.02em',
          color: 'var(--text-primary)',
          margin: 0,
        }}>
          Mercados del torneo
        </h2>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: 14,
      }}>
        {groups.map(group => (
          <article
            key={group.id}
            style={{
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: panel,
              padding: 16,
              display: 'grid',
              gap: 13,
            }}
          >
            <div>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                letterSpacing: '0.14em',
                color: '#93c5fd',
                textTransform: 'uppercase',
                marginBottom: 6,
              }}>
                {group.eyebrow}
              </div>
              <h3 style={{
                fontFamily: 'var(--font-display)',
                fontSize: 22,
                color: 'var(--text-primary)',
                margin: 0,
              }}>
                {group.title}
              </h3>
              <p style={{
                margin: '7px 0 0',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-body)',
                fontSize: 13,
                lineHeight: 1.45,
              }}>
                {group.summary}
              </p>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {group.markets.map(market => {
                const status = statusPillProps(market.status);
                const content = (
                  <>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      alignItems: 'flex-start',
                    }}>
                      <div style={{
                        fontFamily: 'var(--font-body)',
                        fontSize: 13,
                        color: 'var(--text-secondary)',
                        lineHeight: 1.35,
                      }}>
                        {market.question}
                      </div>
                      <ClosedPill tone={status.tone}>{status.label}</ClosedPill>
                    </div>
                    <div style={{
                      marginTop: 8,
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 10,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      letterSpacing: '0.06em',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                    }}>
                      <span>{market.href ? 'Mercado' : 'Resultado'}</span>
                      <span style={{ color: market.status === 'open' ? 'var(--green)' : 'var(--text-secondary)' }}>
                        {market.result}
                      </span>
                    </div>
                  </>
                );
                const rowStyle = {
                  display: 'block',
                  textDecoration: 'none',
                  border: market.href ? '1px solid rgba(34,197,94,0.28)' : '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 8,
                  padding: '10px 11px',
                  background: market.href ? 'rgba(34,197,94,0.07)' : 'rgba(0,0,0,0.18)',
                };
                return market.href ? (
                  <Link key={market.id} to={market.href} style={rowStyle}>
                    {content}
                  </Link>
                ) : (
                  <div key={market.id} style={rowStyle}>
                    {content}
                  </div>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function BracketStrip() {
  return (
    <section style={{
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'linear-gradient(90deg, rgba(0,65,112,0.18), rgba(255,255,255,0.025), rgba(239,1,7,0.16))',
      padding: 18,
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 14,
        marginBottom: 16,
      }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            color: '#facc15',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
          }}>
            Bracket
          </div>
          <h2 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 26,
            margin: '4px 0 0',
            color: 'var(--text-primary)',
          }}>
            Road to Budapest
          </h2>
        </div>
        <ClosedPill>Archivo</ClosedPill>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, minmax(140px, 1fr))',
        gap: 10,
        overflowX: 'auto',
        paddingBottom: 2,
      }}>
        {CHAMPIONS_LEAGUE_ROAD.map(round => (
          <div
            key={round.id}
            style={{
              minWidth: 140,
              border: round.id === 'final' ? '1px solid rgba(250,204,21,0.45)' : '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              padding: 12,
              background: round.id === 'final' ? 'rgba(250,204,21,0.08)' : 'rgba(0,0,0,0.2)',
              display: 'grid',
              gap: 8,
            }}
          >
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              letterSpacing: '0.12em',
              color: round.id === 'final' ? '#facc15' : 'var(--text-muted)',
              textTransform: 'uppercase',
            }}>
              {round.label}
            </div>
            <div style={{
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              color: 'var(--text-secondary)',
              lineHeight: 1.4,
            }}>
              {round.psg}
            </div>
            <div style={{
              height: 1,
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)',
            }} />
            <div style={{
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              color: 'var(--text-secondary)',
              lineHeight: 1.4,
            }}>
              {round.arsenal}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FinalMarketPanel({ final, finalMarket, finalMarketLoading, marketHref }) {
  const liveOptions = finalMarket ? finalMarketOptions(finalMarket) : [];
  const options = liveOptions.length >= 2
    ? liveOptions
    : [
        { label: final.home.name, pct: 50, image: final.home.crestUrl, outcomeIndex: 0 },
        { label: final.away.name, pct: 50, image: final.away.crestUrl, outcomeIndex: 1 },
      ];
  const statusLabel = finalMarketLoading ? 'Buscando' : finalMarket ? 'Abierto' : 'Por abrir';
  const statusTone = finalMarket ? 'open' : 'pending';
  const Panel = marketHref ? Link : 'div';
  const panelProps = marketHref ? { to: marketHref } : {};

  return (
    <Panel
      {...panelProps}
      style={{
        textDecoration: 'none',
        border: `1px solid ${finalMarket ? 'rgba(34,197,94,0.32)' : 'rgba(250,204,21,0.2)'}`,
        borderRadius: 8,
        padding: 12,
        background: finalMarket ? 'rgba(34,197,94,0.07)' : 'rgba(250,204,21,0.055)',
        display: 'grid',
        gap: 8,
      }}
    >
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        letterSpacing: '0.1em',
        color: finalMarket ? 'var(--green)' : '#facc15',
        textTransform: 'uppercase',
      }}>
        <span>Mercado principal</span>
        <ClosedPill tone={statusTone}>{statusLabel}</ClosedPill>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {options.slice(0, 2).map(row => {
          const isHome = String(row.label).toLowerCase().includes('psg')
            || String(row.label).toLowerCase().includes('paris');
          const color = isHome ? final.home.secondary : final.away.secondary;
          const image = row.image || (isHome ? final.home.crestUrl : final.away.crestUrl);
          return (
            <div key={`${row.label}-${row.outcomeIndex}`} style={{
              display: 'grid',
              gridTemplateColumns: '28px 1fr 52px',
              gap: 10,
              alignItems: 'center',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-body)',
              fontSize: 13,
            }}>
              <img
                src={image}
                alt=""
                style={{ width: 24, height: 24, objectFit: 'contain' }}
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
              <span>{row.label}</span>
              <span style={{
                color,
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                textAlign: 'right',
              }}>
                {row.pct}%
              </span>
              <span style={{
                gridColumn: '1 / -1',
                height: 5,
                borderRadius: 999,
                background: `linear-gradient(90deg, ${color} ${row.pct}%, rgba(255,255,255,0.08) ${row.pct}%)`,
              }} />
            </div>
          );
        })}
      </div>
      {marketHref && (
        <div style={{
          marginTop: 2,
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.08em',
          color: 'var(--green)',
          textTransform: 'uppercase',
          textAlign: 'right',
        }}>
          Abrir mercado
        </div>
      )}
    </Panel>
  );
}

export default function ChampionsLeagueHub({ surfaceLabel = 'Points', finalMarket = null, finalMarketLoading = false }) {
  const countdown = useFinalCountdown();
  const final = CHAMPIONS_LEAGUE_FINAL;
  const kickoff = useMemo(() => formatKickoff(final.kickoffIso), [final.kickoffIso]);
  const marketHref = finalMarket?.id ? `/market?id=${encodeURIComponent(finalMarket.id)}` : null;

  return (
    <main style={{
      '--text-primary': '#f8fafc',
      '--text-secondary': 'rgba(226,232,240,0.82)',
      '--text-muted': 'rgba(148,163,184,0.84)',
      '--surface1': '#070b14',
      '--surface2': '#0c1220',
      '--surface3': '#131c2d',
      '--border': 'rgba(255,255,255,0.14)',
      '--border-active': 'rgba(250,204,21,0.42)',
      '--green': '#22c55e',
      '--green-dim': 'rgba(34,197,94,0.12)',
      maxWidth: 1280,
      margin: '0 auto',
      padding: 'clamp(18px, 4vw, 32px) clamp(14px, 4vw, 48px) 72px',
      display: 'grid',
      gap: 24,
      color: '#f8fafc',
    }}>
      <section style={{
        position: 'relative',
        overflow: 'hidden',
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: surface,
        minHeight: 430,
        padding: 'clamp(22px, 5vw, 42px)',
        display: 'grid',
        alignItems: 'stretch',
      }}>
        <div aria-hidden style={{
          position: 'absolute',
          inset: '8% -12% auto auto',
          width: '48%',
          height: '84%',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '50%',
          transform: 'rotate(-11deg)',
          pointerEvents: 'none',
        }} />
        <div aria-hidden style={{
          position: 'absolute',
          inset: 'auto auto -38% -16%',
          width: 360,
          height: 360,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,65,112,0.52), transparent 66%)',
          pointerEvents: 'none',
        }} />

        <div style={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))',
          gap: 26,
          alignItems: 'center',
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
              marginBottom: 14,
            }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.16em',
                color: '#bfdbfe',
                textTransform: 'uppercase',
              }}>
                {final.competition} · {surfaceLabel}
              </span>
              <ClosedPill tone="open">Mercados del torneo</ClosedPill>
            </div>
            <h1 style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(42px, 8vw, 92px)',
              letterSpacing: '0.01em',
              lineHeight: 0.9,
              margin: 0,
              color: 'var(--text-primary)',
              maxWidth: 760,
            }}>
              PSG vs Arsenal
            </h1>
            <p style={{
              margin: '18px 0 0',
              maxWidth: 680,
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-body)',
              fontSize: 16,
              lineHeight: 1.55,
            }}>
              Una final con tratamiento de torneo: cuenta regresiva, mercados del torneo,
              bracket y camino de cada equipo para que la Champions se sienta como una sección viva.
            </p>
            <div style={{
              marginTop: 20,
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}>
              <Link
                to="/c/deportes?sport=soccer"
                style={{
                  textDecoration: 'none',
                  border: '1px solid rgba(255,255,255,0.14)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  color: 'var(--text-secondary)',
                  background: 'rgba(0,0,0,0.18)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                }}
              >
                Volver a fútbol
              </Link>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text-muted)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}>
                {final.venue} · {kickoff}
              </span>
            </div>
          </div>

          <div style={{
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8,
            background: 'rgba(0,0,0,0.24)',
            padding: 18,
            display: 'grid',
            gap: 18,
          }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto 1fr',
              gap: 14,
              alignItems: 'center',
            }}>
              <div style={{ display: 'grid', justifyItems: 'center', gap: 8 }}>
                <TeamCrest team={final.home} />
                <strong style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--text-primary)' }}>
                  {final.home.shortName}
                </strong>
              </div>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 24,
                color: '#facc15',
                textShadow: '0 0 24px rgba(250,204,21,0.45)',
              }}>
                VS
              </div>
              <div style={{ display: 'grid', justifyItems: 'center', gap: 8 }}>
                <TeamCrest team={final.away} />
                <strong style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--text-primary)' }}>
                  {final.away.shortName}
                </strong>
              </div>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(68px, 1fr))',
              gap: 8,
            }}>
              <CountdownUnit value={countdown.days} label="días" />
              <CountdownUnit value={pad(countdown.hours)} label="hrs" />
              <CountdownUnit value={pad(countdown.minutes)} label="min" />
              <CountdownUnit value={pad(countdown.seconds)} label="seg" />
            </div>
            <FinalMarketPanel
              final={final}
              finalMarket={finalMarket}
              finalMarketLoading={finalMarketLoading}
              marketHref={marketHref}
            />
          </div>
        </div>
      </section>

      <section style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: 16,
      }}>
        <TeamColumn team={final.home} side="home" />
        <TeamColumn team={final.away} side="away" />
      </section>

      <BracketStrip />
      <MarketArchive finalMarket={finalMarket} marketHref={marketHref} />

      {CHAMPIONS_LEAGUE_NEXT_SEASON.enabled && (
        <section style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: panel,
          padding: 18,
        }}>
          <h2 style={{ margin: 0, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
            Champions League {CHAMPIONS_LEAGUE_NEXT_SEASON.season}
          </h2>
          <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>
            {CHAMPIONS_LEAGUE_NEXT_SEASON.copy}
          </p>
        </section>
      )}
    </main>
  );
}
