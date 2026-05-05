import { fetchHomepageScrape, getScraperConfig } from './news-scraper.js';

/**
 * Mexican news aggregator — Google News RSS backend, per-outlet queries.
 *
 * Three iterations of evolution informed this design:
 *
 *  v1 — direct outlet RSS. Broke fast: 7 of 9 outlets dropped their
 *       public feeds or started 404/403'ing on bot User-Agents.
 *
 *  v2 — Google News with category-keyword queries
 *       (`?q=politica mexico`). Result: 99% El País, none of the
 *       intended Mexican outlets. Google's ranking algorithm doesn't
 *       favor specific outlets in keyword search.
 *
 *  v3 (current) — per-outlet `site:` queries via Google News. Each
 *       outlet gets its own request that returns ~100 of THAT
 *       outlet's recent stories. We classify into categories
 *       post-fetch via a keyword regex, then merge/dedupe/sort.
 *       Source attribution is tagged at fetch time (we know exactly
 *       which outlet each item came from), so the strict allowlist
 *       filter from v2 is unnecessary.
 *
 * Cache: in-memory module-level, 5-min TTL, stale-while-revalidate.
 *
 * ToS note: Google News RSS technically restricts commercial use.
 * Acceptable for MVP scale; swap to TheNewsAPI / NewsAPI.org if
 * scale or licensing concerns become real.
 */

// ─── Outlets ────────────────────────────────────────────────────────────────
// Hybrid sourcing strategy per outlet:
//   directRss — outlet's own RSS endpoint. Preferred when working
//               because it ships real article images via
//               <media:thumbnail> / <enclosure> / inline <img>.
//   host      — domain for the Google News `site:<host>` fallback
//               query. Used when directRss isn't set OR returns
//               zero items (404/403/empty).
// Probed 2026-05-04: only El Financiero still has a working public
// RSS feed with items. Everyone else 404/403s or returns an HTML
// page. The other 8 fall through to Google News.
const OUTLETS = [
  { id: 'el-universal',    name: 'El Universal',       host: 'eluniversal.com.mx',     lean: 'center',         priority: 1 },
  { id: 'animal-politico', name: 'Animal Político',    host: 'animalpolitico.com',     lean: 'left',           priority: 1 },
  { id: 'aristegui',       name: 'Aristegui Noticias', host: 'aristeguinoticias.com',  lean: 'independent',    priority: 1 },
  { id: 'milenio',         name: 'Milenio',            host: 'milenio.com',            lean: 'center',         priority: 1 },
  { id: 'el-financiero',   name: 'El Financiero',      host: 'elfinanciero.com.mx',    lean: 'center-right',   priority: 1,
    directRss: 'https://www.elfinanciero.com.mx/rss/' },
  { id: 'sin-embargo',     name: 'Sin Embargo',        host: 'sinembargo.mx',          lean: 'left',           priority: 2 },
  { id: 'proceso',         name: 'Proceso',            host: 'proceso.com.mx',         lean: 'investigative',  priority: 2 },
  { id: 'noroeste',        name: 'Noroeste',           host: 'noroeste.com.mx',        lean: 'regional',       priority: 2 },
  { id: 'debate',          name: 'El Debate',          host: 'debate.com.mx',          lean: 'regional',       priority: 2 },
  // Latinus — Carlos Loret de Mola's outlet. No public RSS but
  // homepage has 72 <article> tags, 66 of which extract cleanly
  // via the homepage scraper. Lean = independent / right-leaning.
  { id: 'latinus',         name: 'Latinus',            host: 'latinus.us',             lean: 'independent',    priority: 2 },
];

function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ─── Categories + Google News queries ───────────────────────────────────────
// One Google News query per category. Spanish + Mexico locale filter
// (hl/gl/ceid) so we get Mexican-relevant results. Queries are tuned
// to surface mainstream stories without getting pure-keyword matches
// from random blogs.
export const NEWS_CATEGORIES = [
  'featured',
  'politica',
  'economia',
  'seguridad',
  'internacional',
  'cultura',
  'deportes',
  'farandula',
  'general',
];

