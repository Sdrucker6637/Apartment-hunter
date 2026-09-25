// NYC-area neighborhoods and the ways people write them in posts.
// Order does not matter: matching always prefers the longest alias, so
// "East Harlem" wins over "Harlem" and "East Williamsburg" over "Williamsburg".

export const NEIGHBORHOODS = [
  // Manhattan
  { name: 'Financial District', borough: 'Manhattan', aliases: ['financial district', 'fidi'] },
  { name: 'Battery Park City', borough: 'Manhattan', aliases: ['battery park city', 'battery park'] },
  { name: 'Tribeca', borough: 'Manhattan', aliases: ['tribeca'] },
  { name: 'SoHo', borough: 'Manhattan', aliases: ['soho'] },
  { name: 'NoHo', borough: 'Manhattan', aliases: ['noho'] },
  { name: 'Nolita', borough: 'Manhattan', aliases: ['nolita'] },
  { name: 'Chinatown', borough: 'Manhattan', aliases: ['chinatown'] },
  { name: 'Two Bridges', borough: 'Manhattan', aliases: ['two bridges'] },
  { name: 'Lower East Side', borough: 'Manhattan', aliases: ['lower east side', 'les'] },
  { name: 'East Village', borough: 'Manhattan', aliases: ['east village', 'alphabet city'] },
  { name: 'West Village', borough: 'Manhattan', aliases: ['west village'] },
  { name: 'Greenwich Village', borough: 'Manhattan', aliases: ['greenwich village'] },
  { name: 'Chelsea', borough: 'Manhattan', aliases: ['chelsea'] },
  { name: 'Flatiron', borough: 'Manhattan', aliases: ['flatiron'] },
  { name: 'Gramercy', borough: 'Manhattan', aliases: ['gramercy'] },
  { name: 'Union Square', borough: 'Manhattan', aliases: ['union square'] },
  { name: 'Stuyvesant Town', borough: 'Manhattan', aliases: ['stuyvesant town', 'stuy town', 'stuytown', 'peter cooper village'] },
  { name: 'Kips Bay', borough: 'Manhattan', aliases: ['kips bay'] },
  { name: 'Murray Hill', borough: 'Manhattan', aliases: ['murray hill'] },
  { name: 'NoMad', borough: 'Manhattan', aliases: ['nomad'] },
  { name: 'Koreatown', borough: 'Manhattan', aliases: ['koreatown', 'k-town', 'ktown'] },
  { name: 'Midtown', borough: 'Manhattan', aliases: ['midtown', 'midtown east', 'midtown west', 'turtle bay', 'sutton place'] },
  { name: "Hell's Kitchen", borough: 'Manhattan', aliases: ["hell's kitchen", 'hells kitchen', 'hell’s kitchen', 'clinton'] },
  { name: 'Upper West Side', borough: 'Manhattan', aliases: ['upper west side', 'uws'] },
  { name: 'Upper East Side', borough: 'Manhattan', aliases: ['upper east side', 'ues', 'yorkville', 'lenox hill'] },
  { name: 'Morningside Heights', borough: 'Manhattan', aliases: ['morningside heights', 'morningside'] },
  { name: 'Harlem', borough: 'Manhattan', aliases: ['harlem', 'central harlem', 'south harlem', 'sugar hill'] },
  { name: 'East Harlem', borough: 'Manhattan', aliases: ['east harlem', 'spanish harlem', 'el barrio'] },
  { name: 'Hamilton Heights', borough: 'Manhattan', aliases: ['hamilton heights'] },
  { name: 'Washington Heights', borough: 'Manhattan', aliases: ['washington heights', 'wash heights', 'wahi'] },
  { name: 'Inwood', borough: 'Manhattan', aliases: ['inwood'] },
  { name: 'Roosevelt Island', borough: 'Manhattan', aliases: ['roosevelt island'] },
  { name: 'Columbus Circle', borough: 'Manhattan', aliases: ['columbus circle'] },

  // Brooklyn
  { name: 'Williamsburg', borough: 'Brooklyn', aliases: ['williamsburg', 'wburg', 'billyburg'] },
  { name: 'East Williamsburg', borough: 'Brooklyn', aliases: ['east williamsburg', 'east wburg'] },
  { name: 'Greenpoint', borough: 'Brooklyn', aliases: ['greenpoint'] },
  { name: 'Bushwick', borough: 'Brooklyn', aliases: ['bushwick'] },
  { name: 'Bedford-Stuyvesant', borough: 'Brooklyn', aliases: ['bedford-stuyvesant', 'bedford stuyvesant', 'bed-stuy', 'bed stuy', 'bedstuy'] },
  { name: 'Clinton Hill', borough: 'Brooklyn', aliases: ['clinton hill'] },
  { name: 'Fort Greene', borough: 'Brooklyn', aliases: ['fort greene', 'ft greene', 'ft. greene'] },
  { name: 'Prospect Heights', borough: 'Brooklyn', aliases: ['prospect heights'] },
  { name: 'Crown Heights', borough: 'Brooklyn', aliases: ['crown heights'] },
  { name: 'Prospect Lefferts Gardens', borough: 'Brooklyn', aliases: ['prospect lefferts gardens', 'prospect lefferts', 'lefferts gardens', 'plg'] },
  { name: 'Flatbush', borough: 'Brooklyn', aliases: ['flatbush', 'east flatbush'] },
  { name: 'Ditmas Park', borough: 'Brooklyn', aliases: ['ditmas park', 'ditmas'] },
  { name: 'Kensington', borough: 'Brooklyn', aliases: ['kensington'] },
  { name: 'Windsor Terrace', borough: 'Brooklyn', aliases: ['windsor terrace'] },
  { name: 'Park Slope', borough: 'Brooklyn', aliases: ['park slope', 'south slope'] },
  { name: 'Gowanus', borough: 'Brooklyn', aliases: ['gowanus'] },
  { name: 'Carroll Gardens', borough: 'Brooklyn', aliases: ['carroll gardens'] },
  { name: 'Cobble Hill', borough: 'Brooklyn', aliases: ['cobble hill'] },
  { name: 'Boerum Hill', borough: 'Brooklyn', aliases: ['boerum hill'] },
  { name: 'Brooklyn Heights', borough: 'Brooklyn', aliases: ['brooklyn heights'] },
  { name: 'DUMBO', borough: 'Brooklyn', aliases: ['dumbo', 'vinegar hill'] },
  { name: 'Bath Beach', borough: 'Brooklyn', aliases: ['bath beach'] },
  { name: 'Downtown Brooklyn', borough: 'Brooklyn', aliases: ['downtown brooklyn'] },
  { name: 'Red Hook', borough: 'Brooklyn', aliases: ['red hook'] },
  { name: 'Sunset Park', borough: 'Brooklyn', aliases: ['sunset park'] },
  { name: 'Bay Ridge', borough: 'Brooklyn', aliases: ['bay ridge'] },
  { name: 'Borough Park', borough: 'Brooklyn', aliases: ['borough park', 'boro park'] },
  { name: 'Bensonhurst', borough: 'Brooklyn', aliases: ['bensonhurst'] },
  { name: 'Midwood', borough: 'Brooklyn', aliases: ['midwood'] },
  { name: 'Sheepshead Bay', borough: 'Brooklyn', aliases: ['sheepshead bay'] },
  { name: 'Brighton Beach', borough: 'Brooklyn', aliases: ['brighton beach'] },
  { name: 'Ocean Hill', borough: 'Brooklyn', aliases: ['ocean hill'] },
  { name: 'Cypress Hills', borough: 'Brooklyn', aliases: ['cypress hills'] },

  // Queens
  { name: 'Astoria', borough: 'Queens', aliases: ['astoria', 'ditmars'] },
  { name: 'Long Island City', borough: 'Queens', aliases: ['long island city', 'lic'] },
  { name: 'Sunnyside', borough: 'Queens', aliases: ['sunnyside'] },
  { name: 'Woodside', borough: 'Queens', aliases: ['woodside'] },
  { name: 'Jackson Heights', borough: 'Queens', aliases: ['jackson heights'] },
  { name: 'Elmhurst', borough: 'Queens', aliases: ['elmhurst'] },
  { name: 'Ridgewood', borough: 'Queens', aliases: ['ridgewood'] },
  { name: 'Maspeth', borough: 'Queens', aliases: ['maspeth'] },
  { name: 'Forest Hills', borough: 'Queens', aliases: ['forest hills'] },
  { name: 'Rego Park', borough: 'Queens', aliases: ['rego park'] },
  { name: 'Flushing', borough: 'Queens', aliases: ['flushing'] },
  { name: 'Kew Gardens', borough: 'Queens', aliases: ['kew gardens'] },
  { name: 'Jamaica', borough: 'Queens', aliases: ['jamaica'] },
  { name: 'Corona', borough: 'Queens', aliases: ['corona'] },
  { name: 'Glendale', borough: 'Queens', aliases: ['glendale'] },

  // Bronx
  { name: 'Mott Haven', borough: 'Bronx', aliases: ['mott haven'] },
  { name: 'Riverdale', borough: 'Bronx', aliases: ['riverdale'] },
  { name: 'Kingsbridge', borough: 'Bronx', aliases: ['kingsbridge'] },
  { name: 'Fordham', borough: 'Bronx', aliases: ['fordham'] },
  { name: 'Concourse', borough: 'Bronx', aliases: ['grand concourse', 'concourse'] },
  { name: 'Pelham Bay', borough: 'Bronx', aliases: ['pelham bay'] },

  // Staten Island
  { name: 'St. George', borough: 'Staten Island', aliases: ['st. george', 'st george', 'saint george'] },

  // Across the river (common in NYC roommate groups)
  { name: 'Jersey City', borough: 'New Jersey', aliases: ['jersey city', 'jc heights', 'journal square', 'newport'] },
  { name: 'Union City', borough: 'New Jersey', aliases: ['union city'] },
  { name: 'Hoboken', borough: 'New Jersey', aliases: ['hoboken'] },
];

