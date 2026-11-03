import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent
URL = 'http://127.0.0.1:8767'


def running() -> bool:
    try:
        with urllib.request.urlopen(URL + '/api/results', timeout=2) as response:
            return json.load(response).get('electionDate') == '2026-11-03'
    except (OSError, ValueError):
        return False


def main() -> None:
    if running():
        print('Already running: ' + URL)
        return
    directory = ROOT / 'data'
    directory.mkdir(exist_ok=True)
    with (directory / 'server.log').open('ab') as log:
        process = subprocess.Popen([sys.executable, str(ROOT / 'server.py')], cwd=ROOT,
                                   stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                   start_new_session=True)
    for _ in range(40):
        if process.poll() is not None:
            raise SystemExit('Server failed to start; see data/server.log')
        if running():
            (directory / 'server.pid').write_text(str(process.pid))
            print('Election Night is running: ' + URL)
            return
        time.sleep(0.1)
    raise SystemExit('Startup not confirmed; see data/server.log')


if __name__ == '__main__':
    main()
