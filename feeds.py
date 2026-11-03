import copy
import csv
import gzip
import io
import json
import re
import threading
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path


ELECTION_DATE = '2026-11-03'
PARTIES = {'D': 'DEM', 'DEM': 'DEM', 'R': 'REP', 'REP': 'REP', 'GOP': 'REP', 'I': 'IND', 'IND': 'IND', 'UNA': 'IND', 'L': 'LIB', 'LIB': 'LIB', 'G': 'GRN', 'GRN': 'GRN'}
SOURCE_URLS = {
    'nc': 'https://www.ncsbe.gov/results-data/election-results',
    'va': 'https://enr.elections.virginia.gov/results/public/virginia/elections/2026-November-General',
    'az': 'https://results.arizona.vote/',
    'ca': 'https://electionresults.sos.ca.gov/',
    'npr': 'https://apps.npr.org/2026-election-results/',
    'sherwood': 'https://arkansas.tally-enr.com/',
}
ARKANSAS_ELECTION = '11b07106-031e-4d7c-911a-d01fb473d6dd'


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def vote_number(value) -> int:
    if isinstance(value, bool) or not re.fullmatch(r'\d+', str(value).replace(',', '')):
        raise ValueError('Invalid vote count')
    return int(str(value).replace(',', ''))


def party(value) -> str:
    value = (value or '').strip().upper()
    return PARTIES.get(value, value or 'OTHER')


def english(items) -> str:
    if not isinstance(items, list):
        raise ValueError('Missing English label')
    return next(item['text'].strip() for item in items if item.get('languageId') == 'en')


def race_identity(state: str, name: str):
    upper = name.upper().replace('U.S.', 'US').replace('UNITED STATES', 'US')
    if 'US SENATE' in upper:
        return f'{state}-Senate', 'Senate', 'U.S. Senate'
    if ('HOUSE OF REPRESENTATIVES' in upper or 'REPRESENTATIVE IN CONGRESS' in upper or 'US REPRESENTATIVE' in upper) and 'STATE HOUSE' not in upper:
        match = re.search(r'(\d+)(?:ST|ND|RD|TH)?\s+DISTRICT|DISTRICT(?:\s+NO\.?)?\s*(\d+)', upper)
        if match:
            district = int(next(value for value in match.groups() if value))
            return f'{state}-House-{district:02}', 'House', f'U.S. House · District {district}'
    if upper.startswith('GOVERNOR'):
        return f'{state}-Governor', 'Governor', name.title()
    return None


def make_race(identity, state: str, source_id: str, candidates: list, total=None, reporting=None) -> dict:
    if not candidates:
        raise ValueError('Race has no candidate data')
    summed = sum(candidate['votes'] for candidate in candidates)
    if total is not None and vote_number(total) != summed:
        raise ValueError('Candidate totals do not match reported race total')
    return {
        'id': identity[0], 'state': state, 'office': identity[1], 'name': identity[2],
        'sourceId': source_id, 'sourceUrl': SOURCE_URLS.get(source_id, 'https://openamerica.io/elections/api/'),
        'candidates': sorted(candidates, key=lambda candidate: -candidate['votes']),
        'totalVotes': summed, 'reporting': reporting, 'status': 'reporting' if summed else 'awaiting',
    }


def parse_nc(payload: bytes):
    contests = {}
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        names = [name for name in archive.namelist() if name.endswith('.txt')]
        if len(names) != 1 or archive.getinfo(names[0]).file_size > 100_000_000:
            raise ValueError('Unexpected NC archive')
        with archive.open(names[0]) as raw:
            reader = csv.DictReader(io.TextIOWrapper(raw, encoding='utf-8-sig'), delimiter='\t')
            required = {'Election Date', 'Contest Name', 'Choice', 'Choice Party', 'Total Votes'}
            if not required.issubset(reader.fieldnames or []):
                raise ValueError('NC columns changed')
            for row in reader:
                if row['Election Date'] != '11/03/2026':
                    raise ValueError('Unexpected NC election date')
                name = row['Contest Name']
                if not name.startswith(('US SENATE', 'US HOUSE OF REPRESENTATIVES')):
                    continue
                identity = race_identity('NC', name)
                if not identity:
                    raise ValueError('Unrecognized NC federal race')
                contest = contests.setdefault(identity[0], {'identity': identity, 'candidates': {}})
                key = (row['Choice'].strip(), party(row['Choice Party']))
                candidate = contest['candidates'].setdefault(key, {'id': '|'.join(key), 'name': key[0], 'party': key[1], 'votes': 0})
                candidate['votes'] += vote_number(row['Total Votes'])
    if not contests:
        raise ValueError('NC file contains no federal races')
    return [make_race(c['identity'], 'NC', 'nc', list(c['candidates'].values())) for c in contests.values()], None


