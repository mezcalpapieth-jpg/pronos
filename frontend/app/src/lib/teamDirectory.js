function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function teamDirectoryKey(team = {}) {
  if (!team.sport || !team.slug) return null;
  return `${team.sport}:${team.slug}`;
}

export function mergeTeamDirectoryLogos(teams = [], logoByTeam = {}) {
  return teams.map(team => {
    const key = teamDirectoryKey(team);
    return {
      ...team,
      logoUrl: team.logoUrl || (key ? logoByTeam[key] : null) || null,
    };
  });
}

export function sortTeamsForDirectory(teams = [], sportFilter = 'all') {
  return [...teams].sort((a, b) => {
    const nameCompare = normalizeName(a.name).localeCompare(normalizeName(b.name));
    if (sportFilter === 'all') {
      if (nameCompare) return nameCompare;
      const sportCompare = String(a.sport || '').localeCompare(String(b.sport || ''));
      if (sportCompare) return sportCompare;
      return String(a.league || '').localeCompare(String(b.league || ''));
    }

    const leagueCompare = String(a.league || '').localeCompare(String(b.league || ''));
    if (leagueCompare) return leagueCompare;
    return nameCompare;
  });
}