// Category classifier — applied to each item's title + summary
// AFTER fetching from per-outlet feeds. First matching pattern wins,
// so order matters: very-specific categories (deportes, farandula)
// run BEFORE more-ambiguous ones (internacional). Without that order,
// "México vs Argentina mundial 2026" matches "argentina" → internacional
// even though it's plainly sports. Items that don't match any pattern
// are tagged 'general'. Keywords are matched on the diacritic-stripped
// lowercase form.
const CATEGORY_KEYWORDS = {
  // Sports first — names and league terms that would otherwise get
  // pulled into internacional / politica via overlapping country or
  // person mentions.
  deportes: [
    // Soccer
    /\bfutbol\b/, /\bliga mx\b/, /\bseleccion mexican\w+/, /\bel tri\b/,
    /\bconcacaf\b/, /\bconmebol\b/, /\bcopa(?: america| oro| mx| del rey| libertadores| sudamericana)?\b/,
    /\bmundial\b/, /\beliminator\w+/, /\bclasificator\w+/,
    /\bclasico\b/, /\bclausura\b/, /\bapertura\b/, /\bjornada \d+\b/,
    /\bgol(es|eador)?\b/, /\bpenal\b/, /\bautogol\b/,
    /\bchampions league\b/, /\bpremier league\b/, /\bla liga\b/, /\bbundesliga\b/, /\bserie a\b/,
    /\bchivas\b/, /\bamerica\b(?=.*(?:gol|partido|tigres|pumas|monterrey|liga|chivas))/i,
    /\btigres\b/, /\bpumas\b/, /\bcruz azul\b/, /\bmonterrey\b(?=.*(?:liga|gol|partido|rayados))/i,
    /\brayados\b/, /\btoluca\b/, /\bsanto\w+ laguna\b/, /\batlas\b/,
    /\bmessi\b/, /\bcristiano\b/, /\bronaldo\b/, /\bmbappe\b/, /\bneymar\b/,
    /\bmemo ochoa\b/, /\bguillermo ochoa\b/, /\bhirving lozano\b/, /\bedson alvarez\b/,
    // F1 + motor
    /\bf1\b/, /\bformula 1\b/, /\bgran premio\b/, /\bgrand prix\b/,
    /\bchecó? perez\b/, /\bsergio perez\b/, /\bverstappen\b/, /\bhamilton\b/, /\bferrari\b/, /\bmclaren\b/,
    /\bmotogp\b/, /\bnascar\b/, /\bindycar\b/,
    // Basketball / NBA
    /\bnba\b/, /\bbasquet\w+/, /\blebron\b/, /\bcurry\b/, /\bdoncic\b/,
    // Baseball
    /\bbeisbol\b/, /\bmlb\b/, /\bgrandes ligas\b/, /\btomateros\b/, /\bnaranjeros\b/, /\bdiablos rojos\b/,
    // Football (American)
    /\bnfl\b/, /\bsuper bowl\b/, /\btom brady\b/, /\bpatrick mahomes\b/,
    // Boxing / MMA
    /\bbox\w+/, /\bpelea\b/, /\bcombate\b/, /\bcanelo\b/, /\bsaul alvarez\b/,
    /\bufc\b/, /\bmma\b/, /\bcinturon\b(?=.*(?:box|pelea|wbc|wba|wbo))/i,
    /\bwbc\b/, /\bwba\b/, /\bwbo\b/, /\bibf\b/,
    // Tennis
    /\btenis\b/, /\bdjokovic\b/, /\balcaraz\b/, /\bsinner\b/, /\bnadal\b/, /\bswiatek\b/,
    /\babierto (?:de )?(?:australia|francia|estados unidos|wimbledon|usa)\b/, /\broland garros\b/, /\bus open\b/, /\bwimbledon\b/, /\batp\b/, /\bwta\b/,
    // Golf
    /\bgolf\b/, /\bpga\b/, /\bliv golf\b/, /\bmasters\b(?=.*(?:augusta|golf|pga))/i,
    /\bryder cup\b/,
    // Olympics + general
    /\bolimpic\w+/, /\bjuegos olim/, /\bparalimpic\w+/,
    /\batletismo\b/, /\bnatacion\b/, /\bclavados\b/, /\bgimnasia\b/, /\bciclismo\b/,
    /\bdeport\w+/, /\batlet\w+/, /\bcancha\b/, /\barbitr\w+/, /\bve\w+ vencer\b/,
    /\bcampeon\w+/, /\btorneo\b/, /\bfinal\b(?=.*(?:gol|partido|copa|liga|nba|nfl|mlb))/i,
  ],
  // Entertainment before politica/internacional so celebrity mentions
  // don't get pulled by political family names or country mentions in
  // entertainment news.
  farandula: [
    // Mexican / Latin music + TV celebrities
    /\bbelinda\b/, /\bdanna paola\b/, /\bgloria trevi\b/, /\bthalia\b/, /\bpaulina rubio\b/,
    /\bbad bunny\b/, /\bkarol g\b/, /\bshakira\b/, /\bj balvin\b/, /\bricky martin\b/,
    /\bchristian nodal\b/, /\bcazzu\b/, /\bangela aguilar\b/, /\bpepe aguilar\b/,
    /\beugenio derbez\b/, /\bdiego luna\b/, /\bgael garcia\b/, /\beiza gonzalez\b/,
    /\bkate del castillo\b/, /\bsalma hayek\b/, /\byalitza aparicio\b/,
    /\btelevisa\b/, /\btv azteca\b/, /\bazteca uno\b/, /\bunivision\b/, /\btelemundo\b/,
    /\btelenovel\w+/, /\breality( show)?\b/, /\brealiti\b/,
    /\bla casa de los famosos\b/, /\bbig brother\b/, /\bmasterchef\b/, /\bmexicos got talent\b/,
    /\bmiss (?:universo|mexico|mundo)\b/, /\bcertamen de belleza\b/,
    // Award shows + TV/film events
    /\bgrammys?\b/, /\blatin grammys?\b/, /\boscar\w*\b/, /\bgolden globe\w*\b/, /\bemmy\w*\b/,
    /\bmtv vma\w*\b/, /\bbillboard\b/, /\bmet gala\b/,
    // Celebrity drama / lifestyle keywords
    /\binfluencer\w*\b/, /\byoutuber\w*\b/, /\btiktoker\w*\b/, /\bstreamer\w*\b/,
    /\bromance\b/, /\bnovi(o|a)s?\b/, /\bbod\w+\b/, /\bdivorci\w+\b/, /\bseparac\w+\b/,
    /\bembaraz\w+\b/, /\bbaby shower\b/, /\bcasamient\w+\b/,
    /\bfarandul\w+/, /\bespectacul\w+/, /\bchism\w+/, /\bfan\w*\b/,
    /\bcantante\b/, /\bactor\b/, /\bactriz\b/, /\bartista\b/,
    /\bbeyonce\b/, /\btaylor swift\b/, /\bkim kardashian\b/, /\brihanna\b/, /\barian\w+ grande\b/,
  ],
  // Security before politica because a bunch of crime headlines mention
  // governors / mayors but are clearly seguridad stories.
  seguridad: [
    /\bnarco\w+/, /\bcartel\b/, /\bcjng\b/, /\bcds\b/, /\bsinaloa\b(?=.*(?:cartel|cds|narco|chapo|el mayo|guzman))/i,
    /\bel chapo\b/, /\bel mayo\b/, /\bguzman loera\b/, /\bovidio\b/,
    /\bmatanza\b/, /\bmasacre\b/, /\bhomicidi\w+/, /\bsicari\w+/, /\bejecuta\w+/, /\batentado\b/,
    /\barma(s|do)?\b(?=.*(?:fuego|asalto|crimen|delict|narco))/i,
    /\bdetenid\w+/, /\bdetenci\w+/, /\bcaptur\w+/, /\boperat\w+\b/,
    /\bguardia nacional\b/, /\bsedena\b/, /\bsemar\b/, /\bpolicia\b/, /\bagente\b(?=.*(?:detuvo|capturo|seguridad))/i,
    /\bfgr\b/, /\bfiscal\w+/, /\bministerio publico\b/, /\bmp\b(?=.*(?:detuvo|caso))/i,
    /\bsecuestr\w+/, /\bdesapareci\w+/, /\bdesaparici\w+/, /\bextorsion\w+/, /\bcobro de piso\b/,
    /\brob(?:o|os|a|an|ar|aba|aban|aron|ado|ada|ados|ando)\b/, /\basalt\w+/, /\batraco\b/, /\binvasion\w+/,
    /\bbloqu\w+\b(?=.*(?:carretera|via|ciudad|protesta|cni))/i,
    /\bviolenc\w+/, /\bbalacer\w+/, /\btiroteo\b/, /\bdisparo\w*\b/,
    /\bfeminicid\w+/, /\bviolaci\w+/, /\babus\w+ sexual/, /\bagresion\b/,
    /\bcadaver\w*\b/, /\bcuerp(o|os) sin vida\b/, /\bfosa\b/, /\binhuma\w+ clandestin\w+/,
    /\bcorrup\w+(?=.*(?:funcionario|servidor publico|gobierno|alcalde|gobernador))/i,
    /\bdelincuen\w+/, /\bcrim(en|inal)\w*\b/,
    /\bcarcel\b/, /\bpenal\b/, /\breclusorio\b/, /\baltiplano\b/,
    // Natural disasters & civil emergencies — they were defaulting to general.
    /\bsismo\b/, /\bterremoto\b/, /\bhuracan\w*\b/, /\btormenta\b/, /\bciclon\w*\b/,
    /\binundac\w+/, /\bdesbord\w+/, /\bdeslizamiento\b/, /\bdeslave\b/,
    /\bincendio\w*\b/, /\bevacuac\w+/, /\bemergenc\w+/, /\bproteccion civil\b/,
    /\bsequia\b/, /\bcaravanas?\b(?=.*(?:migrante|frontera|tijuana))/i,
    // General security-policy framing (caught a lot of headlines that
    // were defaulting to 'politica' only when they're really both).
    /\bseguridad nacional\b/, /\bseguridad publica\b/, /\bseguridad fronteriza\b/,
    /\bplan de seguridad\b/, /\bestrategia de seguridad\b/, /\bcrisis de seguridad\b/,
    /\bgolpe (?:al narco|al crimen)\b/,
  ],
  politica: [
    // Federal executive
    /\bsheinbaum\b/, /\bclaudia sheinbaum\b/, /\bamlo\b/, /\bandres manuel\b/, /\bobrador\b/,
    /\bpresidenc(?:ia|ial)\b/, /\bpalacio nacional\b/, /\bmananera\b/, /\bla mananera\b/,
    /\bgabinete\b/, /\bsecretari[oa] de \w+/, /\bsubsecreta\w+/,
    /\bcanciller\w*\b/, /\brelaciones exteriores\b/, /\bsre\b/,
    /\bsegob\b/, /\bsedena\b(?=.*(?:secretaria|secretario))/i, /\bsemarnat\b/, /\bsep\b(?=.*(?:secretaria|secretario|educa))/i,
    /\bsalud\b(?=.*(?:secretari|federal|funcionari|gobierno))/i,
    // Parties + politicians
    /\bmorena\b/, /\bpan\b/, /\bpri\b/, /\bprd\b/, /\bmovimiento ciudadano\b/, /\bmc\b(?=.*(?:diputado|partido|movimiento))/i,
    /\bpvem\b/, /\bpt\b(?=.*(?:diputado|partido))/i, /\bnueva alianza\b/,
    /\bxochitl galvez\b/, /\bmaynez\b/, /\bjorge maynez\b/, /\bclaudia ojeda\b/,
    /\bmarcelo ebrard\b/, /\badan augusto\b/, /\brosario piedra\b/, /\bricardo monreal\b/,
    /\bnoroña\b/, /\bgerardo fernandez noroña\b/, /\bmonreal\b/,
    /\bfox\b(?=.*(?:expresidente|panista|fundacion))/i, /\bcalderon\b(?=.*(?:expresidente|panista|felipe))/i,
    /\bpeña nieto\b/, /\benrique peña\b/,
    // Legislature + judiciary
    /\bsenad\w+/, /\bdiputad\w+/, /\bcongres\w+/, /\bcamara (?:de diputados|alta|baja)\b/,
    /\blegislatur\w+/, /\bcomisi(?:on|ones) (?:permanente|de \w+)/,
    /\bsuprema corte\b/, /\bscjn\b/, /\bministra?\b(?=.*(?:scjn|corte|judicial))/i,
    /\bjuez\b(?=.*(?:federal|amparo|fiscal|caso))/i, /\btribunal electoral\b/, /\btepjf\b/, /\btribunal\b/,
    /\bine\b/, /\bcomision\w+ electoral\b/, /\binstituto electoral\b/,
    // Acts of governance
    /\belector\w+/, /\bvotacion\w+/, /\bcomicios\b/, /\bencuesta\w+\b(?=.*(?:electoral|partido|candidat))/i,
    /\bgobern\w+/, /\bgobierno\w*\b/, /\bcandidat\w+/, /\bcampaña\w*\b(?=.*(?:electoral|candidat|partido))/i,
    /\bjefa de gobierno\b/, /\bjefe de gobierno\b/, /\bclara brugada\b/,
    /\balcalde\w*\b/, /\balcaldesa\b/, /\bmunicipi(?:o|os)\b(?=.*(?:gobierno|alcalde|presupuesto|recurso))/i,
    /\bpresident\w+/, /\bsecretari\w+ de \w+/,
    /\bconstituci\w+/, /\bdecreto\b/, /\breforma\b/, /\bley\b(?=.*(?:congres|aprob|reforma|votar|publicar))/i,
    /\biniciativa\b/, /\bdictamen\b/, /\bveto\b/, /\bamparo\b/, /\bimpugnaci\w+\b/,
    /\bpolitic\w+/, /\bdeclaracion\w*\b(?=.*(?:presidenta|presidente|gobierno|secretari|amlo|sheinbaum))/i,
  ],
  economia: [
    // Macro
    /\bpeso\b(?=.*(?:dolar|cotiza|tipo de cambio|cierre|sesion))/i,
    /\bdolar\b/, /\beuro\b/, /\binflacion\b/, /\bbanxico\b/, /\btasas?(?: de interes)?\b/,
    /\bpib\b/, /\bcrecimiento economic\w+/, /\bremesa\w+/,
    /\bemple\w+/, /\bdesemple\w+/, /\bsalario\b/, /\bsueldo\b/,
    /\btipo de cambio\b/, /\bcotiza\w+\b(?=.*(?:peso|dolar|euro|bolsa|acci))/i,
    // State + para-state
    /\bpemex\b/, /\bcfe\b/, /\bishtar\b/, /\bbanco bienestar\b/,
    /\bhacienda\b/, /\bsat\b/, /\bsfi\b/, /\bfinanzas\b/, /\binversi\w+\b/,
    /\baranc\w+/, /\btlcan\b/, /\bt-mec\b/, /\btmec\b/,
    /\bbolsa\b/, /\bbmv\b/, /\bibovespa\b/, /\bdow jones\b/, /\bnasdaq\b/, /\bsp ?500\b/,
    /\beconomi\w+/, /\bnegoci\w+\b/, /\bempresa\w*\b/, /\bcorporativ\w+/,
    // Mexican companies + brands
    /\bwalmart\b/, /\boxxo\b/, /\bfemsa\b/, /\bcemex\b/, /\bbimbo\b/, /\bliverpool\b/, /\bsoriana\b/,
    /\bgrupo (?:salinas|carso|bimbo|mexico|televisa|elektra|aeroportuario)\b/,
    /\bbanorte\b/, /\bbbva\b/, /\bsantander\b/, /\bcitibanamex\b/, /\bbanamex\b/, /\bscotiabank\b/, /\bhsbc\b/, /\binbursa\b/,
    /\baeroport\w+\b/, /\baerolinea\b/, /\baeromexico\b/, /\bvolaris\b/, /\bviva aerobus\b/, /\baicm\b/, /\baifa\b/,
    // Trade / industry
    /\bexportaci\w+/, /\bimportaci\w+/, /\bcomercio (?:exterior|internacional)\b/,
    /\bnearshoring\b/, /\bmaquiladora\b/, /\bmanufactura\b/, /\bindustri\w+\b(?=.*(?:automotri|manufact|export|inversi))/i,
    /\binmobiliari\w+/, /\bvivienda\b(?=.*(?:precio|venta|infonavit|fovissste))/i, /\binfonavit\b/,
    /\bipc\b/, /\bdeuda (?:publica|externa)\b/, /\bbono\b(?=.*(?:tesoro|gobierno|bolsa))/i,
    /\bipo\b/, /\boferta publica\b/, /\bfusion\b(?=.*(?:empresa|adquisici|corporativ))/i,
    // Crypto / fintech
    /\bbitcoin\b/, /\bethereum\b/, /\bcripto\w+\b/, /\bblockchain\b/, /\bnft\b/,
    /\bfintech\w*\b/, /\bbinance\b/, /\bcoinbase\b/,
    // Tax + impact terms
    /\bimpuest\w+\b/, /\biva\b/, /\bisr\b/, /\bsubsidio\w*\b/,
    /\bmercado\b(?=.*(?:bolsa|peso|dolar|sesion|abre|cierra|baja|sube))/i,
  ],
  // Culture last among Mexico-centric blocks; education/religion/food
  // get folded in here because they were defaulting to general.
  cultura: [
    // Arts + heritage
    /\bmuseo\b/, /\bexposicion\w+/, /\bgaler\w+\b(?=.*(?:arte|expos|museo))/i,
    /\bteatro\b/, /\bobra de teatro\b/, /\bopera\b(?=.*(?:bellas|teatro|estren))/i, /\bdanza\b/, /\bballet\b/,
    /\bnovela\b(?!.*tele)/i, /\blibro\b/, /\bpoes\w+/, /\bescritor\w+/, /\bautor\w+\b(?=.*(?:libro|literari|novela|premio))/i,
    /\bliteratur\w+/, /\beditorial\b(?=.*(?:libro|literari|premio))/i,
    /\bfrida kahlo\b/, /\bdiego rivera\b/, /\boctavio paz\b/, /\bcarlos fuentes\b/, /\belena poniatowska\b/,
    // Music + cinema
    /\bmusica\b/, /\bconcierto\b/, /\bdisco\b(?=.*(?:musica|estren|cantante|premio))/i,
    /\bfilm\b/, /\bcine\b/, /\bpelicula\b/, /\bdirector cinematogr\w+/, /\bestreno\b/,
    /\bfestival\b(?=.*(?:cine|musica|cultura|gastronom|jazz|guelaguetza))/i,
    /\bguelaguetza\b/, /\bcervantino\b/, /\bfica\b/, /\bdocumental\b/,
    /\bspotify\b/, /\bnetflix\b(?=.*(?:estren|serie|peli))/i, /\bdisney\+?\b(?=.*(?:estren|serie|peli))/i,
    // Cultural patrimony / Mexican identity
    /\bbellas artes\b/, /\bunesco\b/, /\bpatrimonio\b/, /\barte\b/,
    /\binah\b/, /\binba\b/, /\bzona arqueolog\w+/, /\bteotihuacan\b/, /\bchichen itza\b/,
    /\bdia de muertos\b/, /\bvirgen de guadalupe\b/, /\bguadalupe\b(?=.*(?:basilica|virgen|peregrin))/i,
    /\bcarnaval\b/, /\bferia\b(?=.*(?:cultural|libro|gastronom|nacion|estad))/i,
    /\btradicion\w*\b/, /\bcostumbre\w*\b/,
    // Gastronomy
    /\bgastronom\w+/, /\bchef\b/, /\brestaurante\b(?=.*(?:premio|estrella|michelin|gastronom))/i,
    /\btaquer\w+\b/, /\bmole\b/, /\bmezcal\b(?=.*(?:cultura|tradic|denominaci|premio))/i,
    /\bmichelin\b/, /\b50 best\b/, /\bestrella\w* michelin\b/,
    // Religion (general cultural / society)
    /\bpapa\b(?=.*(?:vatican|francisco|leon|encicli|santo padre))/i, /\bvaticano\b/, /\biglesia\b(?=.*(?:catolica|papa|vaticano|cardenal))/i,
    /\bcardenal\b/, /\bobispo\b/, /\barzobispo\b/,
    // Education / science (when not security/political)
    /\bunam\b/, /\bipn\b/, /\buam\b/, /\bunesco\b/, /\bsep\b(?=.*(?:beca|escuela|universid|profesor|maestro|estudiante))/i,
    /\beducaci\w+/, /\bestudiante\w*\b/, /\bprofesor\w*\b/, /\bmaestro\w*\b(?=.*(?:escuela|sep|magisteri|cnte))/i,
    /\binvestigaci\w+ cientif\w+/, /\bcientific\w+/, /\bnasa\b/, /\bespacio\b(?=.*(?:nasa|spacex|cohete|astronaut))/i,
  ],
  // International last so country/leader names don't grab clearly
  // local stories that mention foreign actors in passing.
  internacional: [
    // North America
    /\bestados unidos\b/, /\beeuu\b/, /\beua\b/, /\bcasa blanca\b/,
    /\btrump\b/, /\bbiden\b/, /\bharris\b/, /\bvance\b/, /\bwalz\b/, /\bdesantis\b/,
    /\bcanada\b/, /\btrudeau\b/, /\bcarney\b(?=.*(?:canad|primer ministro))/i,
    // Latin America
    /\bargentina\b/, /\bmilei\b/, /\bbrasil\b/, /\blula\b/,
    /\bcolombia\b/, /\bpetro\b(?=.*(?:colombia|president))/i,
    /\bchile\b/, /\bboric\b/,
    /\bperu\b/, /\bbolivia\b/, /\becuador\b/, /\bnoboa\b/, /\bparaguay\b/, /\buruguay\b/,
    /\bvenezuela\b/, /\bmaduro\b(?=.*(?:venezuel|caracas))/i, /\bguaido\b/,
    /\bcuba\b/, /\bdiaz-?canel\b/, /\bnicaragua\b/, /\bortega\b(?=.*(?:nicarag|managua))/i,
    /\bel salvador\b/, /\bbukele\b/, /\bguatemala\b/, /\bhonduras\b/,
    // Europe
    /\beuropa\b/, /\bunion europea\b/, /\bbritani\w+/, /\breino unido\b/, /\bbrexit\b/,
    /\balemania\b/, /\bmerkel\b/, /\bscholz\b/, /\bfrancia\b/, /\bmacron\b/,
    /\bitalia\b/, /\bmeloni\b/, /\bespaña\b/, /\bsanchez\b(?=.*(?:españa|presidente|gobiern))/i,
    /\brusia\b/, /\bputin\b/, /\bucrania\b/, /\bzelensk\w+/, /\bkremlin\b/,
    /\botan\b/,
    // Asia
    /\bchina\b/, /\bxi jinping\b/, /\bhong kong\b/, /\btaiwan\b/,
    /\bcorea\b/, /\bjapon\b/, /\bjapan\b/, /\bindia\b/, /\bmodi\b(?=.*(?:india|primer ministro))/i,
    /\bfilipinas\b/, /\bvietnam\b/,
    // Middle East / Africa
    /\bisrael\b/, /\bnetanyahu\b/, /\bgaza\b/, /\bpalestin\w+/, /\bhamas\b/, /\bhezbol[ah][a]?\b/,
    /\biran\b/, /\biraq\b/, /\bsiria\b/, /\blibano\b/, /\barabia saudita\b/,
    /\bafrica\b/, /\bnigeria\b/, /\bsudafrica\b/, /\begipto\b/, /\bmarruecos\b/,
    // Multilateral
    /\bonu\b/, /\bnaciones unidas\b/, /\bunesco\b(?=.*(?:resoluci|consejo|delegaci))/i,
    /\boea\b/, /\boms\b(?=.*(?:resoluci|advert|alert|epidem))/i, /\bfmi\b/, /\bbanco mundial\b/, /\bbid\b(?=.*(?:banco|prestamo))/i,
    /\bcumbre\b/, /\btratado\b/, /\baranceles?\b(?=.*(?:trump|estados unidos|canad|china))/i,
    /\bemba\w+/, /\bdiplomac\w+/, /\bextradici\w+\b/,
  ],
};

