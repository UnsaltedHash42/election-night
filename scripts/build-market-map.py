"""Match each race in public/races.json to its Polymarket winner event, open or resolved.

Usage: python3 scripts/build-market-map.py
Writes public/market-map.json: {"<race id>": "<event slug>"}. Prices are read live in the browser.
"""
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE_NAMES = {
    'AL': 'alabama', 'AK': 'alaska', 'AZ': 'arizona', 'AR': 'arkansas', 'CA': 'california', 'CO': 'colorado',
    'CT': 'connecticut', 'DE': 'delaware', 'DC': 'district-of-columbia', 'FL': 'florida', 'GA': 'georgia',
    'HI': 'hawaii', 'ID': 'idaho', 'IL': 'illinois', 'IN': 'indiana', 'IA': 'iowa', 'KS': 'kansas',
    'KY': 'kentucky', 'LA': 'louisiana', 'ME': 'maine', 'MD': 'maryland', 'MA': 'massachusetts',
    'MI': 'michigan', 'MN': 'minnesota', 'MS': 'mississippi', 'MO': 'missouri', 'MT': 'montana',
    'NE': 'nebraska', 'NV': 'nevada', 'NH': 'new-hampshire', 'NJ': 'new-jersey', 'NM': 'new-mexico',
    'NY': 'new-york', 'NC': 'north-carolina', 'ND': 'north-dakota', 'OH': 'ohio', 'OK': 'oklahoma',
    'OR': 'oregon', 'PA': 'pennsylvania', 'RI': 'rhode-island', 'SC': 'south-carolina', 'SD': 'south-dakota',
    'TN': 'tennessee', 'TX': 'texas', 'UT': 'utah', 'VT': 'vermont', 'VA': 'virginia', 'WA': 'washington',
    'WV': 'west-virginia', 'WI': 'wisconsin', 'WY': 'wyoming',
}


def midterm_events() -> dict:
    events = {}
    for closed in ('false', 'true'):
        offset = 0
        while True:
            url = f'https://gamma-api.polymarket.com/events?tag_slug=midterms&closed={closed}&limit=100&offset={offset}'
            page = json.load(urllib.request.urlopen(url, timeout=30))
            for event in page:
                events.setdefault(event['slug'], event)
            if len(page) < 100:
                break
            offset += 100
    return events


def has_priced_markets(event: dict) -> bool:
    return any(market.get('active') and market.get('outcomePrices') and market.get('groupItemTitle') for market in event.get('markets', []))


def candidates(race: dict) -> list:
    state = race['state'].lower()
    name = STATE_NAMES[race['state']]
    if race['office'] == 'Senate':
        return [f'{name}-senate-election-winner', f'{name}-senate-election-winner-154', f'which-party-will-win-the-{name}-senate-in-2026']
    if race['office'] == 'Governor':
        return [f'{name}-governor-winner-2026', f'{name}-governor-election-winner-2026', f'{name}-governor-election-winner', f'{name}-governor-election-2026']
    district = int(race['id'].rsplit('-', 1)[1])
    seats = ['al', '01', '1', 'at-large'] if district == 0 else [f'{district:02}', str(district)]
    return [f'{state}-{seat}-house-election-winner' for seat in seats] + [f'which-party-will-win-the-house-race-for-the-{state}-{seat}-seat' for seat in seats]


def main() -> None:
    races = json.loads((ROOT / 'public/races.json').read_text())
    events = midterm_events()
    mapping = {}
    for race in races:
        bases = candidates(race)
        match = next((slug for slug in bases if slug in events and has_priced_markets(events[slug])), None)
        if not match:
            suffixed = re.compile(r'^(?:' + '|'.join(map(re.escape, bases)) + r')(?:-individual)?-\d{14,}$')
            match = next((slug for slug in sorted(events) if suffixed.match(slug) and not events[slug].get('closed') and has_priced_markets(events[slug])), None)
        if match:
            mapping[race['id']] = match
    (ROOT / 'public/market-map.json').write_text(json.dumps(mapping, sort_keys=True, separators=(',', ':')) + '\n')
    missing = [race['id'] for race in races if race['id'] not in mapping]
    print(f'{len(mapping)} of {len(races)} races matched; {len(missing)} without a winner market')
    print('unmatched:', ' '.join(missing))


if __name__ == '__main__':
    main()
