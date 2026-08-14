const asset = (path) => `${import.meta.env.BASE_URL || '/points/'}${path}`;

export const investorDeckManifest = {
  es: {
    languageLabel: 'Español',
    title: 'Pronos',
    subtitle: 'Deck para inversionistas',
    sourcePdf: asset('decks/pronos-es/pronos-deck-es.pdf'),
    slides: [
      { title: 'Pronos', image: asset('decks/pronos-es/slide-01.png') },
      { title: 'Las apuestas en Latam están rotas', image: asset('decks/pronos-es/slide-02.png') },
      { title: 'Por qué ahora', image: asset('decks/pronos-es/slide-03.png') },
      { title: 'El producto', image: asset('decks/pronos-es/slide-04.png') },
      { title: 'Tracción', image: asset('decks/pronos-es/slide-05.png') },
      { title: 'Mercado', image: asset('decks/pronos-es/slide-06.png') },
      { title: 'Modelo de negocio', image: asset('decks/pronos-es/slide-07.png') },
      { title: 'Competencia', image: asset('decks/pronos-es/slide-08.png') },
      { title: 'Go-to-market', image: asset('decks/pronos-es/slide-09.png') },
      { title: 'Legal y regulatorio', image: asset('decks/pronos-es/slide-10.png') },
      { title: 'Proyecciones financieras', image: asset('decks/pronos-es/slide-11.png') },
      { title: 'Equipo', image: asset('decks/pronos-es/slide-12.png') },
      { title: '$750K Pre-Seed', image: asset('decks/pronos-es/slide-13.png') },
    ],
  },
  en: {
    languageLabel: 'English',
    title: 'Pronos',
    subtitle: 'Investor deck',
    sourcePdf: asset('decks/pronos-en/pronos-deck-en.pdf'),
    slides: [
      { title: 'Pronos', image: asset('decks/pronos-en/slide-01.png') },
      { title: 'Betting in Latam is Broken', image: asset('decks/pronos-en/slide-02.png') },
      { title: 'Why Now', image: asset('decks/pronos-en/slide-03.png') },
      { title: 'The Product', image: asset('decks/pronos-en/slide-04.png') },
      { title: 'Traction', image: asset('decks/pronos-en/slide-05.png') },
      { title: 'Market', image: asset('decks/pronos-en/slide-06.png') },
      { title: 'Business Model', image: asset('decks/pronos-en/slide-07.png') },
      { title: 'Competition', image: asset('decks/pronos-en/slide-08.png') },
      { title: 'Go-to-Market', image: asset('decks/pronos-en/slide-09.png') },
      { title: 'Legal & Regulatory', image: asset('decks/pronos-en/slide-10.png') },
      { title: 'Financial Projections', image: asset('decks/pronos-en/slide-11.png') },
      { title: 'Team', image: asset('decks/pronos-en/slide-12.png') },
      { title: '$750K Pre-Seed', image: asset('decks/pronos-en/slide-13.png') },
    ],
  },
};

export function getInvestorDeck(language) {
  return investorDeckManifest[language] || investorDeckManifest.en;
}