// Returns every category whose keyword set matches the headline+summary.
// An item legitimately belongs to multiple tabs ("Trump y Biden debaten
// sobre aranceles" = economia AND internacional; "Sheinbaum anuncia plan
// de seguridad" = politica AND seguridad), so we tag with all of them
// instead of picking a single winner. Items with no matches fall back
// to ['general'].
function classify(item) {
  const text = normalize(`${item.title} ${item.summary || ''}`);
  const matched = [];
  for (const [cat, patterns] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const re of patterns) {
      if (re.test(text)) { matched.push(cat); break; }
    }
  }
  return matched.length ? matched : ['general'];
}

const GNEWS_BASE = 'https://news.google.com/rss/search';
const GNEWS_LOCALE = 'hl=es-MX&gl=MX&ceid=MX:es-419';
// Browser-like User-Agent — Google News RSS 302s when called with
// non-browser UAs.
const GNEWS_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 PronosNewsBot/1.0';

// ─── Configuration ──────────────────────────────────────────────────────────
const ITEMS_PER_OUTLET = 20;       // top-N most-recent items per outlet
const MAX_TOTAL_ITEMS = 180;       // hard cap across all outlets
const MAX_AGE_HOURS = 48;
const CACHE_TTL_MS = 5 * 60_000;
const FEED_TIMEOUT_MS = 8_000;     // per-outlet timeout (independent)

