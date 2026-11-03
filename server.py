import argparse
import json
import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from feeds import (FeedStore, PublicClient, SOURCE_URLS, ELECTION_DATE, utc_now,
                   parse_nc, parse_enhanced, parse_california, parse_openamerica,
                   parse_npr, parse_sherwood, ARKANSAS_ELECTION, merged_races, chamber_summary)


ROOT = Path(__file__).resolve().parent
SOURCES = [
    {'id': 'npr', 'label': 'AP via NPR · National results & calls', 'url': SOURCE_URLS['npr'], 'coverage': 'House, Senate and 36 governor races; public website feed', 'pollIntervalSeconds': 120},
    {'id': 'nc', 'label': 'North Carolina Board of Elections', 'url': SOURCE_URLS['nc'], 'coverage': 'Senate and House; direct official totals', 'pollIntervalSeconds': 60},
    {'id': 'va', 'label': 'Virginia Department of Elections', 'url': SOURCE_URLS['va'], 'coverage': 'Senate and House; direct official totals', 'pollIntervalSeconds': 60},
    {'id': 'az', 'label': 'Arizona Secretary of State', 'url': SOURCE_URLS['az'], 'coverage': 'House and governor; direct official totals', 'pollIntervalSeconds': 120},
    {'id': 'ca', 'label': 'California Secretary of State', 'url': SOURCE_URLS['ca'], 'coverage': 'House and governor; direct official totals', 'pollIntervalSeconds': 120},
    {'id': 'sherwood', 'label': 'Sherwood · Arkansas official results', 'url': SOURCE_URLS['sherwood'], 'coverage': 'Mayor and city council races; unofficial totals', 'pollIntervalSeconds': 120},
] + [{'id': 'oa-' + office.lower(), 'label': 'Official state election offices via Open America · ' + office,
      'url': 'https://openamerica.io/elections/api/', 'coverage': 'Supplemental totals from 22 states when published; newest office-wide source timestamp', 'pollIntervalSeconds': 600}
     for office in ['House', 'Senate', 'Governor']]

LINKS = [
    {'label': 'AP national results', 'url': 'https://apnews.com/projects/elections-2026/', 'description': 'National results and race calls'},
    {'label': 'NPR national results', 'url': SOURCE_URLS['npr'], 'description': 'AP calls, House and Senate control'},
    {'label': 'Decision Desk HQ', 'url': 'https://votes.decisiondeskhq.com/', 'description': 'Independent results and race calls'},
    {'label': 'Arkansas official results', 'url': 'https://arkansas.tally-enr.com/#bucket=results&filter=Federal&contest=eafd140a-9378-43a2-bd6d-f8661524139b', 'description': 'Statewide, legislative and ballot questions', 'state': 'AR'},
    {'label': 'Sherwood / Pulaski local races', 'url': 'https://votes.decisiondeskhq.com/elections/2026-11-03/arkansas/pulaski', 'description': 'Sherwood mayor and wards; DDHQ local results', 'state': 'AR'},
    {'label': 'Pulaski County official results', 'url': 'https://votepulaskiar.gov/election-results/', 'description': 'Local results expected after 7:30 p.m. Central', 'state': 'AR'},
]
POLL_CLOSINGS = [
    {'state': 'IN/KY', 'label': 'First polls · parts of Indiana & Kentucky', 'at': '2026-11-03T23:00:00Z', 'note': 'Other parts close an hour later', 'url': 'https://apnews.com/article/0e2078f16af285b22675445d78360e6d'},
    {'state': 'VA/GA', 'label': 'Virginia & Georgia', 'at': '2026-11-04T00:00:00Z', 'note': 'Scheduled poll close', 'url': 'https://apnews.com/article/0e2078f16af285b22675445d78360e6d'},
    {'state': 'NC', 'label': 'North Carolina', 'at': '2026-11-04T00:30:00Z', 'note': 'Scheduled close; AP reports extended sites until 7:15 p.m. Central may delay results', 'url': 'https://apnews.com/article/ef6199e25927a9ac9f4c18eae0e497cd'},
    {'state': 'PA/MI', 'label': 'Pennsylvania & most of Michigan', 'at': '2026-11-04T01:00:00Z', 'note': 'Michigan has later-closing areas', 'url': 'https://apnews.com/article/0e2078f16af285b22675445d78360e6d'},
    {'state': 'AR', 'label': 'Arkansas · Sherwood / Pulaski', 'at': '2026-11-04T01:30:00Z', 'note': 'Results begin after polls close', 'url': 'https://votepulaskiar.gov/wp-content/uploads/11032026_Notice-of-Election_v1.pdf'},
    {'state': 'AZ', 'label': 'Arizona · first results', 'at': '2026-11-04T03:00:00Z', 'event': 'results', 'note': 'Results start after this time; polls close an hour earlier', 'url': 'https://azsos.gov/press'},
    {'state': 'CA', 'label': 'California', 'at': '2026-11-04T04:00:00Z', 'note': 'Scheduled poll close', 'url': 'https://electionresults.sos.ca.gov/'},
]