export const BOROUGHS = [
  { name: 'Manhattan', aliases: ['manhattan'] },
  { name: 'Brooklyn', aliases: ['brooklyn', 'bk'] },
  { name: 'Queens', aliases: ['queens'] },
  { name: 'Bronx', aliases: ['bronx', 'the bronx'] },
  { name: 'Staten Island', aliases: ['staten island'] },
];

// Aliases that are also everyday words/abbreviations: only trust them when
// written in capitals (e.g. "LES", "LIC", "UWS") so "les" or "bk" in normal
// prose, or "Clinton" as a surname, is not misread.
const CASE_SENSITIVE = new Set(['les', 'lic', 'uws', 'ues', 'plg', 'bk', 'fidi', 'clinton', 'corona', 'jamaica']);

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMatchers(entries) {
  const out = [];
  for (const entry of entries) {
    for (const alias of entry.aliases) {
      const caseSensitive = CASE_SENSITIVE.has(alias);
      const pattern = caseSensitive
        ? (alias === 'clinton' || alias === 'corona' || alias === 'jamaica'
          ? alias[0].toUpperCase() + alias.slice(1)
          : alias.toUpperCase())
        : alias;
      const re = new RegExp(`(?<![\\w'’])${escapeRe(pattern).replace(/\\?[-\s]/g, '[-\\s]?')}(?![\\w'’])`, caseSensitive ? '' : 'i');
      out.push({ entry, alias, re });
    }
  }
  // Longest alias first so more specific names win ties at the same position.
  return out.sort((a, b) => b.alias.length - a.alias.length);
}