// First-seen timestamp tracker for items that have no real publish
// date (homepage-scraped cards, mostly). Maps canonicalized URL →
// epoch-ms of first time we saw it. Stable across refreshes within
// the lifetime of the serverless instance so an item's apparent age
// stops resetting to "1m ago" on every cache refresh. We GC entries
// older than MAX_AGE_HOURS during refresh; FIRST_SEEN_MAX_ENTRIES is
// the hard memory ceiling.
const FIRST_SEEN_MAX_ENTRIES = 5000;
const firstSeenByUrl = new Map();
// Image enrichment for Google News items. The GN redirector page
// has <meta property="og:image"> pointing at Google's own CDN
// (lh3.googleusercontent.com) — we can scrape it without API keys
// or a redirect decoder. We only enrich the top-N items per refresh
// to keep the refresh cost bounded; the rest fall back to favicon.
const IMAGE_ENRICH_TOP_N = 60;
const IMAGE_FETCH_TIMEOUT_MS = 4_000;
const IMAGE_FETCH_CONCURRENCY = 6;
const IMAGE_CACHE_MAX_ENTRIES = 4000; // hard cap on memory growth

// ─── URL canonicalization ───────────────────────────────────────────────────
// Strip tracking params + trailing slash so stored news_url and
// looked-up news_url match across feed refreshes. Without this,
// "vincular" links disappear when the source URL gets a fresh utm_*.
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'igshid', '_ga', '_gl',
  'ref', 'ref_src', 'source', 'cmpid', 'spm', 'wt_zmc', 'oc',
]);