def load_source(source_id: str, client: PublicClient, previous_races=()):
    if source_id == 'sherwood':
        base = 'https://enr-results-api.totalresults.com/Contest/'
        query = 'cId=arkansas&electionID=' + ARKANSAS_ELECTION
        raw, _ = client.get(base + 'GetContestSearchList?' + query)
        metadata = json.loads(raw)
        contests = [(key, item) for key, item in metadata['response']['contests'].items() if item['contestName'].startswith('Sherwood ')]
        payloads = []
        for contest_id, contest in contests:
            raw, _ = client.get(base + 'GetSingleContestResults?' + query + '&contestType=' + contest['contestTypeCode'] + '&contestID=' + contest_id)
            payloads.append(json.loads(raw))
        races, timestamp = parse_sherwood(metadata, payloads)
        return races, timestamp, None, 120
    if source_id == 'nc':
        payload, timestamp = client.get('https://s3.amazonaws.com/dl.ncsbe.gov/ENRS/2026_11_03/results_pct_20261103.zip')
        races, _ = parse_nc(payload)
        return races, timestamp, None, 60
    if source_id in ('va', 'az'):
        url = ('https://enr.elections.virginia.gov/results/public/api/elections/virginia/2026-November-General/data' if source_id == 'va'
               else 'https://app.enhancedvoting.com/results/public/api/elections/Arizona/110326GeneralElection/data')
        payload, _ = client.get(url)
        races, timestamp = parse_enhanced(json.loads(payload), source_id.upper())
        return races, timestamp, None, 60 if source_id == 'va' else 120
    if source_id == 'ca':
        manifest, _ = client.get('https://media.sos.ca.gov/media/json-endpoints.csv')
        if b'November 3, 2026 Statewide General Election' not in manifest:
            raise ValueError('California feed no longer identifies the 2026 general election')
        races, times = [], []
        for path, office in [('us-rep', 'House'), ('governor', 'Governor')]:
            payload, timestamp = client.get(f'https://media.sos.ca.gov/media/{path}.json')
            rows, _ = parse_california(json.loads(payload), office)
            races.extend(rows)
            if timestamp:
                times.append(timestamp)
        return races, max(times) if times else None, None, 120
    if source_id == 'npr':
        races, times, errors = [], [], []
        for path, office in [('house', 'House'), ('senate', 'Senate'), ('gov', 'Governor')]:
            try:
                payload, _ = client.get(f'https://apps.npr.org/2026-election-results/data/{path}.json')
                rows, timestamp = parse_npr(json.loads(payload), office)
                times.append(timestamp)
            except Exception as error:
                errors.append(f'{office} delayed: {type(error).__name__}: {error}')
                rows = [race for race in previous_races if race['office'] == office]
            races.extend(rows)
        if not times:
            raise ValueError('; '.join(errors))
        return races, max(times), '; '.join(errors) or None, 120
    office = source_id[3:].title()
    payload, _ = client.get(f'https://openamerica.io/elections/results.json?year=2026&office={office}')
    data = json.loads(payload)
    races, timestamp = parse_openamerica(data, office)
    warning = 'Open America reports its upstream data is stale' if data.get('stale') else None
    return races, timestamp, warning, 60 if races and not data.get('final') else 600


def poll_source(source: dict, store: FeedStore, stop: threading.Event) -> None:
    client = PublicClient()
    failures = 0
    while not stop.is_set():
        try:
            previous = store.snapshot().get('npr', {}).get('races', []) if source['id'] == 'npr' else ()
            races, timestamp, warning, interval = load_source(source['id'], client, previous)
            store.success(source['id'], races, timestamp, utc_now(), warning)
            source['pollIntervalSeconds'] = interval
            failures = 0
            logging.info('%s: %s races, %s', source['id'], len(races), warning or 'OK')
        except Exception as error:
            failures += 1
            interval = min(600, source['pollIntervalSeconds'] * 2 ** min(failures - 1, 3))
            store.failure(source['id'], f'{type(error).__name__}: {error}', utc_now())
            logging.warning('%s: %s', source['id'], error)
        stop.wait(interval)


def dashboard_payload(store: FeedStore) -> dict:
    snapshot = store.snapshot()
    races = merged_races(snapshot)
    sources = []
    for config in SOURCES:
        current = snapshot.get(config['id'], {})
        sources.append({**config, **{key: value for key, value in current.items() if key not in ('races', 'electionDate')},
                        'status': current.get('status', 'loading'), 'raceCount': len(current.get('races', []))})
    return {'electionDate': ELECTION_DATE, 'generatedAt': utc_now(), 'refreshSeconds': 30,
            'sources': sources, 'races': races, 'links': LINKS, 'pollClosings': POLL_CLOSINGS,
            'chambers': chamber_summary(races, snapshot.get('npr', {})),
            'flips': [race for race in races if race.get('called') and race.get('flip')]}


def main() -> None:
    parser = argparse.ArgumentParser(description='Local election-night dashboard')
    parser.add_argument('--port', type=int, default=8767)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
    store = FeedStore(ROOT / 'data')
    stop = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            path = urlsplit(self.path).path
            if path == '/api/results':
                content = json.dumps(dashboard_payload(store)).encode()
                content_type = 'application/json; charset=utf-8'
            elif path in ('/', '/index.html', '/app.js', '/styles.css'):
                name = 'index.html' if path == '/' else path[1:]
                file = ROOT / 'static' / name
                if not file.is_file():
                    self.send_error(503, 'Interface is starting')
                    return
                content = file.read_bytes()
                content_type = {'html': 'text/html', 'js': 'text/javascript', 'css': 'text/css'}[file.suffix[1:]] + '; charset=utf-8'
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(content)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(content)

        def log_message(self, format, *arguments):
            pass

    httpd = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    for source in SOURCES:
        threading.Thread(target=poll_source, args=(source, store, stop), daemon=True).start()
    print(f'Election Night: http://127.0.0.1:{args.port}', flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        httpd.server_close()


if __name__ == '__main__':
    main()
