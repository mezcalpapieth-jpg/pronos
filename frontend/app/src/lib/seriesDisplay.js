function compactTeamName(name) {
  if (!name) return '';
  return String(name)
    .replace(/\b(The|FC|CF|SC)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function teamName(team, fallback) {
  return compactTeamName(team?.shortName || team?.abbreviation || team?.name) || fallback;
}

function finiteWins(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : null;
}

function defaultTranslate(key, vars = {}) {
  if (key === 'points.series.game') return `Juego ${vars.num}`;
  if (key === 'points.series.tied') return `Serie empatada ${vars.score}`;
  if (key === 'points.series.leads') return `${vars.team} lidera ${vars.score}`;
  return key;
}

export function formatSeriesGameLabel(gameNumber, { t } = {}) {
  if (!gameNumber) return '';
  const translate = t || defaultTranslate;
  return translate('points.series.game', { num: gameNumber });
}

export function formatSeriesScoreSummary(seriesMeta, { t } = {}) {
  const a = finiteWins(seriesMeta?.teamAWins);
  const b = finiteWins(seriesMeta?.teamBWins);
  if (a == null || b == null) return seriesMeta?.summary || null;

  const translate = t || defaultTranslate;
  const score = `${a}-${b}`;
  if (a === b) return translate('points.series.tied', { score });
  if (a > b) {
    return translate('points.series.leads', {
      team: teamName(seriesMeta?.teams?.[0] || seriesMeta?.homeTeam, 'Equipo A'),
      score,
    });
  }
  return translate('points.series.leads', {
    team: teamName(seriesMeta?.teams?.[1] || seriesMeta?.awayTeam, 'Equipo B'),
    score: `${b}-${a}`,
  });
}

export function formatSeriesSubtitle(seriesMeta, { t } = {}) {
  const label = formatSeriesGameLabel(seriesMeta?.gameNumber, { t });
  const summary = formatSeriesScoreSummary(seriesMeta, { t });
  if (!label) return summary;
  return summary ? `${label} · ${summary}` : label;
}
