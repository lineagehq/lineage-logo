"""Check shipped documentation against npm's actual pack file list, without scripts."""
import json
import subprocess
import sys

packed = {entry['path'] for entry in json.load(sys.stdin)[0]['files']}
tracked = subprocess.check_output(['git', 'ls-files', '-z', 'README.md', 'docs/public-beta']).decode().split('\0')
expected = {name for name in tracked if name}
missing = expected - packed
if missing:
    raise SystemExit(f'Missing packaged documentation: {sorted(missing)}')
print(f'Package includes all {len(expected)} documentation files')