export function canonicalizeUrl(raw) {
  if (typeof raw !== 'string' || !raw) return raw;
  try {
    const u = new URL(raw);
    // Drop tracking params.
    const keep = [];
    for (const [k, v] of u.searchParams.entries()) {
      if (!TRACKING_PARAMS.has(k.toLowerCase())) keep.push([k, v]);
    }
    u.search = '';
    for (const [k, v] of keep) u.searchParams.append(k, v);
    // Strip fragment + trailing slash on path.
    u.hash = '';
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.replace(/\/+$/, '');
    }
    return u.toString();
  } catch {
    return raw;
  }
}

// ─── RSS parser (regex-based, permissive) ───────────────────────────────────

function unwrapCdata(s) {
  if (!s) return '';
  return String(s).replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim();
}
function decodeEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ');
}
function stripHtml(s) {
  if (!s) return '';
  return String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function extractTag(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? unwrapCdata(decodeEntities(m[1])) : '';
}
function extractAttr(xml, tag, attr) {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}=["']([^"']+)["'][^>]*/?>`, 'i');
  const m = xml.match(re);
  return m ? m[1] : null;
}
function firstImageFromHtml(html) {
  if (!html) return null;
  const m = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

// Extract the source name from a Google News title.
// Google News convention: "Headline - Source Name". Some titles
// embed the source mid-string before the trailing " - " — we always
// take the LAST segment after the final " - " separator.
function splitTitleSource(title) {
  if (!title) return { title: '', source: null };
  // Try em-dash first (rare), then hyphen+space.
  const sepIdx = Math.max(title.lastIndexOf(' — '), title.lastIndexOf(' - '));
  if (sepIdx <= 0) return { title: title.trim(), source: null };
  const headline = title.slice(0, sepIdx).trim();
  const source = title.slice(sepIdx + 3).trim();
  // Don't strip if the trailing segment looks like part of the
  // headline (long, has spaces with verbs etc).
  if (source.length > 60) return { title: title.trim(), source: null };
  return { title: headline, source };
}

// Favicon URL for a host name — used as a small visual identifier
// on cards when Google News doesn't include a thumbnail. Falls
// through `https:` in the CSP allowlist.
function faviconForUrl(url) {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=128`;
  } catch { return null; }
}

