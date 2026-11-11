export const RIS26_JAR_EVENT = {
  key: 'ris26',
  title: 'RIS 26',
  cookieName: 'pronos_ris26_player',
  participantPath: '/ris26/participar',
};

export const FESTIVAL_JAR_EVENT = {
  key: 'trading-festival-2026-jar',
  title: 'Trading Festival',
  cookieName: 'pronos_trading_festival_jar_player',
  participantPath: '/tradingfestival/participar',
};

export function getJarEvent(key) {
  if (key === undefined || key === RIS26_JAR_EVENT.key) return RIS26_JAR_EVENT;
  if (key === FESTIVAL_JAR_EVENT.key) return FESTIVAL_JAR_EVENT;
  return null;
}

export function isFestivalJarParticipant(location) {
  return location.pathname.replace(/\/$/, '') === FESTIVAL_JAR_EVENT.participantPath;
}
