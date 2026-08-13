// ─── I18N ────────────────────────────────────────────────────────────────────
// Tiny dictionary-based translation layer for the Pronos UI chrome.
// Market titles themselves are NOT translated — they come from Polymarket
// (English) or the hardcoded MARKETS file (Spanish) and stay in their source
// language. This module only handles the surrounding UI: nav, buttons, banners,
// modal copy, etc.
//
// Usage:
//   import { useT, setLang } from '../lib/i18n.js';
//   function MyButton() {
//     const t = useT();
//     return <button>{t('nav.predict')}</button>;
//   }
//
// To add a string: add a key under STRINGS with both `es` and `en`. Missing
// keys fall back to Spanish, then to the raw key, so it's safe to ship a
// partial translation.

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'pronos-lang';
const CHANGE_EVENT = 'pronos-lang-change';

export const LANGS = ['es', 'en'];
export const DEFAULT_LANG = 'es';

// Read saved language. Defaults to Spanish — switching is opt-in via the toggle
// so existing users see no change unless they explicitly choose English.
export function getLang() {
  if (typeof window === 'undefined') return DEFAULT_LANG;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return LANGS.includes(v) ? v : DEFAULT_LANG;
  } catch (_) {
    return DEFAULT_LANG;
  }
}

export function setLang(lang) {
  if (!LANGS.includes(lang)) return;
  try { window.localStorage.setItem(STORAGE_KEY, lang); } catch (_) {}
  // Broadcast so every useT() subscriber re-renders without prop-drilling
  // through Privy / Router providers.
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: lang }));
}

