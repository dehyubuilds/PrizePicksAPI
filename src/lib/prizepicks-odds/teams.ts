/** PrizePicks abbreviations → a fragment of The Odds API team name. */

const ABBR: Record<string, string> = {
  ATL: "atlanta",
  BOS: "boston",
  BKN: "brooklyn",
  BRK: "brooklyn",
  CHA: "charlotte",
  CHI: "chicago",
  CLE: "cleveland",
  DAL: "dallas",
  DEN: "denver",
  DET: "detroit",
  GS: "golden state",
  GSW: "golden state",
  HOU: "houston",
  IND: "indiana",
  LA: "los angeles",
  LAC: "clippers",
  LAL: "lakers",
  MEM: "memphis",
  MIA: "miami",
  MIL: "milwaukee",
  MIN: "minnesota",
  NOP: "new orleans",
  NY: "new york",
  NYK: "new york",
  OKC: "oklahoma city",
  ORL: "orlando",
  PHI: "philadelphia",
  PHX: "phoenix",
  POR: "portland",
  SAC: "sacramento",
  SA: "san antonio",
  SAS: "san antonio",
  TOR: "toronto",
  UTA: "utah",
  WAS: "washington",
  WSH: "washington",
  LV: "las vegas",
  LVA: "las vegas",
  LVS: "las vegas",
  LAS: "los angeles",
  CON: "connecticut",
  SEA: "seattle",
  NYL: "new york",
  GSV: "golden state",
  ARI: "arizona",
  AZ: "arizona",
  BAL: "baltimore",
  BUF: "buffalo",
  CAR: "carolina",
  CIN: "cincinnati",
  GB: "green bay",
  JAX: "jacksonville",
  KC: "kansas city",
  LAR: "rams",
  NE: "new england",
  NO: "new orleans",
  NYG: "giants",
  NYJ: "jets",
  PIT: "pittsburgh",
  SF: "san francisco",
  TB: "tampa bay",
  TEN: "tennessee",
  COL: "colorado",
  CWS: "white sox",
  CHW: "white sox",
  CHC: "cubs",
  LAD: "dodgers",
  SD: "san diego",
  SDP: "san diego",
  SFG: "giants",
  NYY: "yankees",
  NYM: "mets",
  OAK: "athletics",
  ATH: "athletics",
  TEX: "texas",
  STL: "st louis",
  ANA: "anaheim",
  CBJ: "columbus",
  CGY: "calgary",
  EDM: "edmonton",
  FLA: "florida",
  LAK: "kings",
  MTL: "montreal",
  NJ: "new jersey",
  NJD: "new jersey",
  NSH: "nashville",
  OTT: "ottawa",
  SJS: "san jose",
  VAN: "vancouver",
  VGK: "vegas",
  WPG: "winnipeg",
};

function fold(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function teamMatches(ppTeam: string, oddsTeam: string): boolean {
  const odds = fold(oddsTeam);
  const pp = fold(ppTeam);
  if (!pp || !odds) return false;
  if (odds.includes(pp) || pp.includes(odds)) return true;
  const hint = ABBR[ppTeam.trim().toUpperCase()];
  return Boolean(hint && odds.includes(fold(hint)));
}

export function eventMatchesTeams(params: {
  team: string;
  opponent: string;
  home: string;
  away: string;
}): boolean {
  const homeHit = teamMatches(params.team, params.home) || teamMatches(params.opponent, params.home);
  const awayHit = teamMatches(params.team, params.away) || teamMatches(params.opponent, params.away);
  return homeHit && awayHit && params.home !== params.away;
}