function parseGoogleNewsItems(xml) {
  const items = [];
  const itemRe = /<item\b[\s\S]*?<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[0];
    const titleRaw = stripHtml(extractTag(block, 'title'));
    const link = stripHtml(extractTag(block, 'link'));
    if (!titleRaw || !link) continue;

    const { title, source } = splitTitleSource(titleRaw);
    const description = extractTag(block, 'description');
    const summary = stripHtml(description).slice(0, 280);
    const pubDateRaw = extractTag(block, 'pubDate');
    const publishedAt = pubDateRaw ? new Date(pubDateRaw) : null;
    const publishedAtIso = (publishedAt && !Number.isNaN(publishedAt.getTime()))
      ? publishedAt.toISOString() : null;

    // Google News rarely ships images, but check just in case.
    const image =
        extractAttr(block, 'enclosure', 'url')
      || extractAttr(block, 'media:thumbnail', 'url')
      || extractAttr(block, 'media:content', 'url')
      || firstImageFromHtml(description)
      || null;

    items.push({
      title,
      url: canonicalizeUrl(link),
      summary,
      image,
      sourceName: source,           // raw label from title (may be null)
      publishedAt: publishedAtIso,
    });
  }
  return items;
}

// ─── Fetch ──────────────────────────────────────────────────────────────────

// Tag fetched items with outlet metadata. Used by both direct and
// Google News paths so downstream dedup/sort/classify code is
// agnostic to the source channel.
function tagItem(it, outlet, channel) {
  return {
    ...it,
    sourceId: outlet.id,
    sourceName: outlet.name,
    sourceLean: outlet.lean,
    sourcePriority: outlet.priority,
    favicon: faviconForUrl(it.url),
    sourceChannel: channel, // 'direct' | 'gnews' — for debug
  };
}