def parse_enhanced(data: dict, state: str):
    election = data['election']
    if election.get('electionDate') != ELECTION_DATE or election.get('isProduction') is not True or election.get('isPrimary'):
        raise ValueError('Wrong election or non-production feed')
    races = []
    for item in data['ballotItems']:
        identity = race_identity(state, english(item['name']))
        if not identity:
            continue
        candidates = [{
            'id': candidate['id'], 'name': english(candidate['name']),
            'party': party((candidate.get('party') or {}).get('abbreviation')),
            'votes': vote_number(candidate['voteCount']),
        } for candidate in item['summaryResults']['ballotOptions']]
        status = item.get('reportingStatus')
        reporting = None
        if status and status.get('totalUnits') is not None:
            reporting = {'count': vote_number(status['reportingUnits']), 'total': vote_number(status['totalUnits']), 'label': 'localities' if state == 'VA' else 'counties'}
        races.append(make_race(identity, state, state.lower(), candidates, item['voteTotal'], reporting))
    if not races:
        raise ValueError('No supported federal or governor races')
    return races, election.get('asOf')


def parse_california(data: list, office: str):
    races = []
    for item in data:
        title = item['raceTitle']
        if office == 'Governor':
            if title != 'Governor - Statewide Results':
                continue
            identity = ('CA-Governor', 'Governor', 'Governor')
        else:
            if not title.endswith(' - Districtwide Results'):
                continue
            match = re.search(r'District\s+(\d+)', title)
            if not match:
                raise ValueError('Unrecognized California district')
            district = int(match.group(1))
            identity = (f'CA-House-{district:02}', 'House', f'U.S. House · District {district}')
        candidates = [{'id': candidate['Name'], 'name': candidate['Name'], 'party': party(candidate['Party']), 'votes': vote_number(candidate['Votes'])} for candidate in item['candidates']]
        match = re.search(r'\(([\d,]+) of ([\d,]+)\)', item.get('Reporting', ''))
        reporting = {'count': vote_number(match.group(1)), 'total': vote_number(match.group(2)), 'label': 'precincts'} if match else None
        races.append(make_race(identity, 'CA', 'ca', candidates, reporting=reporting))
    if not races:
        raise ValueError('California summary rows missing')
    return races, None


def parse_openamerica(data: dict, office: str):
    if data.get('api') != 1 or data.get('year') != 2026 or data.get('office') != office:
        raise ValueError('Unsupported API version, election year or office')
    races = []
    for seat, item in data['races'].items():
        if not re.fullmatch(r'[A-Z]{2}(?:-\d{2}|-special)?', seat):
            raise ValueError('Unrecognized seat key')
        state = seat[:2]
        if office == 'House':
            if not re.fullmatch(r'[A-Z]{2}-\d{2}', seat):
                raise ValueError('Missing House district')
            district = int(seat[3:])
            identity = (f'{state}-House-{district:02}', 'House', f'U.S. House · District {district}' if district else 'U.S. House · At large')
        else:
            suffix = '-special' if seat.endswith('-special') else ''
            identity = (f'{state}-{office}{suffix}', office, ('U.S. Senate' if office == 'Senate' else 'Governor') + (' · Special election' if suffix else ''))
        candidates = [{'id': candidate['n'] + '|' + candidate['p'], 'name': candidate['n'], 'party': party(candidate['p']), 'votes': vote_number(candidate['v'])} for candidate in item['cands']]
        race = make_race(identity, state, 'oa-' + office.lower(), candidates, item['total'])
        race['sourceAsOf'] = data.get('as_of')
        races.append(race)
    return races, data.get('as_of')