const HOOD_MATCHERS = buildMatchers(NEIGHBORHOODS);
const BOROUGH_MATCHERS = buildMatchers(BOROUGHS);

// "20 minutes to Midtown", "close to Williamsburg", "one stop from LES" describe
// a commute, not where the listing is.
const TRAVEL_BEFORE = /(?:\bto|\bfrom|\bnear|\bclose\s+to|\bcommute|\bride|\bstops?|\bminutes?|\bmins?|\bwalk(?:ing)?|\bborder(?:ing|s)?|\bnext\s+to|\baway\s+from)\s+(?:(?!in\b|at\b|on\b|located\b)[\w.'’]+\s+){0,4}$/i;

function earliest(matchers, text) {
  let best = null;
  for (const m of matchers) {
    const g = new RegExp(m.re.source, m.re.flags.includes('g') ? m.re.flags : `${m.re.flags}g`);
    let hit = null;
    for (const h of text.matchAll(g)) {
      if (!TRAVEL_BEFORE.test(text.slice(Math.max(0, h.index - 50), h.index))) { hit = h; break; }
    }
    if (!hit) continue;
    // Earliest mention wins; for equal positions the longer alias (sorted first) wins.
    if (!best || hit.index < best.index) best = { entry: m.entry, index: hit.index };
  }
  return best?.entry ?? null;
}

// Returns { neighborhood, borough } — either may be null.
export function findNeighborhood(...texts) {
  for (const text of texts) {
    if (!text) continue;
    const hood = earliest(HOOD_MATCHERS, text);
    if (hood) return { neighborhood: hood.name, borough: hood.borough };
  }
  for (const text of texts) {
    if (!text) continue;
    const boro = earliest(BOROUGH_MATCHERS, text);
    if (boro) return { neighborhood: null, borough: boro.name };
  }
  return { neighborhood: null, borough: null };
}