// React hook: returns a `t(key, vars)` function and re-renders the calling
// component whenever the language changes.
export function useT() {
  const [lang, setLocalLang] = useState(getLang);
  useEffect(() => {
    const handler = (e) => setLocalLang(e.detail || getLang());
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, []);
  return (key, vars) => translate(key, lang, vars);
}

// Same as useT but exposes the language string itself (for conditional copy
// or formatting that doesn't fit a single key).
export function useLang() {
  const [lang, setLocalLang] = useState(getLang);
  useEffect(() => {
    const handler = (e) => setLocalLang(e.detail || getLang());
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, []);
  return lang;
}

// ─── Market title / option localization ─────────────────────────────────────
// Polymarket markets carry both `title_en` (Gamma original) and `title_es`
// (admin-approved Spanish translation). These helpers pick the right one based
// on the active language, falling back to whatever `title` holds.

/**
 * Pick the language-appropriate title for a market object.
 */
export function localizedTitle(market, lang) {
  if (!market) return '';
  if (lang === 'en' && market.title_en) return market.title_en;
  if (lang === 'es' && market.title_es) return market.title_es;
  return market.title || '';
}

// Common option labels that should auto-translate even when no explicit
// options_en / options_es exists (e.g. Polymarket markets whose translation
// failed or wasn't cached yet).
const LABEL_EN_TO_ES = { 'Yes': 'Sí', 'yes': 'sí', 'Draw': 'Empate', 'Other': 'Otro' };
const LABEL_ES_TO_EN = { 'Sí': 'Yes', 'sí': 'yes', 'Empate': 'Draw', 'Otro': 'Other' };

/**
 * Pick the language-appropriate options array. Merges localized labels onto
 * the base `market.options` so live `pct` values are always preserved.
 * When no explicit alt array exists, common labels (Yes/No, Sí/No) are
 * auto-translated so markets never show mixed-language labels.
 */
export function localizedOptions(market, lang) {
  if (!market || !Array.isArray(market.options)) return market?.options || [];
  const alt = lang === 'en' ? market.options_en
            : lang === 'es' ? market.options_es
            : null;
  if (Array.isArray(alt)) {
    return market.options.map((opt, i) => ({
      ...opt,
      label: alt[i]?.label ?? opt.label,
    }));
  }
  // Fallback: auto-translate common labels when no explicit alt exists
  const fallback = lang === 'es' ? LABEL_EN_TO_ES : lang === 'en' ? LABEL_ES_TO_EN : null;
  if (!fallback) return market.options;
  return market.options.map(opt => ({
    ...opt,
    label: fallback[opt.label] ?? opt.label,
  }));
}

// Pure translator — usable outside React components if needed.
export function translate(key, lang, vars) {
  const entry = STRINGS[key];
  if (!entry) return key;
  let str = entry[lang] || entry[DEFAULT_LANG] || key;
  if (vars && typeof str === 'string') {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return str;
}

// ─── DICTIONARY ──────────────────────────────────────────────────────────────
// Keys are organized by component prefix (nav.*, hero.*, bet.*, etc.) so it's
// easy to find what needs translating when adding a new feature.
const STRINGS = {
  // ── Nav ────────────────────────────────────────────────────────────────────
  'nav.search.placeholder':   { es: 'Buscar mercados…',     en: 'Search markets…' },
  'nav.search.empty':         { es: 'No se encontraron mercados', en: 'No markets found' },
  'nav.search.aria':          { es: 'Buscar',               en: 'Search' },
  'nav.market':               { es: 'El mercado',           en: 'Markets' },
  'nav.portfolio':            { es: 'Portafolio',           en: 'Portfolio' },
  'nav.howItWorks':           { es: 'Cómo funciona',        en: 'How it works' },
  'nav.theme':                { es: 'Cambiar tema',         en: 'Toggle theme' },
  'nav.deposit':              { es: 'Depositar',            en: 'Deposit' },
  'nav.switchTo':             { es: 'Cambiar a {chain}',    en: 'Switch to {chain}' },
  'nav.signOut':              { es: 'Cerrar sesión',        en: 'Sign out' },
  'nav.predict':              { es: 'Únete',                en: 'Log In' },
  'nav.admin':                { es: 'Admin',                en: 'Admin' },

  // ── Hero ───────────────────────────────────────────────────────────────────
  'hero.badge':               { es: 'Beta · Powered by Pronos', en: 'Beta · Powered by Pronos' },
  'hero.headline.line1':      { es: 'El primer mercado',    en: 'The first' },
  'hero.headline.line2':      { es: 'de predicciones',      en: 'prediction market' },
  'hero.headline.line3':      { es: 'de Latinoamérica',     en: 'in Latin America' },
  'hero.sub':                 { es: 'Predice eventos de política, deportes, cultura y crypto en Latinoamérica. Gana MXNB cuando aciertas. Sin intermediarios. Sin MetaMask.',
                                en: 'Predict politics, sports, culture and crypto events in Latin America. Earn MXNB when you\'re right. No middlemen. No MetaMask.' },
  'hero.cta.viewMarkets':     { es: 'Ver Mercados',         en: 'View Markets' },
  'hero.cta.start':            { es: 'Empezar a Predecir',  en: 'Start Predicting' },
  'hero.cta.howItWorks':      { es: 'Cómo funciona',        en: 'How it works' },
  'hero.stats.volumeLabel':   { es: 'volumen total',        en: 'total volume' },
  'hero.stats.activeLabel':   { es: 'mercados activos',     en: 'active markets' },
  'hero.stats.feeLabel':      { es: 'comisión · Arbitrum',  en: 'fee · Arbitrum' },
  'hero.featured':            { es: 'DESTACADOS',           en: 'FEATURED' },
  'hero.live':                { es: 'LIVE',                 en: 'LIVE' },

  // ── MarketsGrid / MarketCard ──────────────────────────────────────────────
  'grid.loading':             { es: 'CARGANDO MERCADOS…',   en: 'LOADING MARKETS…' },
  'grid.empty':               { es: 'No hay mercados en esta categoría.', en: 'No markets in this category.' },
  'grid.fallback':            { es: 'No pudimos cargar mercados on-chain.', en: 'Could not load on-chain markets.' },
  'card.resolved':            { es: 'RESUELTO',             en: 'RESOLVED' },
  'card.closed':              { es: 'CERRADO',              en: 'CLOSED' },
  'card.trending':            { es: 'TRENDING',             en: 'TRENDING' },
  'card.live':                { es: 'LIVE',                 en: 'LIVE' },

  // ── Categories ────────────────────────────────────────────────────────────
  'cat.trending':             { es: 'Trending',             en: 'Trending' },
  'cat.all':                  { es: 'Todos',                en: 'All' },
  'cat.mexico':               { es: 'Mexico & Latam',       en: 'Mexico & Latam' },
  'cat.politica':             { es: 'Política Internacional', en: 'World Politics' },
  'cat.deportes':             { es: 'Deportes',             en: 'Sports' },
  'cat.finanzas':             { es: '$ Finanzas',           en: '$ Finance' },
  'cat.crypto':               { es: '₿ Crypto',             en: '₿ Crypto' },
  'cat.musica':               { es: 'Entretenimiento',     en: 'Entertainment' },
  'cat.resueltos':            { es: 'Resueltos',            en: 'Resolved' },

  // ── BetModal ───────────────────────────────────────────────────────────────
  'bet.title':                { es: 'COLOCAR APUESTA',      en: 'PLACE BET' },
  'bet.balance':              { es: 'Balance MXNB',         en: 'MXNB Balance' },
  'bet.amount':               { es: 'MONTO (MXNB)',         en: 'AMOUNT (MXNB)' },
  'bet.fee':                  { es: 'Comisión ({pct}%)',    en: 'Fee ({pct}%)' },
  'bet.estimatedPayout':      { es: 'Pago estimado',        en: 'Estimated payout' },
  'bet.profit':               { es: 'Ganancia potencial',   en: 'Potential profit' },
  'bet.implied':              { es: 'Probabilidad implícita', en: 'Implied probability' },
  'bet.priceAfter':           { es: 'Precio tras tu compra', en: 'Price after your trade' },
  'bet.slippage':             { es: 'Slippage',             en: 'Slippage' },
  'bet.previewLoading':       { es: 'Calculando on-chain…', en: 'Calculating on-chain…' },
  'bet.previewUnavailable':   { es: 'Vista previa no disponible', en: 'Preview unavailable' },
  'bet.btn.join':             { es: 'ÚNETE A LA LISTA',     en: 'JOIN THE WAITLIST' },
  'bet.btn.checking':         { es: 'Verificando…',         en: 'Checking…' },
  'bet.btn.approving':        { es: 'Aprobando MXNB…',      en: 'Approving MXNB…' },
  'bet.btn.signing':          { es: 'Firmando…',            en: 'Signing…' },
  'bet.btn.placing':          { es: 'Enviando orden…',      en: 'Submitting order…' },
  'bet.btn.success':          { es: 'COMPRA REALIZADA',     en: 'TRADE COMPLETE' },
  'bet.btn.buyAmount':        { es: 'COMPRAR ${amt} MXNB',  en: 'BUY ${amt} MXNB' },
  'bet.btn.buy':              { es: 'COMPRAR',              en: 'BUY' },
  'bet.btn.unavailable':      { es: 'SIN TRADING EN VIVO',  en: 'LIVE TRADING UNAVAILABLE' },
  'bet.invalidAmount':        { es: 'Ingresa un monto válido.', en: 'Enter a valid amount.' },
  'bet.noWallet':             { es: 'No se encontró wallet. Reconecta tu cuenta.',
                                en: 'No wallet found. Reconnect your account.' },
  'bet.checking':             { es: 'Verificando balance y permisos…',
                                en: 'Checking balance and permissions…' },
  'bet.switchingChain':       { es: 'Cambiando de red…',    en: 'Switching network…' },
  'bet.switchChain':          { es: 'Cambia a {chain} para continuar.',
                                en: 'Switch to {chain} to continue.' },
  'bet.insufficient':         { es: 'Balance insuficiente. Tienes ${bal} MXNB.',
                                en: 'Insufficient balance. You have ${bal} MXNB.' },
  'bet.approving':            { es: 'Aprobando MXNB…',
                                en: 'Approving MXNB…' },
  'bet.approved':             { es: 'MXNB aprobado',        en: 'MXNB approved' },
  'bet.signing':              { es: 'Firmando autenticación… (1 firma)',
                                en: 'Signing auth… (1 signature)' },
  'bet.placing':              { es: 'Enviando orden a Polymarket…',
                                en: 'Submitting order to Polymarket…' },
  'bet.placingProtocol':      { es: 'Enviando transacción al protocolo…',
                                en: 'Submitting protocol transaction…' },
  'bet.placed':               { es: '¡Orden enviada! ${amt} MXNB en "{outcome}"',
                                en: 'Bet placed! ${amt} MXNB on "{outcome}"' },
  'bet.warn.lowVolume':       { es: 'Volumen bajo: tu compra mueve el precio de {start}% a {end}% (+{pts} pts). Considera reducir el monto.',
                                en: 'Low volume: your trade moves the price from {start}% to {end}% (+{pts} pts). Consider reducing the amount.' },
  'bet.warn.lowLiquidity':    { es: 'Liquidez insuficiente: solo ${filled} MXNB pueden ejecutarse al precio actual. La orden podría fallar.',
                                en: 'Low liquidity: only ${filled} MXNB can fill at the current price. The order might fail.' },
  'bet.warn.demoMarket':      { es: 'Mercado demo: sin libro de órdenes en vivo, no podemos previsualizar slippage para este mercado.',
                                en: 'Demo market: no live order book, slippage preview unavailable for this market.' },
  'bet.noLiveTrading':        { es: 'Este mercado es informativo por ahora; todavía no tiene trading en vivo.',
                                en: 'This market is informational for now; live trading is not connected yet.' },
  'bet.protocolUnavailable':  { es: 'Este mercado del protocolo todavía no tiene pool o contratos configurados.',
                                en: 'This protocol market does not have a configured pool or contracts yet.' },
  'bet.protocol.poly':        { es: 'Polymarket · Polygon', en: 'Polymarket · Polygon' },
  'bet.protocol.own':         { es: 'Pronos Protocol · Arbitrum One', en: 'Pronos Protocol · Arbitrum One' },

  // ── MarketDetail ──────────────────────────────────────────────────────────
  'detail.loading':           { es: 'CARGANDO MERCADO…',    en: 'LOADING MARKET…' },
  'detail.notFound':          { es: 'Mercado no encontrado', en: 'Market not found' },
  'detail.back':              { es: '← Volver',             en: '← Back' },
  'detail.markets':           { es: '← MERCADOS',           en: '← MARKETS' },
  'detail.winner':            { es: 'Ganador',              en: 'Winner' },
  'detail.resolvedDate':      { es: 'MERCADO CERRADO · {date}', en: 'MARKET CLOSED · {date}' },
  'detail.resolved':          { es: 'RESUELTO',             en: 'RESOLVED' },
  'detail.awaitingTitle':     { es: 'Esperando resolución oficial', en: 'Awaiting official resolution' },
  'detail.awaitingSub':       { es: 'El resultado se publicará automáticamente cuando esté disponible',
                                en: 'The outcome will be published automatically when available' },
  'detail.toResolve':         { es: 'POR RESOLVER',         en: 'TO RESOLVE' },
  'detail.closed':            { es: 'CERRADO',              en: 'CLOSED' },
  'detail.lockedClosed':      { es: 'CERRADO',              en: 'CLOSED' },
  'detail.volume':            { es: 'VOLUMEN',              en: 'VOLUME' },
  'detail.liquidity':         { es: 'LIQUIDEZ',             en: 'LIQUIDITY' },
  'detail.closesOn':          { es: 'CIERRA',               en: 'CLOSES' },
  'detail.closedOn':          { es: 'CERRÓ',                en: 'CLOSED' },
  'detail.status':            { es: 'ESTADO',               en: 'STATUS' },
  'detail.statusActive':      { es: 'ACTIVO',               en: 'ACTIVE' },
  'detail.statusClosed':      { es: 'CERRADO',              en: 'CLOSED' },
  'detail.statusToResolve':   { es: 'POR RESOLVER',         en: 'TO RESOLVE' },
  'detail.priceHistory':      { es: 'HISTORIAL DE PRECIO',  en: 'PRICE HISTORY' },
  'detail.realtime':          { es: 'PRECIO EN TIEMPO REAL', en: 'REAL-TIME PRICE' },
  'detail.last30days':        { es: 'ÚLT. 30 DÍAS',         en: 'LAST 30 DAYS' },
  'detail.actions':           { es: 'ACCIONES',             en: 'ACTIONS' },
  'detail.waitingResult':     { es: 'ESPERANDO RESULTADO',  en: 'AWAITING RESULT' },
  'detail.rules':             { es: 'Reglas',               en: 'Rules' },
  'detail.context':           { es: 'Contexto de mercado',  en: 'Market context' },
  'detail.contextExtra':      { es: 'Contexto adicional',   en: 'Additional context' },
  'detail.updatedToday':      { es: 'Actualizado hoy',      en: 'Updated today' },
  'detail.aiSummary':         { es: 'Resumen experimental generado con IA referenciando datos de Pronos · Actualizado {date}',
                                en: 'Experimental AI-generated summary referencing Pronos data · Updated {date}' },
  'detail.comments':          { es: 'Comentarios',          en: 'Comments' },
  'detail.topHolders':        { es: 'Top Holders',          en: 'Top Holders' },
  'detail.positions':         { es: 'Posiciones',           en: 'Positions' },
  'detail.activity':          { es: 'Actividad',            en: 'Activity' },
  'detail.commentPlaceholder':{ es: 'Agrega un comentario...', en: 'Add a comment...' },
  'detail.publish':           { es: 'Publicar',             en: 'Publish' },
  'detail.externalWarn':      { es: 'Cuidado con links externos', en: 'Be careful with external links' },
  'detail.replies':           { es: '↩ {n} Respuestas',     en: '↩ {n} Replies' },
  'detail.timeAgo':           { es: '{t} atrás',            en: '{t} ago' },
  'detail.pnl':               { es: 'PNL',                  en: 'PnL' },
  'detail.all':               { es: 'Todos',                en: 'All' },
  'detail.minAmount':         { es: 'Monto mín ▾',          en: 'Min amount ▾' },
  'detail.live':              { es: 'En vivo',              en: 'Live' },
  'detail.boughtSold':        { es: 'Compró',               en: 'Bought' },
  'detail.finalProbs':        { es: 'PROBABILIDADES FINALES', en: 'FINAL PROBABILITIES' },
  'detail.closedAwaiting':    { es: 'CERRADO · ESPERANDO RESULTADO', en: 'CLOSED · AWAITING RESULT' },
  'detail.currentProb':       { es: 'PROBABILIDAD ACTUAL',  en: 'CURRENT PROBABILITY' },
  'detail.finalResults':      { es: 'RESULTADOS FINALES',   en: 'FINAL RESULTS' },
  'detail.results':           { es: 'RESULTADOS',           en: 'RESULTS' },
  'detail.buy':               { es: 'Comprar',              en: 'Buy' },
  'detail.marketResolved':    { es: 'MERCADO RESUELTO',     en: 'MARKET RESOLVED' },
  'detail.officialWinner':    { es: 'GANADOR OFICIAL',      en: 'OFFICIAL WINNER' },
  'detail.winningsPaid':      { es: 'GANANCIAS YA LIQUIDADAS', en: 'WINNINGS ALREADY PAID' },
  'detail.settledOnchain':    { es: 'Liquidado on-chain · MXNB', en: 'Settled on-chain · MXNB' },
  'detail.marketClosed':      { es: 'MERCADO CERRADO',      en: 'MARKET CLOSED' },
  'detail.closedAt':          { es: 'Cerró el {date}',      en: 'Closed on {date}' },
  'detail.officialSoon':      { es: 'El resultado oficial se publicará automáticamente en los próximos minutos.',
                                en: 'The official result will be posted automatically in the next few minutes.' },
  'detail.betsClosed':        { es: 'El mercado ya está cerrado', en: 'Betting is now closed' },
  'detail.buyTitle':          { es: 'COMPRAR',              en: 'BUY' },
  'detail.pickOutcome':       { es: 'Elige un resultado para comprar tu posición.',
                                en: 'Pick an outcome to buy your position.' },
  'detail.onchain':           { es: 'On-chain · MXNB',      en: 'On-chain · MXNB' },

  // ── Admin ─────────────────────────────────────────────────────────────────
  'admin.markets':            { es: 'Mercados',              en: 'Markets' },
  'admin.createMarket':       { es: 'Crear mercado',         en: 'Create market' },
  'admin.question':           { es: 'Pregunta',              en: 'Question' },
  'admin.questionPh':         { es: 'Ej: ¿México gana el Mundial 2026?', en: 'E.g. Will Mexico win the 2026 World Cup?' },
  'admin.category':           { es: 'Categoría',             en: 'Category' },
  'admin.icon':               { es: 'Icono',                 en: 'Icon' },
  'admin.closeDate':          { es: 'Fecha de cierre',       en: 'Close date' },
  'admin.options':            { es: 'OPCIONES',              en: 'OPTIONS' },
  'admin.addOption':          { es: '+ Agregar',             en: '+ Add' },
  'admin.optionPh':           { es: 'Opción',                en: 'Option' },
  'admin.creating':           { es: 'Creando…',              en: 'Creating…' },
  'admin.createBtn':          { es: 'Crear mercado',         en: 'Create market' },
  'admin.created':            { es: 'Mercado creado — aparecerá en la página principal.', en: 'Market created — will appear on the main page.' },
  'admin.optionsNeedName':    { es: 'Todas las opciones necesitan un nombre.', en: 'All options need a name.' },
  'admin.pendingTab':         { es: 'PENDIENTES',            en: 'PENDING' },
  'admin.open':               { es: 'ABIERTOS',              en: 'OPEN' },
  'admin.closed':             { es: 'CERRADOS',              en: 'CLOSED' },
  'admin.resolved':           { es: 'RESUELTOS',             en: 'RESOLVED' },
  'admin.all':                { es: 'Todos',                 en: 'All' },
  'admin.local':              { es: 'Locales',               en: 'Local' },
  'admin.market':             { es: 'Mercado',               en: 'Market' },
  'admin.source':             { es: 'Fuente',                en: 'Source' },
  'admin.deadline':           { es: 'Fecha límite',          en: 'Deadline' },
  'admin.status':             { es: 'Estado',                en: 'Status' },
  'admin.actions':            { es: 'Acciones',              en: 'Actions' },
  'admin.noMarkets':          { es: 'No hay mercados en esta categoría.', en: 'No markets in this category.' },
  'admin.active':             { es: 'Activo',                en: 'Active' },
  'admin.approve':            { es: 'Aprobar',               en: 'Approve' },
  'admin.reject':             { es: 'Rechazar',              en: 'Reject' },
  'admin.resolve':            { es: 'Resolver',              en: 'Resolve' },
  'admin.revoke':             { es: 'Revocar',               en: 'Revoke' },
  'admin.translating':        { es: 'Traduciendo…',          en: 'Translating…' },
  'admin.approved':           { es: 'Aprobado',              en: 'Approved' },
  'admin.pending':            { es: '○ Pendiente',           en: '○ Pending' },
  'admin.autoResolve':        { es: '▶ AUTO-RESOLVER AHORA', en: '▶ AUTO-RESOLVE NOW' },
  'admin.running':            { es: '⟳ CORRIENDO…',         en: '⟳ RUNNING…' },
  'admin.autoDesc':           { es: 'Cierra automáticamente los mercados que pasaron su fecha límite y resuelve los de Polymarket cuyo resultado ya está confirmado.',
                                en: 'Auto-closes markets past their deadline and resolves Polymarket markets whose outcome is already confirmed.' },
  'admin.pendingApproval':    { es: '{n} mercado{s} de Polymarket esperando aprobación · No aparecen en pronos.io hasta que los apruebes',
                                en: '{n} Polymarket market{s} awaiting approval · Not visible on pronos.io until approved' },
  'admin.translatingBanner':  { es: 'Traduciendo mercados al español…',  en: 'Translating markets to Spanish…' },
  'admin.translatedBanner':   { es: '{n} mercado{s} traducido{s} al español', en: '{n} market{s} translated to Spanish' },
  'admin.resolveTitle':       { es: 'RESOLVER MERCADO',      en: 'RESOLVE MARKET' },
  'admin.winnerOutcome':      { es: 'RESULTADO GANADOR',     en: 'WINNING OUTCOME' },
  'admin.resolvedBy':         { es: 'RESUELTO POR',          en: 'RESOLVED BY' },
  'admin.descOptional':       { es: 'DESCRIPCIÓN (OPCIONAL)', en: 'DESCRIPTION (OPTIONAL)' },
  'admin.selectOutcome':      { es: 'Selecciona un resultado', en: 'Select an outcome' },
  'admin.confirm':            { es: 'CONFIRMAR',             en: 'CONFIRM' },
  'admin.resolving':          { es: 'Resolviendo…',          en: 'Resolving…' },
  'admin.cancel':             { es: 'Cancelar',              en: 'Cancel' },

  // ── Footer ────────────────────────────────────────────────────────────────
  'footer.copyright':         { es: '© 2026 Pronos · El primer mercado de predicciones on-chain para LATAM',
                                en: '© 2026 Pronos · The first on-chain prediction market for LATAM' },
  'footer.home':              { es: 'Inicio',               en: 'Home' },
  'footer.privacy':           { es: 'Privacidad',           en: 'Privacy' },
  'footer.terms':             { es: 'Términos',             en: 'Terms' },
  'footer.contact':           { es: 'Contacto',             en: 'Contact' },

  // ── Legal pages ──────────────────────────────────────────────────────────
  'legal.privacy.title':      { es: 'Pronos Política de Privacidad', en: 'Pronos Privacy Policy' },
  'legal.terms.title':        { es: 'Pronos Términos y Condiciones', en: 'Pronos Terms of Service' },
  'legal.language.aria':      { es: 'Cambiar idioma del documento legal', en: 'Change legal document language' },
  'legal.language.es':        { es: 'Español',             en: 'Español' },
  'legal.language.en':        { es: 'English',             en: 'English' },

  // ── HowItWorks ────────────────────────────────────────────────────────────
  'how.label':                { es: 'Simple · Rápido · On-chain', en: 'Simple · Fast · On-chain' },
  'how.title':                { es: 'Cómo funciona',        en: 'How it works' },
  'how.step1.title':          { es: 'Crea tu cuenta',       en: 'Create your account' },
  'how.step1.desc':           { es: 'Regístrate con email o Google en segundos. Pronos crea automáticamente una wallet on-chain para ti — sin extensiones, sin seed phrases.',
                                en: 'Sign up with email or Google in seconds. Pronos automatically creates an on-chain wallet for you — no extensions, no seed phrases.' },
  'how.step2.title':          { es: 'Elige un mercado',     en: 'Pick a market' },
  'how.step2.desc':           { es: 'Explora mercados de política, deportes, cultura y crypto. Elige un resultado y cuánto quieres apostar en MXNB.',
                                en: 'Browse politics, sports, culture and crypto markets. Pick an outcome and how much you want to bet in MXNB.' },
  'how.step3.title':          { es: 'Cobra tus ganancias',  en: 'Collect your winnings' },
  'how.step3.desc':           { es: 'Si tu predicción es correcta, el contrato te paga automáticamente en MXNB. Sin intermediarios, sin esperas.',
                                en: 'If your prediction is right, the contract pays you automatically in MXNB. No middlemen, no waiting.' },
  'how.cta':                  { es: 'Crear cuenta gratis',  en: 'Create free account' },
  'how.quiz':                 { es: '¿Sabes cómo funcionan?', en: 'Think you know how they work?' },
  'how.quizLink':             { es: 'Haz un test',          en: 'Take a quiz' },

  // ── Portfolio ─────────────────────────────────────────────────────────────
  'pf.title':                 { es: 'Portafolio',           en: 'Portfolio' },
  'pf.subtitle':              { es: 'Tus posiciones activas en Polymarket y Pronos Protocol', en: 'Your active positions on Polymarket and Pronos Protocol' },
  'pf.connect':               { es: 'Conecta tu cuenta para ver tus posiciones',
                                en: 'Connect your account to see your positions' },
  'pf.connectBtn':            { es: 'Conectar',             en: 'Connect' },
  'pf.balanceMxnb':           { es: 'Balance MXNB',         en: 'MXNB Balance' },
  'pf.inPositions':           { es: 'En Posiciones',        en: 'In Positions' },
  'pf.activeMarkets':         { es: 'Mercados Activos',     en: 'Active Markets' },
  'pf.loading':               { es: 'Cargando posiciones…', en: 'Loading positions…' },
  'pf.error':                 { es: 'Error: {msg}',         en: 'Error: {msg}' },
  'pf.empty':                 { es: 'No tienes posiciones abiertas todavía.', en: 'You don\'t have any open positions yet.' },
  'pf.viewMarkets':           { es: 'Ver mercados',         en: 'View markets' },
  'pf.staked':                { es: 'APOSTADO',             en: 'STAKED' },
  'pf.pnl':                   { es: 'GANANCIA / PÉRDIDA',   en: 'PROFIT / LOSS' },
  'pf.shares':                { es: '{n} tokens',           en: '{n} shares' },
  'pf.currentValue':          { es: 'Valor actual: ${v} MXNB', en: 'Current value: ${v} MXNB' },
  'pf.exit':                  { es: 'Retirar ahora',        en: 'Exit now' },
  'pf.exitPreview':           { es: 'CONFIRMAR RETIRO',     en: 'CONFIRM EXIT' },
  'pf.exitEstimate':          { es: 'Recibes estimado',     en: 'Estimated receive' },
  'pf.exitSpot':              { es: 'Valor spot actual',    en: 'Current spot value' },
  'pf.exitFee':               { es: 'Fee de salida ({pct}%)', en: 'Exit fee ({pct}%)' },
  'pf.exitImpact':            { es: 'Impacto / slippage',   en: 'Impact / slippage' },
  'pf.exitAfterPrice':        { es: 'Precio después de salir', en: 'Price after exit' },
  'pf.exitWarning':           { es: 'El monto puede cambiar si otra operación entra antes de que tu transacción confirme.', en: 'The amount can still move if another trade lands before your transaction confirms.' },
  'pf.exitLoading':           { es: 'Calculando cuánto recibirías si sales ahora…', en: 'Calculating how much you would receive if you exit now…' },
  'pf.exitConfirm':           { es: 'Confirmar retiro',     en: 'Confirm exit' },
  'pf.exitPreviewError':      { es: 'No se pudo calcular el retiro en este momento.', en: 'Could not calculate the exit right now.' },
  'pf.exiting':               { es: 'Retirando…',           en: 'Exiting…' },
  'pf.switchingChain':        { es: 'Cambiando a la red del mercado…', en: 'Switching to the market network…' },
  'pf.protocolConfigMissing': { es: 'Falta configurar el token o pool de este mercado.', en: 'This market is missing token or pool configuration.' },
  'pf.exitSuccess':           { es: 'Posición retirada. Tx: {tx}', en: 'Position exited. Tx: {tx}' },
  'pf.exitError':             { es: 'No se pudo retirar: {msg}', en: 'Could not exit: {msg}' },

  // ── Funding ───────────────────────────────────────────────────────────────
  'fund.title':               { es: 'Depositar / retirar MXNB', en: 'Deposit / withdraw MXNB' },
  'fund.subtitle':            { es: 'Tu cuenta opera con una wallet Turnkey y MXNB en Arbitrum.',
                                en: 'Your account uses a Turnkey wallet and MXNB on Arbitrum.' },
  'fund.depositTitle':        { es: 'Depositar',             en: 'Deposit' },
  'fund.withdrawTitle':       { es: 'Retirar',               en: 'Withdraw' },
  'fund.wallet':              { es: 'Wallet Turnkey',        en: 'Turnkey wallet' },
  'fund.clabe':               { es: 'CLABE SPEI',            en: 'SPEI CLABE' },
  'fund.copy':                { es: 'Copiar',                en: 'Copy' },
  'fund.copied':              { es: 'Copiado',               en: 'Copied' },
  'fund.balance':             { es: 'Balance disponible',    en: 'Available balance' },
  'fund.pending':             { es: 'Pendiente',             en: 'Pending' },
  'fund.notConfigured':       { es: 'Integración Juno pendiente de credenciales.',
                                en: 'Juno integration is waiting for credentials.' },
  'fund.ready':               { es: 'Listo para recibir MXNB.',
                                en: 'Ready to receive MXNB.' },
  'fund.withdrawPending':     { es: 'Retiro por SPEI pendiente de activar con el proveedor.',
                                en: 'SPEI withdrawals are waiting for provider activation.' },
  'fund.login':               { es: 'Inicia sesión para ver tu wallet y depositar.',
                                en: 'Sign in to view your wallet and deposit.' },

  // ── PasswordGate ──────────────────────────────────────────────────────────
  'gate.badge':               { es: 'BETA · ACCESO ANTICIPADO', en: 'BETA · EARLY ACCESS' },
  'gate.title':               { es: 'Ingresa la contraseña para continuar', en: 'Enter the password to continue' },
  'gate.password':            { es: 'Contraseña',           en: 'Password' },
  'gate.wrong':               { es: 'Contraseña incorrecta', en: 'Incorrect password' },
  'gate.enter':               { es: 'Entrar',               en: 'Enter' },

  // ── UsernameModal ─────────────────────────────────────────────────────────
  'um.title':                 { es: 'Elige tu username',    en: 'Pick your username' },
  'um.subtitle1':             { es: 'Este será tu identidad en Pronos.', en: 'This will be your identity on Pronos.' },
  'um.subtitle2':             { es: 'No lo podrás cambiar después.', en: 'You won\'t be able to change it later.' },
  'um.placeholder':           { es: 'tu_username',          en: 'your_username' },
  'um.help':                  { es: '3–20 caracteres · letras, números y _', en: '3–20 chars · letters, numbers and _' },
  'um.taken':                 { es: 'Ese username ya está en uso', en: 'That username is already taken' },
  'um.error':                 { es: '{msg}',                en: '{msg}' },
  'um.saving':                { es: 'Guardando...',         en: 'Saving...' },
  'um.enter':                 { es: 'Entrar a Pronos →',    en: 'Enter Pronos →' },
  'um.generating':            { es: 'Generando...',         en: 'Generating...' },
  'um.skip':                  { es: 'Saltar — generar automáticamente', en: 'Skip — generate automatically' },

  // ── Home / generic ────────────────────────────────────────────────────────
  'home.banner':              { es: 'BETA — Mercados en vivo · MXNB en Arbitrum · Sin MetaMask',
                                en: 'BETA — Live markets · MXNB on Arbitrum · No MetaMask' },
  'home.markets':             { es: 'Mercados',             en: 'Markets' },
  'home.live':                { es: 'EN VIVO',              en: 'LIVE' },
  'home.subtitle':            { es: 'Predicciones en tiempo real con mercados on-chain en Arbitrum.',
                                en: 'Real-time predictions with on-chain markets on Arbitrum.' },

  // ── Leaderboard ───────────────────────────────────────────────────────────
  'lb.campaign':              { es: 'COMPETENCIA MXNP',     en: 'MXNP COMPETITION' },
  'lb.cycle':                 { es: 'CICLO 1',              en: 'CYCLE 1' },
  'lb.title':                 { es: 'MXNP POINTS',          en: 'MXNP POINTS' },
  'lb.prize':                 { es: 'Premio: $500 USD · Top 10 sorpresas', en: 'Prize: $500 USD · Top 10 surprises' },
  'lb.ends':                  { es: 'FIN DE CICLO',         en: 'CYCLE ENDS' },
  'lb.demo':                  { es: 'DATOS DE DEMOSTRACIÓN', en: 'DEMO DATA' },
  'lb.earn':                  { es: 'GANAR MXNP',           en: 'EARN MXNP' },

  // ── Points-app ────────────────────────────────────────────────────────────
  // Scoped under points.* so they don't collide with MVP keys. Reuses existing
  // nav.* / cat.* where the copy is identical (EN/ES toggle, search, category
  // emoji pills). First-pass coverage: nav + home categories + market card +
  // portfolio/admin/earn tab names. Longer prose stays Spanish-only for now.
  'points.nav.markets':       { es: 'El mercado',            en: 'Markets' },
  'points.nav.home':          { es: 'Inicio',                en: 'Home' },
  'points.nav.portfolio':     { es: 'Portafolio',            en: 'Portfolio' },
  'points.nav.tournament':    { es: 'Torneo Pronos',         en: 'Pronos Tournament' },
  'points.nav.earn':          { es: 'Gana MXNP',             en: 'Earn MXNP' },
  'points.nav.admin':         { es: 'Admin',                 en: 'Admin' },
  'points.nav.signIn':        { es: 'Iniciar sesión',        en: 'Sign in' },
  'points.nav.signOut':       { es: 'Cerrar sesión',         en: 'Sign out' },
  'points.nav.balance':       { es: 'Balance',               en: 'Balance' },
  'points.nav.search':        { es: 'Buscar mercado…',       en: 'Search market…' },
  'points.nav.theme':         { es: 'Cambiar tema',          en: 'Toggle theme' },
  'points.nav.lang':          { es: 'Idioma',                en: 'Language' },
  'points.nav.howItWorks':    { es: 'Cómo funciona',         en: 'How it works' },
  'points.nav.signUp':        { es: 'Únete',                 en: 'Log In' },

  // Hero + home copy
  'points.hero.badge':        { es: 'Beta · Competencia MXNP', en: 'Beta · MXNP competition' },
  'points.hero.headline.a':   { es: 'Predice, gana',         en: 'Predict, win' },
  'points.hero.headline.b':   { es: 'MXNP',                  en: 'MXNP' },
  'points.hero.headline.c':   { es: 'sigue el mercado',      en: 'follow the market' },
  'points.hero.sub':          { es: 'Compra acciones en eventos reales con MXNP — la moneda de Pronos. Los ciclos de premios están en pausa mientras abrimos la siguiente etapa.',
                                en: 'Buy shares on real events with MXNP — the Pronos currency. Prize cycles are paused while we open the next stage.' },
  'points.hero.cta.createAccount': { es: 'Crear cuenta gratis', en: 'Create free account' },
  'points.hero.cta.myPortfolio':  { es: 'Ver mi portafolio',   en: 'View my portfolio' },
  'points.hero.stats.welcomeBonus': { es: 'bono de bienvenida', en: 'welcome bonus' },
  'points.hero.stats.dailyClaim':   { es: 'reclamo diario + racha', en: 'daily claim + streak' },
  'points.hero.stats.activeMarkets':{ es: 'mercados activos',  en: 'active markets' },
  'points.hero.currentCycle': { es: 'CICLO ACTUAL · PREMIOS', en: 'CURRENT CYCLE · PRIZES' },
  'points.hero.comingSoon':   { es: 'PRÓXIMAMENTE',           en: 'COMING SOON' },
  'points.hero.top10Text':    { es: 'Top 10 del leaderboard cada quincena', en: 'Leaderboard top 10 every two weeks' },
  'points.hero.cyclesPausedTitle': { es: 'Ciclos de premios', en: 'Prize cycles' },
  'points.hero.cyclesPausedBody': { es: 'Próximamente. Por ahora puedes seguir explorando mercados, comprar acciones y probar estrategias con MXNP.',
                                    en: 'Coming soon. For now you can keep exploring markets, buying shares, and testing strategies with MXNP.' },
  'points.hero.closePending': { es: 'Cierre pendiente',      en: 'Closing soon' },
  'points.hero.surprisePrize':{ es: 'Premio sorpresa',        en: 'Surprise prize' },
  'points.hero.eligibility':  { es: 'Para calificar al premio debes participar en al menos {n} mercados durante el ciclo.',
                                en: 'To qualify for the prize you must participate in at least {n} markets during the cycle.' },
  'points.hero.rankBy':       { es: 'RANKING POR CARTERA',   en: 'RANKED BY PORTFOLIO' },
  'points.hero.cashPrizes':   { es: 'PREMIOS EN EFECTIVO',   en: 'CASH PRIZES' },

  'points.home.loadError':    { es: 'No pudimos cargar los mercados. Intenta otra vez.', en: 'Could not load markets. Try again.' },

  // Admin
  'points.admin.filter.all':       { es: 'Todos',          en: 'All' },
  'points.admin.filter.active':    { es: 'Activos',        en: 'Active' },
  'points.admin.filter.pending':   { es: 'Por resolver',   en: 'To resolve' },
  'points.admin.filter.resolved':  { es: 'Resueltos',      en: 'Resolved' },

  // How-it-works section on home
  'points.how.eyebrow':       { es: 'Simple · Rápido · Justo', en: 'Simple · Fast · Fair' },
  'points.how.title':         { es: 'Cómo funciona',         en: 'How it works' },
  'points.how.step1.t':       { es: 'Crea tu cuenta',         en: 'Create your account' },
  'points.how.step1.d':       { es: 'Email + código. Nada más. Recibes 500 MXNP de bienvenida.', en: 'Email + code. Nothing more. Get 500 MXNP as a welcome bonus.' },
  'points.how.step2.t':       { es: 'Predice eventos',        en: 'Predict events' },
  'points.how.step2.d':       { es: 'Compra acciones en mercados de deportes, política, crypto y más. Los precios se mueven con la demanda.', en: 'Buy shares on sports, politics, crypto and more. Prices move with demand.' },
  'points.how.step3.t':       { es: 'Mejora tu cartera',      en: 'Grow your portfolio' },
  'points.how.step3.d':       { es: 'Acumula MXNP acertando predicciones. Los ciclos de premios vuelven pronto.', en: 'Stack MXNP by getting predictions right. Prize cycles return soon.' },

  // Partners section
  'points.partners.eyebrow':  { es: 'Construido con',        en: 'Built with' },
  'points.partners.title':    { es: 'Partners',              en: 'Partners' },
  'points.partners.turnkey.role':     { es: 'Wallet & auth infra',  en: 'Wallet & auth infra' },
  'points.partners.turnkey.desc':     { es: 'Custodia segura y auth con email.', en: 'Secure custody and email-based auth.' },
  'points.partners.bitso.role':       { es: 'Exchange · LATAM',     en: 'Exchange · LATAM' },
  'points.partners.bitso.desc':       { es: 'Rampa de entrada y salida en pesos.', en: 'On/off-ramp in Mexican pesos.' },
  'points.partners.mxnb.role':        { es: 'Stablecoin peso',      en: 'Peso stablecoin' },
  'points.partners.mxnb.desc':        { es: 'Peso mexicano pegged on-chain.', en: 'Mexican peso pegged on-chain.' },
  'points.partners.chainlink.role':   { es: 'Oráculos & precios',   en: 'Oracles & pricing' },
  'points.partners.chainlink.desc':   { es: 'Feeds de precios y datos verificados para resolución de mercados.', en: 'Verified price feeds and data for market resolution.' },

  // Market detail
  'points.detail.resolvedBadge':   { es: '· RESUELTO',        en: '· RESOLVED' },
  'points.detail.pendingBadge':    { es: '· PENDIENTE',      en: '· PENDING' },
  'points.detail.resultOfficial': { es: 'RESULTADO OFICIAL',  en: 'OFFICIAL RESULT' },
  'points.detail.redeemInstructions': { es: 'Los ganadores pueden reclamar 1 MXNP por cada acción.', en: 'Winners can claim 1 MXNP per share.' },
  'points.detail.probNow':         { es: 'PROBABILIDAD ACTUAL · SÍ', en: 'CURRENT PROBABILITY · YES' },
  'points.detail.probExplain':     { es: 'La probabilidad se ajusta con cada trade. Compra más barato cuando hay desacuerdo, más caro cuando hay consenso.', en: 'Probability adjusts on every trade. Cheaper when there\'s disagreement, more expensive when there\'s consensus.' },
  'points.liveScore.title':        { es: 'MARCADOR EN VIVO',  en: 'LIVE SCORE' },
  'points.liveScore.live':         { es: 'En vivo',           en: 'Live' },
  'points.detail.priceHistory':    { es: 'HISTORIAL DE PRECIO', en: 'PRICE HISTORY' },
  'points.detail.priceRealtime':   { es: 'PRECIO EN TIEMPO REAL', en: 'REAL-TIME PRICE' },
  'points.detail.last30d':         { es: 'ÚLT. 30 DÍAS',       en: 'LAST 30 DAYS' },
  'points.detail.chartRange':      { es: 'Rango del gráfico',   en: 'Chart range' },
  'points.detail.range4h':         { es: '4H',                  en: '4H' },
  'points.detail.range24h':        { es: '24H',                 en: '24H' },
  'points.detail.range7d':         { es: '7D',                  en: '7D' },
  'points.detail.range30d':        { es: '30D',                 en: '30D' },
  'points.detail.activityEmpty':   { es: 'Sin trades en este rango', en: 'No trades in this range' },
  'points.detail.activityRange':   { es: 'Actividad {range}',   en: '{range} activity' },
  'points.detail.activityTrades':  { es: '{n} operaciones',     en: '{n} trades' },
  'points.detail.activityVolume':  { es: 'Volumen',             en: 'Volume' },
  'points.detail.activityVolumeRange': { es: 'Volumen {range}', en: '{range} volume' },
  'points.detail.activityPressure': { es: 'Presión',            en: 'Pressure' },
  'points.detail.activityLast':    { es: 'Último movimiento',   en: 'Last movement' },
  'points.detail.activityNeutral': { es: 'Neutral',             en: 'Neutral' },
  'points.detail.activityBalanced': { es: 'Balanceado',         en: 'Balanced' },
  'points.detail.activityBuyPressure': { es: '{n}% compra',     en: '{n}% buy' },
  'points.detail.activitySellPressure': { es: '{n}% venta',     en: '{n}% sell' },
  'points.detail.activityNoTrades': { es: 'Sin trades',         en: 'No trades' },
  'points.detail.activityNow':     { es: 'Ahora',               en: 'Now' },
  'points.detail.activityMinutesAgo': { es: 'Hace {n} min',     en: '{n}m ago' },
  'points.detail.activityHoursAgo': { es: 'Hace {n} h',         en: '{n}h ago' },
  'points.detail.activityDaysAgo': { es: 'Hace {n} d',          en: '{n}d ago' },
  'points.detail.topOnly':         { es: 'Mostrando líderes y eliminados de {n} opciones', en: 'Showing leaders and eliminated outcomes from {n}' },
  'points.detail.closesLabel':     { es: 'CIERRA',             en: 'CLOSES' },
  'points.detail.closedLabel':     { es: 'CERRÓ',              en: 'CLOSED' },
  'points.detail.volumeLabel':     { es: 'VOLUMEN',            en: 'VOLUME' },
  'points.detail.stateLabel':      { es: 'ESTADO',             en: 'STATE' },
  'points.detail.stateResolved':   { es: 'RESUELTO',           en: 'RESOLVED' },
  'points.detail.statePending':    { es: 'PENDIENTE',          en: 'PENDING' },
  'points.detail.stateActive':     { es: 'ACTIVO',             en: 'ACTIVE' },
  'points.detail.resolverLabel':   { es: 'RESUELTO POR',       en: 'RESOLVED BY' },
  'points.detail.resolverAdmin':   { es: 'Admin',              en: 'Admin' },
  'points.detail.marketNotFound':  { es: 'Mercado no encontrado', en: 'Market not found' },
  'points.detail.back':            { es: '← Volver',            en: '← Back' },
  'points.detail.closedHint':      { es: 'Este mercado ya cerró. Los ganadores pueden reclamar su pago en el portafolio.', en: 'This market is closed. Winners can claim their payout in the portfolio.' },
  'points.detail.pendingHint':     { es: 'Las inversiones están cerradas. El resultado se publicará pronto.', en: 'Trading is closed. The outcome will be published soon.' },
  'points.detail.shares':          { es: '{n} acciones',       en: '{n} shares' },
  'points.detail.valueLabel':      { es: 'Valor',              en: 'Value' },
  'points.detail.buyMore':         { es: 'Comprar más',        en: 'Buy more' },
  'points.detail.sell':            { es: 'Vender',             en: 'Sell' },
  'points.detail.claim':           { es: 'Reclamar',           en: 'Claim' },
  'points.detail.claiming':         { es: 'Reclamando...',      en: 'Claiming...' },
  'points.detail.claimSuccess':     { es: 'Reclamaste {n} MXNP', en: 'Claimed {n} MXNP' },
  'points.detail.mxnpNote':        { es: 'MXNP son puntos de la competencia.', en: 'MXNP are competition points.' },
  'points.detail.temperatureResolutionTitle': { es: 'Cómo se resuelve', en: 'How it resolves' },
  'points.detail.temperatureResolutionBody': { es: 'Usamos la temperatura máxima oficial con un decimal y la redondeamos al grado Celsius entero más cercano. Ejemplo: 25.6°C gana 26°C; 24.4°C gana ≤24°C; 26.5°C o más gana ≥27°C.', en: 'We use the official maximum temperature with one decimal and round it to the nearest whole Celsius degree. Example: 25.6°C wins 26°C; 24.4°C wins ≤24°C; 26.5°C or higher wins ≥27°C.' },
  'points.detail.orderBook':       { es: 'Libro de órdenes',    en: 'Order book' },
  'points.detail.orderBookHint':   { es: 'Órdenes de usuarios con profundidad maker simulada de Pronos.', en: 'User orders with simulated Pronos maker depth.' },
  'points.detail.orderBookSpread': { es: 'Spread',             en: 'Spread' },
  'points.detail.orderBookPrice':  { es: 'Precio',             en: 'Price' },
  'points.detail.orderBookShares': { es: 'Acciones',           en: 'Shares' },
  'points.detail.orderBookTotal':  { es: 'Total',              en: 'Total' },
  'points.detail.orderBookSellSide': { es: 'Ventas',           en: 'Asks' },
  'points.detail.orderBookBuySide': { es: 'Compras',           en: 'Bids' },
  'points.detail.orderBookLast':   { es: 'Último',             en: 'Last' },
  'points.detail.orderBookNow':    { es: 'Actual',             en: 'Now' },
  'points.detail.orderBookLoading': { es: 'Cargando profundidad…', en: 'Loading depth…' },
  'points.detail.orderBookEmpty':  { es: 'Sin liquidez suficiente en este lado.', en: 'Not enough liquidity on this side.' },
  'points.detail.orderBookUnavailable': { es: 'La profundidad se muestra solo cuando el mercado está abierto.', en: 'Depth is shown only while the market is open.' },
  'points.detail.orderBookFailed': { es: 'No se pudo cargar la profundidad.', en: 'Could not load depth.' },
  'points.detail.orderBookSourceUsers': { es: 'Usuarios',       en: 'Users' },
  'points.detail.orderBookSourceMaker': { es: 'Pronos',         en: 'Pronos' },
  'points.detail.orderBookSourceAmm': { es: 'AMM',              en: 'AMM' },
  'points.detail.limitOrderTitle': { es: 'Orden límite',        en: 'Limit order' },
  'points.detail.limitOrderBuy':   { es: 'Entrada',             en: 'Entry' },
  'points.detail.limitOrderSell':  { es: 'Salida',              en: 'Exit' },
  'points.detail.limitOrderPrice': { es: 'Precio límite',       en: 'Limit price' },
  'points.detail.limitOrderAmountBuy': { es: 'MXNP a reservar', en: 'MXNP to reserve' },
  'points.detail.limitOrderAmountSell': { es: 'Acciones a vender', en: 'Shares to sell' },
  'points.detail.limitOrderCreate': { es: 'Crear orden',        en: 'Create order' },
  'points.detail.limitOrderCreating': { es: 'Creando…',         en: 'Creating…' },
  'points.detail.limitOrderLogin': { es: 'Inicia sesión para crear órdenes límite.', en: 'Sign in to create limit orders.' },
  'points.detail.limitOrderHintBuy': { es: 'Reserva MXNP y entra automáticamente si el precio baja hasta tu límite.', en: 'Reserve MXNP and enter automatically if the price falls to your limit.' },
  'points.detail.limitOrderHintSell': { es: 'Reserva acciones y sale automáticamente si el precio sube hasta tu límite.', en: 'Reserve shares and exit automatically if the price rises to your limit.' },
  'points.detail.limitOrderMakerReward': { es: 'Las órdenes cercanas al precio actual pueden acumular recompensa maker limitada.', en: 'Orders near the current price can accrue a capped maker reward.' },
  'points.detail.limitOrderRewardEarned': { es: 'Recompensa maker', en: 'Maker reward' },
  'points.detail.limitOrderSuccess': { es: 'Orden abierta.',    en: 'Order opened.' },
  'points.detail.limitOrderFilled': { es: 'Orden ejecutada.',   en: 'Order filled.' },
  'points.detail.limitOrderOpenOrders': { es: 'Tus órdenes abiertas', en: 'Your open orders' },
  'points.detail.limitOrderNoOpenOrders': { es: 'Sin órdenes abiertas para este resultado.', en: 'No open orders for this outcome.' },
  'points.detail.limitOrderCancel': { es: 'Cancelar',           en: 'Cancel' },
  'points.detail.limitOrderCancelling': { es: 'Cancelando…',    en: 'Cancelling…' },
  'points.detail.limitOrderCancelled': { es: 'Orden cancelada.', en: 'Order cancelled.' },

  // Comments
  'points.comments.title':         { es: 'Comentarios',         en: 'Comments' },
  'points.comments.one':           { es: '{n} mensaje',         en: '{n} message' },
  'points.comments.many':          { es: '{n} mensajes',        en: '{n} messages' },
  'points.comments.placeholderAuth': { es: 'Comparte tu análisis o pregunta…', en: 'Share your analysis or question…' },
  'points.comments.placeholderAnon': { es: 'Inicia sesión para comentar.', en: 'Sign in to comment.' },
  'points.comments.login':         { es: 'Iniciar sesión',      en: 'Sign in' },
  'points.comments.post':          { es: 'Publicar',            en: 'Post' },
  'points.comments.posting':       { es: 'Publicando…',         en: 'Posting…' },
  'points.comments.empty':         { es: 'Aún no hay comentarios. Sé el primero.', en: 'No comments yet. Be the first.' },
  'points.comments.loading':       { es: 'Cargando comentarios…', en: 'Loading comments…' },
  'points.comments.delete':        { es: 'eliminar',            en: 'delete' },
  'points.comments.confirmDelete': { es: '¿Eliminar este comentario?', en: 'Delete this comment?' },
  'points.comments.deleteFail':    { es: 'No se pudo eliminar: {err}', en: 'Could not delete: {err}' },

  // Top holders
  'points.top.title':              { es: 'Top holders',         en: 'Top holders' },
  'points.top.loading':            { es: 'Cargando…',           en: 'Loading…' },

  // Category labels: kept free of decorative symbols so the points app
  // matches the MVP's clean text-only treatment.
  'points.cat.noticias':      { es: 'Noticias',               en: 'News' },
  'points.cat.trending':      { es: 'Trending',               en: 'Trending' },
  'points.cat.worldCup':      { es: 'Nuevos mercados',        en: 'New markets' },
  'points.cat.deportes':      { es: 'Deportes',               en: 'Sports' },
  'points.cat.musica':        { es: 'Entretenimiento',        en: 'Entertainment' },
  'points.cat.mexico':        { es: 'Mexico & Latam',         en: 'Mexico & Latam' },
  'points.cat.politica':      { es: 'Política Intl.',         en: 'World Politics' },
  'points.cat.crypto':        { es: 'Crypto',                 en: 'Crypto' },
  'points.cat.finanzas':      { es: 'Finanzas',               en: 'Finance' },
  'points.cat.porresolver':   { es: 'Por resolver',           en: 'To resolve' },
  'points.cat.resueltos':     { es: 'Resueltos',              en: 'Resolved' },

  // Category page (per-type header + sub-filters)
  'points.catpage.eyebrow':   { es: '{n} mercados',           en: '{n} markets' },
  'points.catpage.leagues':   { es: 'Ligas',                  en: 'Leagues' },

  // Region + topic sub-filters — shared by public category pages.
  'points.geo.all':           { es: 'Todos',                  en: 'All' },
  'points.geo.mexico':        { es: 'México',                 en: 'Mexico' },
  'points.geo.latam':         { es: 'Latam',                  en: 'Latam' },
  'points.geo.world':         { es: 'Mundo',                  en: 'World' },
  'points.topic.all':         { es: 'Todas',                  en: 'All' },
  'points.topic.general':     { es: 'General',                en: 'General' },
  'points.topic.politica':    { es: 'Política',               en: 'Politics' },
  'points.topic.deportes':    { es: 'Deportes',               en: 'Sports' },
  'points.topic.finanzas':    { es: 'Finanzas',               en: 'Finance' },
  'points.topic.musica':      { es: 'Música',                 en: 'Music' },
  'points.topic.cine':        { es: 'Cine',                   en: 'Film' },
  'points.topic.tv':          { es: 'TV',                     en: 'TV' },
  'points.topic.farandula':   { es: 'Farándula',              en: 'Pop Culture' },
  'points.topic.weather':     { es: 'Clima',                  en: 'Weather' },

  // Sports sub-filter — /c/deportes
  'points.sport.all':         { es: 'Todos',                  en: 'All' },
  'points.sport.soccer':      { es: 'Fútbol',                en: 'Soccer' },
  'points.sport.baseball':    { es: 'Béisbol',               en: 'Baseball' },
  'points.sport.nba':         { es: 'NBA',                    en: 'NBA' },
  'points.sport.nfl':         { es: 'NFL',                    en: 'NFL' },
  'points.sport.f1':          { es: 'F1',                     en: 'F1' },
  'points.sport.tennis':      { es: 'Tenis',                 en: 'Tennis' },
  'points.sport.golf':        { es: 'Golf',                  en: 'Golf' },
  'points.sport.combate':     { es: 'Combate',               en: 'Fighting' },

  // Soccer / Baseball / Combate leagues sidebar
  'points.league.all':        { es: 'Todas',                  en: 'All' },
  'points.league.ufc':        { es: 'UFC',                    en: 'UFC' },
  'points.league.boxing':     { es: 'Boxeo',                  en: 'Boxing' },
  'points.league.uefaCl':     { es: 'UEFA Champions League',  en: 'UEFA Champions League' },
  'points.league.libertadores': { es: 'Copa Libertadores',     en: 'Copa Libertadores' },
  'points.league.europa':     { es: 'UEFA Europa League',     en: 'UEFA Europa League' },
  'points.league.conference': { es: 'UEFA Conference League', en: 'UEFA Conference League' },
  'points.league.laLiga':     { es: 'La Liga',                en: 'La Liga' },
  'points.league.premier':    { es: 'Premier League',         en: 'Premier League' },
  'points.league.serieA':     { es: 'Serie A',                en: 'Serie A' },
  'points.league.bundesliga': { es: 'Bundesliga',             en: 'Bundesliga' },
  'points.league.ligaMx':     { es: 'Liga MX',                en: 'Liga MX' },
  'points.league.mls':        { es: 'MLS',                    en: 'MLS' },
  'points.league.leaguesCup': { es: 'Leagues Cup',            en: 'Leagues Cup' },
  'points.league.international': { es: 'Internacional',        en: 'International' },
  'points.league.clubFriendlies': { es: 'Amistosos de clubes', en: 'Club Friendlies' },
  'points.league.mlb':        { es: 'MLB',                    en: 'MLB' },
  'points.league.lmb':        { es: 'LMB',                    en: 'LMB' },
  'points.league.lmp':        { es: 'LMP',                    en: 'LMP' },

  'points.card.resolved':     { es: 'RESUELTO',              en: 'RESOLVED' },
  'points.card.pending':      { es: 'PENDIENTE',             en: 'PENDING' },
  'points.card.live':         { es: 'EN VIVO',               en: 'LIVE' },
  'points.card.yourPos':      { es: 'Tu posición',           en: 'Your position' },
  'points.card.moreOptions':  { es: '+ {n} opciones más',    en: '+ {n} more options' },
  'points.card.ifYouWin':     { es: 'si ganas',              en: 'if you win' },

  'points.activity.eyebrow':  { es: 'Mercados calientes',    en: 'Hot markets' },
  'points.activity.title':    { es: 'De qué está hablando México', en: 'What Mexico is talking about' },
  'points.activity.rank':     { es: 'más activo',            en: 'most active' },
  'points.activity.moving':   { es: 'en movimiento',         en: 'on the move' },
  'points.activity.slot1h':   { es: 'volumen 1H',            en: '1H volume' },
  'points.activity.slot4h':   { es: 'volumen 4H',            en: '4H volume' },
  'points.activity.slotTotal': { es: 'volumen total',         en: 'total volume' },
  'points.activity.slot24h':  { es: 'volumen 24H',           en: '24H volume' },
  'points.activity.slotBtc':  { es: 'Bitcoin rápido',        en: 'Bitcoin rapid' },
  'points.activity.totalShort': { es: 'Total',                en: 'Total' },
  'points.activity.volumeShort': { es: 'Vol',                 en: 'Vol' },
  'points.intro.browse':      { es: 'Ver mercados',          en: 'Browse markets' },
  'points.intro.dismiss':     { es: 'Cerrar',                en: 'Close' },
  'points.activity.noBuys':   { es: 'Sin compras todavía',   en: 'No buys yet' },
  'points.activity.noBuysSub': { es: 'Precio en vivo, sin operaciones de usuarios.', en: 'Live price, no user trades.' },
  'points.activity.noRecent': { es: 'Sin flujo reciente',     en: 'No recent flow' },
  'points.activity.noRecentSub': { es: 'Mercado con volumen histórico, sin operaciones en esta ventana.', en: 'High-volume market, no trades in this window.' },
  'points.activity.flow':     { es: 'Flujo en vivo',         en: 'Live flow' },
  'points.activity.flowTotal': { es: 'Flujo total',           en: 'Total flow' },
  'points.activity.tied':     { es: 'Empatado',              en: 'Tied' },
  'points.activity.txs':      { es: 'transacciones',         en: 'transactions' },
  'points.activity.buys':     { es: 'Compras',               en: 'Buys' },
  'points.activity.sells':    { es: 'Ventas',                en: 'Sells' },
  'points.activity.noHistory': { es: 'Sin actividad todavía', en: 'No activity yet' },
  'points.activity.noHistorySub': { es: 'El precio se moverá con el primer trade.', en: 'The price moves with the first trade.' },
  'points.activity.open':     { es: 'Ver mercado',           en: 'Open market' },
  'points.activity.prev':     { es: 'Mercado anterior',      en: 'Previous market' },
  'points.activity.next':     { es: 'Mercado siguiente',     en: 'Next market' },
  'points.activity.goTo':     { es: 'Ir al mercado',         en: 'Go to market' },

  'points.home.empty':        { es: 'No hay mercados en esta categoría.', en: 'No markets in this category.' },
  'points.home.emptySearch':  { es: 'No hay resultados para "{q}".', en: 'No results for "{q}".' },
  'points.home.emptyPending': { es: 'No hay mercados por resolver.', en: 'No markets to resolve.' },
  'points.home.loading':      { es: 'Cargando mercados…',    en: 'Loading markets…' },

  'points.detail.loading':    { es: 'Cargando mercado…',     en: 'Loading market…' },
  'points.detail.backToMarkets': { es: '← MERCADOS',          en: '← MARKETS' },
  'points.detail.chooseOutcome': { es: 'Elige un resultado',  en: 'Pick an outcome' },
  'points.detail.oddsNow':    { es: 'Odds actuales',         en: 'Current odds' },
  'points.detail.marketClosed': { es: 'Mercado cerrado',      en: 'Market closed' },
  'points.detail.awaitingResult': { es: 'Esperando resolución', en: 'Awaiting resolution' },
  'points.detail.yourPos':    { es: 'Tu posición',           en: 'Your position' },
  'points.detail.topHolders': { es: 'Top holders',           en: 'Top holders' },
  'points.detail.comments':   { es: 'Comentarios',           en: 'Comments' },
  'points.detail.optionsVote': { es: 'Opciones · elige Sí o No', en: 'Options · pick Yes or No' },
  'points.series.label':      { es: 'Serie',                 en: 'Series' },
  'points.series.open':       { es: 'Abierto',               en: 'Open' },
  'points.series.final':      { es: 'Final',                 en: 'Final' },
  'points.series.pending':    { es: 'Pendiente',             en: 'Pending' },
  'points.series.notNeeded':  { es: 'No necesario',          en: 'Not needed' },
  'points.series.datePending': { es: 'Fecha pendiente',      en: 'Date pending' },
  'points.series.game':       { es: 'Juego {num}',           en: 'Game {num}' },
  'points.series.tied':       { es: 'Serie empatada {score}', en: 'Series tied {score}' },
  'points.series.leads':      { es: '{team} lidera {score}', en: '{team} leads {score}' },

  'points.crypto.title':      { es: '{asset}: sube o baja en {duration}', en: '{asset}: up or down in {duration}' },
  'points.crypto.currentPrice': { es: 'Precio actual',        en: 'Current price' },
  'points.crypto.threshold':  { es: 'Umbral',                 en: 'Threshold' },
  'points.crypto.atOpen':     { es: 'al abrir',               en: 'at open' },
  'points.crypto.thresholdNote': { es: 'redondeado al $1 · sin empate', en: 'rounded to $1 · no tie' },
  'points.crypto.opensIn':    { es: 'Abre en',                en: 'Opens in' },
  'points.crypto.closedAt':   { es: 'Cerró',                  en: 'Closed' },
  'points.crypto.closesIn':   { es: 'Cierra en',              en: 'Closes in' },
  'points.crypto.resolved':   { es: 'Resuelto',               en: 'Resolved' },
  'points.crypto.pendingHint': { es: 'En espera del mercado anterior. El umbral se publica al abrir, justo cuando cierre la ventana anterior.', en: 'Awaiting previous market. The threshold is published when this window opens, exactly as the previous one closes.' },
  'points.crypto.up':         { es: 'SUBE',                   en: 'UP' },
  'points.crypto.down':       { es: 'BAJA',                   en: 'DOWN' },
  'points.crypto.perShare':   { es: 'por acción',             en: 'per share' },
  'points.crypto.position':   { es: 'Tu posición',            en: 'Your position' },
  'points.crypto.shares':     { es: 'acciones',               en: 'shares' },
  'points.crypto.outcome':    { es: 'Resultado',              en: 'Outcome' },
  'points.crypto.switch':     { es: 'Cambiar',                en: 'Switch' },
  'points.crypto.durationShort': { es: '5 min',               en: '5 min' },
  'points.crypto.kicker.past': { es: 'Cerrado',               en: 'Past' },
  'points.crypto.kicker.awaiting': { es: 'En espera',         en: 'Awaiting' },
  'points.crypto.kicker.live': { es: 'En vivo',               en: 'Live' },
  'points.crypto.ws.liveCoinbase': { es: '● en vivo · Coinbase', en: '● live · Coinbase' },
  'points.crypto.ws.connecting': { es: 'conectando…',         en: 'connecting…' },
  'points.crypto.ws.offline': { es: 'sin conexión',           en: 'offline' },

  'points.buy.title':         { es: 'Comprar',                en: 'Buy' },
  'points.buy.balance':       { es: 'Balance',                en: 'Balance' },
  'points.buy.amountLabel':   { es: 'Monto (MXNP)',           en: 'Amount (MXNP)' },
  'points.buy.minimumEntryHint': { es: 'Mínimo {amount} MXNP para cubrir este mercado en el torneo.', en: 'Minimum {amount} MXNP to cover this market in the tournament.' },
  'points.buy.topUpHint': { es: 'Ya cubriste este mercado. Puedes añadir menos de 100 MXNP.', en: 'You already covered this market. You can add less than 100 MXNP.' },
  'points.buy.minimumEntryButton': { es: 'Mínimo {amount} MXNP', en: 'Minimum {amount} MXNP' },
  'points.buy.fee':           { es: 'Comisión',               en: 'Fee' },
  'points.buy.receivedShares': { es: 'Acciones que recibes',  en: 'Shares you receive' },
  'points.buy.winProfit':     { es: 'Ganancia si aciertas',   en: 'Profit if correct' },
  'points.buy.priceAfter':    { es: 'Precio tras la compra',  en: 'Price after purchase' },
  'points.buy.calculating':   { es: 'Calculando…',            en: 'Calculating…' },
  'points.buy.quoteError':    { es: 'No se pudo calcular el precio. Intenta otra vez.', en: 'Could not calculate the price. Try again.' },
  'points.buy.insufficientBalance': { es: 'Balance insuficiente', en: 'Insufficient balance' },
  'points.buy.insufficientBalanceDetail': { es: 'Balance insuficiente. Tienes {amount} MXNP.', en: 'Insufficient balance. You have {amount} MXNP.' },
  'points.buy.success':       { es: 'Compra realizada',       en: 'Purchase complete' },
  'points.buy.submitting':    { es: 'Enviando…',              en: 'Submitting…' },
  'points.buy.errorGeneric':  { es: 'Algo salió mal.',        en: 'Something went wrong.' },
  'points.buy.errorInsufficient': { es: 'Balance insuficiente.', en: 'Insufficient balance.' },
  'points.buy.errorNotAuth':  { es: 'Tu sesión expiró. Vuelve a iniciar sesión.', en: 'Your session expired. Please sign in again.' },
  'points.buy.errorMarketClosed': { es: 'El mercado cerró o se resolvió.', en: 'The market closed or resolved.' },
  'points.buy.errorMarketNotFound': { es: 'Mercado no encontrado.', en: 'Market not found.' },
  'points.buy.errorTournamentMin': { es: 'El mínimo para cubrir un mercado durante el torneo es {amount} MXNP.', en: 'The minimum to cover a market during the tournament is {amount} MXNP.' },
  'points.buy.errorPrefix':   { es: 'No pudimos completar la operación. Intenta otra vez.', en: 'Could not complete the action. Try again.' },

  'points.portfolio.title':   { es: 'Portafolio',            en: 'Portfolio' },
  'points.portfolio.tab.open': { es: 'Activo',               en: 'Active' },
  'points.portfolio.tab.history': { es: 'Historial',         en: 'History' },
  'points.portfolio.tab.rewards': { es: 'Recompensas',       en: 'Rewards' },
  'points.portfolio.tab.claim': { es: 'Reclamar',            en: 'Claim' },
  'points.portfolio.rewards.empty': { es: 'Todavía no tienes recompensas por liquidez.', en: 'You do not have liquidity rewards yet.' },
  'points.portfolio.rewards.today': { es: 'Pagado hoy',      en: 'Paid today' },
  'points.portfolio.rewards.total': { es: 'Total pagado',    en: 'Total paid' },
  'points.portfolio.rewards.markets': { es: 'Mercados',      en: 'Markets' },
  'points.portfolio.rewards.payouts': { es: 'Pagos',         en: 'Payouts' },
  'points.portfolio.rewards.reason': { es: 'Recompensa por liquidez', en: 'Liquidity reward' },

  'points.earn.title':        { es: 'Gana MXNP',             en: 'Earn MXNP' },
  'points.earn.install.eyebrow': { es: 'App en pantalla de inicio', en: 'Home screen app' },
  'points.earn.install.title': { es: 'Instala Pronos y reclama 50 MXNP', en: 'Install Pronos and claim 50 MXNP' },
  'points.earn.install.body': { es: 'Agrega Pronos a la pantalla de inicio para entrar más rápido y mantener tu racha.', en: 'Add Pronos to your home screen for faster access and streak retention.' },
  'points.earn.install.ios': { es: 'En Safari, toca Compartir y luego Agregar a pantalla de inicio. Abre Pronos desde ese icono para reclamar.', en: 'In Safari, tap Share, then Add to Home Screen. Open Pronos from that icon to claim.' },
  'points.earn.install.android': { es: 'En Chrome, instala Pronos desde el aviso o desde el menú. Abre Pronos desde ese icono para reclamar.', en: 'In Chrome, install Pronos from the prompt or menu. Open Pronos from that icon to claim.' },
  'points.earn.install.ready': { es: 'Ya estás en la app instalada. Reclama tu bono una sola vez.', en: 'You are in the installed app. Claim your one-time bonus.' },
  'points.earn.install.claim': { es: 'Reclamar 50 MXNP', en: 'Claim 50 MXNP' },
  'points.earn.install.installButton': { es: 'Instalar Pronos', en: 'Install Pronos' },
  'points.earn.install.claimed': { es: 'Bono reclamado', en: 'Bonus claimed' },
  'points.earn.install.openFromHome': { es: 'Abre Pronos desde el icono de tu pantalla de inicio para activar el reclamo.', en: 'Open Pronos from your home screen icon to activate the claim.' },

  'points.status.won':        { es: 'GANADO',                en: 'WON' },
  'points.status.lost':       { es: 'PERDIDO',               en: 'LOST' },
  'points.status.exited':     { es: 'SALIDO',                en: 'EXITED' },
  'points.status.open':       { es: 'ABIERTA',               en: 'OPEN' },
  'points.status.pending':    { es: 'PENDIENTE',             en: 'PENDING' },
};