def parse_npr(data: dict, office: str):
    office_code = {'House': 'H', 'Senate': 'S', 'Governor': 'G'}[office]
    races = []
    timestamps = []
    for item in data['results']:
        if item.get('test') is not False or item.get('resultsType') not in ('live', 'certified') or item.get('office') != office_code or item.get('type') not in ('General', 'Special General', 'Nonpartisan Election'):
            raise ValueError('Unexpected NPR live election type')
        timestamp = datetime.fromtimestamp(item['updated'] / 1000, timezone.utc)
        if timestamp.year != 2026:
            raise ValueError('Unexpected NPR election year')
        timestamps.append(timestamp.isoformat())
        state = item['state']
        if office == 'House':
            district = int(item['seatNumber'])
            if state in ('AK', 'DE', 'ND', 'SD', 'VT', 'WY'):
                district = 0
            identity = (f'{state}-House-{district:02}', office, f'U.S. House · District {district}' if district else 'U.S. House · At large')
        else:
            special = item['type'] == 'Special General'
            identity = (f'{state}-{office}' + ('-special' if special else ''), office, ('U.S. Senate' if office == 'Senate' else 'Governor') + (' · Special election' if special else ''))
        candidates = []
        winners = []
        for candidate in item['candidates']:
            name = (candidate.get('first', '') + ' ' + candidate['last']).strip()
            if name == 'Other':
                name = 'Other candidates'
            parsed = {'id': str(candidate['id']), 'name': name, 'party': party(candidate['party']), 'votes': vote_number(candidate['votes'])}
            candidates.append(parsed)
            if candidate.get('winner') == 'X':
                winners.append((parsed, candidate))
        if len(winners) > 1:
            raise ValueError('Multiple called winners for one seat')
        reporting = None
        if item.get('reporting') is not None and item.get('precincts') is not None:
            reporting = {'count': vote_number(item['reporting']), 'total': vote_number(item['precincts']), 'label': 'precincts'}
        race = make_race(identity, state, 'npr', candidates, reporting=reporting)
        winner = winners[0][0] if winners else None
        previous = party(item.get('previousParty'))
        race.update(called=bool(winner), winnerParty=winner['party'] if winner else None,
                    winnerName=winner['name'] if winner else None, previousParty=previous,
                    flip=bool(winner and previous != 'OTHER' and winner['party'] != previous),
                    keyRace=item.get('keyRace') == 'yes', sourceAsOf=timestamp.isoformat(),
                    caucusWith=party(item.get('caucusWith')), rating=item.get('rating'))
        if winner:
            race['callAt'] = winners[0][1].get('winnerDateTime')
        races.append(race)
    if not races:
        raise ValueError('NPR returned no races')
    return races, max(timestamps)


def parse_sherwood(metadata: dict, payloads: list):
    if metadata.get('electionID') != ARKANSAS_ELECTION:
        raise ValueError('Wrong Arkansas election metadata')
    races, times = [], []
    for payload in payloads:
        if payload.get('electionID') != ARKANSAS_ELECTION:
            raise ValueError('Wrong Arkansas election results')
        item = payload['response']
        contest = metadata['response']['contests'][item['contestID']]
        if not contest['contestName'].startswith('Sherwood '):
            raise ValueError('Unexpected local contest')
        candidates = []
        for choice in item['choices']:
            name = contest['choices'][choice['choiceID']]['name']
            prefix, _, rest = name.partition(' ')
            has_party = prefix in ('DEM', 'REP', 'IND', 'LIB')
            candidates.append({'id': choice['choiceID'], 'name': rest if has_party else name, 'party': prefix if has_party else 'OTHER', 'votes': vote_number(choice['totalVotes'])})
        for choice in item.get('writeinChoices', []):
            candidates.append({'id': choice['choiceID'], 'name': choice.get('name', 'Write-in'), 'party': 'OTHER', 'votes': vote_number(choice['totalVotes'])})
        reporting = {'count': vote_number(item['precinctsReporting']), 'total': vote_number(item['totalPrecincts']), 'label': 'precincts'}
        race = make_race(('AR-local-' + item['contestID'], 'Other', contest['contestName']), 'AR', 'sherwood', candidates, item['totalVotes'], reporting)
        race['sourceUrl'] = 'https://arkansas.tally-enr.com/#bucket=results&contest=' + item['contestID']
        races.append(race)
        if payload.get('lastUpdated'):
            times.append(payload['lastUpdated'])
    if not races:
        raise ValueError('Sherwood races missing')
    return races, max(times) if times else None


