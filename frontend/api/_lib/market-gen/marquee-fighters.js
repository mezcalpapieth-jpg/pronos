/**
 * Marquee fighter allowlist for the UFC generator (and the future
 * boxing generator). The UFC generator auto-creates a market for
 * every fight where at least one participant is on this list — even
 * if the bout is buried on a prelim card — because these names alone
 * drive trading interest from the LATAM audience.
 *
 * Mexican / LATAM fighters are also auto-included via flag.alt match
 * inside the generator; we only need to list them here when the
 * audience cares about them regardless of nationality (or when their
 * ESPN flag is something other than Mexico — Topuria flies Spanish/
 * Georgian flag, etc.).
 *
 * Name match is normalize-and-compare (lowercase, diacritics stripped)
 * so "Yair Rodríguez", "Yair Rodriguez", "YAIR RODRIGUEZ" all match.
 *
 * To add a fighter: append the display name as it appears on ESPN.
 * No restart required — file is loaded on each cron invocation.
 */

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

const UFC_MARQUEE = [
  // Mexican (always include)
  'Brandon Moreno',
  'Yair Rodríguez',
  'Diego Lopes',
  'Alexa Grasso',
  'Irene Aldana',
  'Manuel Torres',
  'Raul Rosas Jr.',

  // LATAM (auto-included beyond just Mexican)
  'Charles Oliveira',
  'Alex Pereira',
  'Deiveson Figueiredo',
  'Caio Borralho',
  'Renato Moicano',
  'Mauricio Ruffy',
  'Carlos Ulberg',
  'Santiago Ponzinibbio',
  'Jonathan Martinez',
  'Vicente Luque',
  'Gilbert Burns',
  'Glover Teixeira',
  'José Aldo',

  // Spanish-speaking audience draw (Spain/Georgia flag)
  'Ilia Topuria',

  // Global stars — names alone create trading interest
  'Jon Jones',
  'Islam Makhachev',
  'Alexander Volkanovski',
  'Sean O\'Malley',
  'Sean Strickland',
  'Dricus Du Plessis',
  'Khamzat Chimaev',
  'Conor McGregor',
  'Israel Adesanya',
  'Alexandre Pantoja',
  'Tom Aspinall',
  'Magomed Ankalaev',
  'Robert Whittaker',
  'Max Holloway',
  'Justin Gaethje',
  'Dustin Poirier',
  'Michael Chandler',
  'Paddy Pimblett',
  'Belal Muhammad',
  'Leon Edwards',
  'Kamaru Usman',
  'Stipe Miocic',
  'Ciryl Gane',
  'Aljamain Sterling',
  'Petr Yan',
  'Merab Dvalishvili',
  'Movsar Evloev',
  'Joaquin Buckley',
  'Bo Nickal',
];

const UFC_MARQUEE_NORM = new Set(UFC_MARQUEE.map(normalize));

export function isMarqueeUfcFighter(displayName) {
  return UFC_MARQUEE_NORM.has(normalize(displayName));
}

// Country codes that count as LATAM-audience auto-include.
// ESPN's flag.alt uses English country names.
const LATAM_FLAGS_NORM = new Set([
  'mexico',
  'argentina',
  'brazil',
  'chile',
  'colombia',
  'peru',
  'ecuador',
  'venezuela',
  'uruguay',
  'paraguay',
  'bolivia',
  'panama',
  'costa rica',
  'dominican republic',
  'puerto rico',
  'cuba',
  'guatemala',
  'honduras',
  'el salvador',
  'nicaragua',
  // Spain — Spanish-speaking audience matters
  'spain',
]);

export function isLatamFighter(flagAlt) {
  return LATAM_FLAGS_NORM.has(normalize(flagAlt));
}

export function isMexicanFighter(flagAlt) {
  return normalize(flagAlt) === 'mexico';
}

export const _marqueeList = UFC_MARQUEE; // export for tests/debug
