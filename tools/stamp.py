#!/usr/bin/env python3
"""Stamps app script and style links in index.html with a hash of each file's contents.

The public site tells browsers to cache files for 10 minutes. Without this, a visit soon after an update can mix the
new page with old cached scripts, which has left panels blank. Run it before committing; --check fails if it wasn't.
"""
import hashlib
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
index = ROOT / 'index.html'
html = index.read_text()


def stamp(match):
    path = match.group(1)
    digest = hashlib.sha256((ROOT / path).read_bytes()).hexdigest()[:10]
    return f'{path}?v={digest}"'


stamped = re.sub(r'(app/(?:js/[\w-]+\.js|styles\.css))(?:\?v=\w+)?"', stamp, html)
if '--check' in sys.argv:
    sys.exit(0 if stamped == html else 'index.html is out of date: run python3 tools/stamp.py')
index.write_text(stamped)
print('stamped' if stamped != html else 'already up to date')