def chamber_summary(races: list, source: dict) -> list:
    result = []
    for office, total, up in [('House', 435, 435), ('Senate', 100, 35)]:
        rows = [race for race in races if race['office'] == office and race['sourceId'] == 'npr']
        # NPR's 2026 app lists 32 D, 31 R, and 2 D-caucusing independent holdovers.
        dem, rep, other = (34, 31, 0) if office == 'Senate' else (0, 0, 0)
        calls = 0
        for race in rows:
            if not race.get('called'):
                continue
            calls += 1
            winner = race['winnerParty']
            caucus = race.get('caucusWith')
            if winner == 'DEM' or (winner not in ('DEM', 'REP') and caucus == 'DEM'):
                dem += 1
            elif winner == 'REP' or (winner not in ('DEM', 'REP') and caucus == 'REP'):
                rep += 1
            else:
                other += 1
        result.append({'office': office, 'total': total, 'majority': 218 if office == 'House' else 51,
                       'dem': dem if rows else None, 'rep': rep if rows else None, 'other': other if rows else None,
                       'uncalled': up - calls if rows else None, 'loaded': len(rows), 'expected': up,
                       'source': 'AP via NPR', 'sourceId': 'npr', 'url': SOURCE_URLS['npr'],
                       'asOf': source.get('sourceUpdatedAt'), 'status': source.get('status', 'waiting'),
                       'note': 'Includes 65 seats not up tonight; D includes 2 independent holdovers. A 50–50 tie depends on the vice president.' if office == 'Senate' else f'{len(rows)} of 435 race feeds loaded; missing races remain uncalled.'})
    return result


def merged_races(sources: dict) -> list:
    merged = {}
    for source_id in sorted(sources, key=lambda value: (value == 'npr', not value.startswith('oa-'), value)):
        for race in sources[source_id]['races']:
            merged[race['id']] = race
    return list(merged.values())


class FeedStore:
    def __init__(self, directory: Path):
        self.directory = directory
        self.lock = threading.RLock()
        self.sources = {}
        directory.mkdir(parents=True, exist_ok=True)
        for path in directory.glob('feed-*.json'):
            try:
                data = json.loads(path.read_text())
                if data['electionDate'] == ELECTION_DATE:
                    self.sources[path.stem[5:]] = data
                    data['status'] = 'loading'
            except (ValueError, KeyError, OSError):
                continue

    def snapshot(self) -> dict:
        with self.lock:
            return copy.deepcopy(self.sources)

    def success(self, source_id: str, races: list, source_time: str, now: str, warning=None) -> None:
        with self.lock:
            prior = self.sources.get(source_id, {})
            old_races = {race['id']: race for race in prior.get('races', [])}
            for race in races:
                old = old_races.get(race['id'])
                unchanged = old and old['candidates'] == race['candidates'] and old['reporting'] == race['reporting']
                race['updatedAt'] = old['updatedAt'] if unchanged else now
                history = copy.deepcopy(old.get('history', [])) if old else []
                if not unchanged and race['totalVotes']:
                    ordered = race['candidates']
                    margin = ordered[0]['votes'] - (ordered[1]['votes'] if len(ordered) > 1 else 0)
                    history.append({'at': now, 'totalVotes': race['totalVotes'], 'marginVotes': margin})
                race['history'] = history[-60:]
            value = {'electionDate': ELECTION_DATE, 'races': races, 'sourceUpdatedAt': source_time, 'lastSuccess': now, 'lastAttempt': now, 'status': 'error' if warning else 'ok', 'error': warning}
            self.sources[source_id] = value
            destination = self.directory / f'feed-{source_id}.json'
            temporary = destination.with_suffix('.tmp')
            temporary.write_text(json.dumps(value))
            temporary.replace(destination)

    def failure(self, source_id: str, error: str, now: str) -> None:
        with self.lock:
            value = self.sources.setdefault(source_id, {'races': [], 'lastSuccess': None, 'sourceUpdatedAt': None})
            value.update(status='error', error=error, lastAttempt=now)


class PublicClient:
    def __init__(self):
        self.cache = {}

    def get(self, url: str):
        previous = self.cache.get(url)
        headers = {'User-Agent': 'PersonalElectionNightDashboard/1.0', 'Accept-Encoding': 'gzip'}
        if previous and previous[2]:
            headers['If-None-Match'] = previous[2]
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                payload = response.read(100_000_001)
                if len(payload) > 100_000_000:
                    raise ValueError('Feed larger than expected')
                if response.headers.get('Content-Encoding') == 'gzip':
                    payload = gzip.decompress(payload)
                modified = response.headers.get('Last-Modified')
                timestamp = parsedate_to_datetime(modified).isoformat() if modified else None
                result = (payload, timestamp, response.headers.get('ETag'))
                self.cache[url] = result
                return result[:2]
        except urllib.error.HTTPError as error:
            if error.code == 304 and previous:
                return previous[:2]
            raise
