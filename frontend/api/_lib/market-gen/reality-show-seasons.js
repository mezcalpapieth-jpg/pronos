import { formatMexicoDateYmd } from './mexico-time.js';

// Update each window when the broadcaster publishes a new season. Dates are inclusive in Mexico City.
const SEASON_WINDOWS = {
  lcdlf: {
    // https://www.lacasadelosfamososmexico.tv/cuanto-durara-la-casa-de-los-famosos-mexico-2026/
    // https://www.lacasadelosfamososmexico.tv/cuando-es-la-gran-final-de-la-casa-de-los-famosos-mexico-2026/
    start: '2026-07-26',
    end: '2026-10-04',
  },
  'granja-vip': {
    // Azteca announced a September 6 premiere and roughly 15 weeks. Week 15 ends December 20.
    // This cutoff is provisional until Azteca announces the finale date.
    // https://www.tvazteca.com/aztecauno/la-granja-vip/que-pasara-esperada-gala-estreno/
    start: '2026-09-06',
    end: '2026-12-20',
  },
};

export function isRealityShowInSeason(show, date) {
  const { start, end } = SEASON_WINDOWS[show];
  const day = formatMexicoDateYmd(date);
  return day >= start && day <= end;
}