// Direct RSS fetcher — used when outlet.directRss is set. Reuses the
// regex parser to pull title/link/image/pubDate. Direct items ship
// real article images via media:thumbnail / enclosure / inline img,
// which is the main reason we prefer this channel when available.
async function fetchDirectRss(outlet) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const res = await fetch(outlet.directRss, {
      headers: {
        'User-Agent': GNEWS_UA,
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const raw = parseGoogleNewsItems(xml); // same regex parser; works
                                           // for both Google News + RSS 2.0
    return raw.slice(0, ITEMS_PER_OUTLET).map(it => tagItem(it, outlet, 'direct'));
  } catch (e) {
    console.warn('[news-mexico] direct rss failed', { outletId: outlet.id, error: e?.message });
    return null; // null signals "fall through to Google News"
  } finally {
    clearTimeout(timer);
  }
}

// Google News site:-scoped fallback. Returns up to
// ITEMS_PER_OUTLET items. No article images (Google News redirector
// URLs don't expose og:image without resolving each one — too
// expensive at refresh time). The frontend renders these cards
// with a colored gradient + favicon instead.
async function fetchGoogleNewsForOutlet(outlet) {
  const q = `site:${outlet.host}`;
  const url = `${GNEWS_BASE}?q=${encodeURIComponent(q)}&${GNEWS_LOCALE}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': GNEWS_UA,
        'Accept': 'application/rss+xml, application/xml, */*',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const raw = parseGoogleNewsItems(xml);
    return raw.slice(0, ITEMS_PER_OUTLET).map(it => tagItem(it, outlet, 'gnews'));
  } catch (e) {
    console.warn('[news-mexico] gnews fetch failed', { outletId: outlet.id, error: e?.message });
    return { __error: e?.message || 'fetch_failed', outletId: outlet.id };
  } finally {
    clearTimeout(timer);
  }
}

// Per-outlet fetcher with channel-fallback chain:
//   1. Direct RSS (when working — only El Financiero today). Best
//      because the RSS feed ships article images via media:thumbnail.
//   2. Homepage HTML scrape (5 outlets — El Universal, Aristegui,
//      Milenio, Proceso, Noroeste). Pulls real article images from
//      <article> blocks on the outlet's homepage.
//   3. Google News site:-scoped query (last resort, no images).
// Each step is gated on the previous returning useful data.
async function fetchOneOutlet(outlet) {
  if (outlet.directRss) {
    const direct = await fetchDirectRss(outlet);
    if (Array.isArray(direct) && direct.length > 0) return direct;
  }
  // Homepage scrape — present for the 5 outlets we've validated.
  // Returns null if no scraper config OR fetch failed.
  const scrapeCfg = getScraperConfig(outlet.id);
  if (scrapeCfg) {
    const scraped = await fetchHomepageScrape(outlet, { timeoutMs: FEED_TIMEOUT_MS });
    if (Array.isArray(scraped) && scraped.length > 0) {
      // Tag with outlet metadata + favicon (the scraper sets sourceId/
      // sourceName but doesn't add the lean / priority / favicon
      // fields the rest of the pipeline expects).
      return scraped.slice(0, ITEMS_PER_OUTLET).map(it => ({
        ...it,
        sourceLean: outlet.lean,
        sourcePriority: outlet.priority,
        favicon: faviconForUrl(it.url),
      }));
    }
  }
  return fetchGoogleNewsForOutlet(outlet);
}

// ─── Dedup ──────────────────────────────────────────────────────────────────
// Two passes:
//   1. URL-exact dedup (same canonical URL across categories — one
//      politica story might also surface in 'general')
//   2. Title-shingle Jaccard for cross-outlet near-duplicates ("AMLO
//      announces X" from El Universal + Milenio = same story)

function shingles(s, n = 4) {
  const out = new Set();
  const trimmed = normalize(s).replace(/[^a-z0-9 ]/g, '');
  for (let i = 0; i + n <= trimmed.length; i++) out.add(trimmed.slice(i, i + n));
  return out;
}
function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const v of a) if (b.has(v)) inter++;
  return inter / (a.size + b.size - inter);
}
const DEDUP_THRESHOLD = 0.55;

function dedupe(items) {
  // Stable: keep the FIRST item we see (already date-sorted desc).
  const seenUrl = new Set();
  const kept = [];
  const keptShingles = [];
  for (const it of items) {
    if (seenUrl.has(it.url)) continue;
    seenUrl.add(it.url);
    const sh = shingles(it.title, 4);
    let dupe = false;
    for (const ksh of keptShingles) {
      if (jaccard(sh, ksh) >= DEDUP_THRESHOLD) { dupe = true; break; }
    }
    if (dupe) continue;
    kept.push(it);
    keptShingles.push(sh);
  }
  return kept;
}

// ─── Image enrichment (Google News og:image scrape) ─────────────────────────
// Persistent in-memory cache keyed by canonicalized news_url. Once
// we've resolved an image for a URL, never re-fetch — the article's
// og:image doesn't change.
const imageCache = new Map(); // url → string | null (null = "tried, missed")

function imageCacheGet(url) {
  return imageCache.has(url) ? imageCache.get(url) : undefined;
}
function imageCacheSet(url, val) {
  // Cap the cache so it can't grow unboundedly across long-lived
  // serverless containers. When full, drop the oldest 25% (Map
  // iteration order is insertion order, so slice from the start).
  if (imageCache.size >= IMAGE_CACHE_MAX_ENTRIES) {
    const drop = Math.floor(IMAGE_CACHE_MAX_ENTRIES * 0.25);
    let i = 0;
    for (const k of imageCache.keys()) {
      if (i++ >= drop) break;
      imageCache.delete(k);
    }
  }
  imageCache.set(url, val);
}

// Google News' redirector page lies about og:image — every article
// returns the SAME generic Google News logo placeholder rather than
// the underlying article's image. Probed against 5 distinct
// articles, all returned the identical URL:
//   lh3.googleusercontent.com/J6_coFbogxhRI9iM864NL_li...
// We blacklist that token; any future placeholder Google rotates in
// can be added here. If we ever extract og:image successfully from
// a non-Google-News URL (which we don't currently — all our items
// are GN redirectors except direct-RSS El Financiero), this filter
// is harmless because direct-RSS images don't pass through here.
const GNEWS_PLACEHOLDER_TOKENS = [
  'J6_coFbogxh',
];

function isGnewsPlaceholder(url) {
  if (!url) return false;
  return GNEWS_PLACEHOLDER_TOKENS.some(t => url.includes(t));
}

// Extract og:image from an HTML document. Tries property="og:image"
// in either attribute order, then twitter:image as a fallback.
// Rejects known Google News placeholder URLs so cards fall back to
// the text-only treatment instead of all looking identical.
function extractOgImage(html) {
  if (!html) return null;
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1] && !isGnewsPlaceholder(m[1])) return m[1];
  }
  return null;
}

async function fetchOgImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': GNEWS_UA,
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const html = await res.text();
    return extractOgImage(html);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Limit concurrency so we don't open 60 sockets at once. Returns
// when all input items have been processed (success or failure).
async function runWithConcurrency(items, worker, n) {
  let i = 0;
  async function next() {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx]);
    }
  }
  const runners = Array.from({ length: Math.min(n, items.length) }, () => next());
  await Promise.all(runners);
}

// Populate `image` on items that don't already have one (Google News
// items that came without media:thumbnail). Looks up the in-memory
// cache first; only fetches the redirector page for cache misses,
// limited to the top-N items per refresh so the cost is bounded.
async function enrichItemsWithImages(items) {
  // Group items into:
  //   already-has-image   → skip (direct RSS)
  //   cache-hit (positive)→ stamp image from cache
  //   cache-hit (negative)→ skip (we tried earlier, missed)
  //   cache-miss          → fetch og:image and cache the result
  const toFetch = [];
  for (const it of items) {
    if (it.image) continue;
    const cached = imageCacheGet(it.url);
    if (cached === undefined) {
      toFetch.push(it);
    } else if (cached) {
      it.image = cached;
    }
    // cached === null means "we tried before, no image" — keep as-is
  }

  // Cap fetch count per refresh. Items beyond this fall through
  // without images this round; they'll get fetched on a future
  // refresh once the priority items finish caching.
  const fetchTargets = toFetch.slice(0, IMAGE_ENRICH_TOP_N);

  await runWithConcurrency(
    fetchTargets,
    async (it) => {
      const img = await fetchOgImage(it.url);
      imageCacheSet(it.url, img); // stores either URL or null
      if (img) it.image = img;
    },
    IMAGE_FETCH_CONCURRENCY,
  );

  return { fetched: fetchTargets.length, cached: items.length - toFetch.length };
}

// ─── Cache + refresh ────────────────────────────────────────────────────────

let cache = { fetchedAt: 0, items: [], debug: {} };
let inFlight = null;

async function refreshCache() {
  const debug = {
    fetchedAt: new Date().toISOString(),
    perOutlet: {},
    categoryCounts: {},
  };
  try {
    // Each outlet gets its own AbortController inside fetchOneOutlet,
    // so one slow source doesn't kill the rest. Failed fetches return
    // an { __error, outletId } sentinel that we surface in `debug`.
    const results = await Promise.all(OUTLETS.map(o => fetchOneOutlet(o)));

    let items = [];
    for (let i = 0; i < OUTLETS.length; i++) {
      const outlet = OUTLETS[i];
      const r = results[i];
      if (Array.isArray(r)) {
        debug.perOutlet[outlet.id] = { ok: true, count: r.length };
        items = items.concat(r);
      } else {
        debug.perOutlet[outlet.id] = { ok: false, error: r?.__error || 'unknown' };
      }
    }
    debug.rawCount = items.length;

    // Resolve missing/invalid publishedAt via the first-seen tracker.
    // Scraped homepage cards usually arrive with publishedAt = null
    // (the scraper used to stamp "now" — that bug made every refresh
    // make every item look 1 minute old, which sorted those outlets
    // permanently to the top). Now: if a URL has no real date, we use
    // the first wall-clock time we ever saw it. Subsequent refreshes
    // keep that timestamp, so items naturally age out.
    const nowMs = Date.now();
    for (const it of items) {
      const t = it.publishedAt ? new Date(it.publishedAt).getTime() : NaN;
      if (Number.isFinite(t)) continue;
      const seen = firstSeenByUrl.get(it.url);
      if (seen) {
        it.publishedAt = new Date(seen).toISOString();
        it.publishedAtSource = 'first-seen';
      } else {
        firstSeenByUrl.set(it.url, nowMs);
        it.publishedAt = new Date(nowMs).toISOString();
        it.publishedAtSource = 'first-seen';
      }
    }

    // GC the first-seen map so it doesn't grow unbounded:
    //   1. drop entries older than the MAX_AGE_HOURS cutoff (those
    //      items would be filtered out below anyway);
    //   2. if still over cap, drop oldest entries first (Map iteration
    //      order = insertion order, so we evict from the front).
    const firstSeenCutoff = nowMs - MAX_AGE_HOURS * 60 * 60_000;
    for (const [url, ts] of firstSeenByUrl) {
      if (ts < firstSeenCutoff) firstSeenByUrl.delete(url);
    }
    if (firstSeenByUrl.size > FIRST_SEEN_MAX_ENTRIES) {
      const drop = firstSeenByUrl.size - FIRST_SEEN_MAX_ENTRIES;
      let i = 0;
      for (const url of firstSeenByUrl.keys()) {
        if (i++ >= drop) break;
        firstSeenByUrl.delete(url);
      }
    }
    debug.firstSeenSize = firstSeenByUrl.size;

    // Drop too-old items.
    const cutoff = nowMs - MAX_AGE_HOURS * 60 * 60_000;
    items = items.filter(i => i.publishedAt
      && new Date(i.publishedAt).getTime() >= cutoff);
    debug.recentCount = items.length;

    // Classify each item by keywords (politica / economia / etc.).
    // Multi-tag: an item lands in every category whose keywords match.
    // We keep `category` as the first match for any older client code
    // that reads the singular field; new code should prefer `categories`.
    for (const it of items) {
      it.categories = classify(it);
      it.category = it.categories[0];
    }

    // Sort newest first, then dedupe by URL + near-duplicate title.
    items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    items = dedupe(items);
    debug.dedupedCount = items.length;

    // Round-robin interleave by outlet. Without this, when Noroeste /
    // Latinus / Universal / Aristegui all dump 20 freshly-stamped
    // items at "now", the top of the feed is 20 Noroeste, then 20
    // Latinus, etc. — slow outlets never appear above the fold. We
    // bucket items per outlet (each bucket already in date order
    // because the global sort was stable) and walk the buckets in
    // lockstep, taking one item from each per pass until every
    // outlet runs out. Map insertion order = the date order in which
    // outlets first appeared in the sorted feed, so outlets with more
    // recent content lead each pass. No per-outlet cap — every item
    // makes it in (subject to the MAX_TOTAL_ITEMS hard cap), just
    // interleaved instead of clustered.
    const byOutlet = new Map();
    for (const it of items) {
      let arr = byOutlet.get(it.sourceId);
      if (!arr) { arr = []; byOutlet.set(it.sourceId, arr); }
      arr.push(it);
    }
    const interleaved = [];
    let progress = true;
    while (progress) {
      progress = false;
      for (const list of byOutlet.values()) {
        if (list.length === 0) continue;
        interleaved.push(list.shift());
        progress = true;
      }
    }
    items = interleaved.slice(0, MAX_TOTAL_ITEMS);
    debug.perOutletAfterInterleave = Object.fromEntries(
      Array.from(byOutlet.keys()).map(sid => [
        sid, items.filter(i => i.sourceId === sid).length,
      ]),
    );

    // Image enrichment: scrape og:image from the Google News
    // redirector page for items that don't have an image yet.
    // Bounded by IMAGE_ENRICH_TOP_N per refresh; results cached
    // forever (article og:image doesn't change).
    const imageStats = await enrichItemsWithImages(items);
    debug.imagesFetched = imageStats.fetched;
    debug.imagesCacheHits = imageStats.cached;
    debug.imageCacheSize = imageCache.size;

    // Per-category counts for the debug response. Multi-tag items
    // contribute to each of their categories.
    for (const it of items) {
      const cats = it.categories || [it.category];
      for (const c of cats) {
        debug.categoryCounts[c] = (debug.categoryCounts[c] || 0) + 1;
      }
    }

    cache = { fetchedAt: Date.now(), items, debug };
  } catch (e) {
    console.error('[news-mexico] refresh failed', { message: e?.message });
    debug.fatalError = e?.message || 'unknown';
    cache = { ...cache, debug };
  }
}

/**
 * Public: returns up to MAX_TOTAL_ITEMS news items, optionally filtered
 * by category. Featured = mixed across categories, sorted by date.
 */
export async function getMexicanNews({ category = 'featured', limit = MAX_TOTAL_ITEMS } = {}) {
  const now = Date.now();
  const cacheAge = now - (cache.fetchedAt || 0);
  const stale = cacheAge >= CACHE_TTL_MS;
  const empty = !cache.items?.length;

  if (empty) {
    if (!inFlight) inFlight = refreshCache().finally(() => { inFlight = null; });
    await inFlight;
  } else if (stale) {
    if (!inFlight) inFlight = refreshCache().finally(() => { inFlight = null; });
  }

  // Multi-tag counts: an item that matches both 'politica' and
  // 'seguridad' increments both totals.
  const counts = {};
  for (const it of cache.items) {
    const cats = it.categories || [it.category];
    for (const c of cats) counts[c] = (counts[c] || 0) + 1;
  }

  let filtered = cache.items;
  if (category && category !== 'featured') {
    filtered = cache.items.filter(it =>
      (it.categories || [it.category]).includes(category)
    );
  }
  filtered = filtered.slice(0, limit);

  return {
    fetchedAt: cache.fetchedAt ? new Date(cache.fetchedAt).toISOString() : null,
    cacheAgeMs: cacheAge,
    cacheTtlMs: CACHE_TTL_MS,
    items: filtered,
    counts,
    totalCount: cache.items.length,
    sources: OUTLETS.map(o => ({ id: o.id, name: o.name, lean: o.lean })),
    debug: cache.debug,
  };
}

export const VALID_CATEGORIES = NEWS_CATEGORIES;
