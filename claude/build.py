#!/usr/bin/env python3
"""Builds the copy of Tee Studio that runs inside Claude, into claude/dist/page.html.

The same app, with two differences the page's host requires: libraries load from approved CDNs (the exact versions
in lib/, checked byte for byte except for Fabric, where lib/ corrects one spelling that only causes a console warning),
and saved logos are left out, because they are private to this computer.
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
CDN = {
    'lib/fabric.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js',
    'lib/ag-psd.js': 'https://cdn.jsdelivr.net/npm/ag-psd@33.0.0/dist/bundle.js',
    'lib/jspdf.umd.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js',
    'lib/paper-core.min.js': 'https://cdn.jsdelivr.net/npm/paper@0.12.18/dist/paper-core.min.js',
    'lib/opentype.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/opentype.js/1.3.4/opentype.min.js',
    'lib/clipper.js': 'https://cdn.jsdelivr.net/npm/clipper-lib@6.4.2/clipper.js',
}
html = (ROOT / 'index.html').read_text()
head = re.search(r'<head>(.*?)</head>', html, re.S).group(1)
body = re.search(r'<body>(.*)</body>', html, re.S).group(1)
scripts = re.findall(r'<script src="([^"]+)"></script>', head)
assert set(CDN) <= set(scripts), 'a library in index.html has no CDN entry'
tags = ''.join(f'<script src="{CDN.get(s, s)}"></script>\n' for s in scripts)
body = body.replace('<script src="logos/logos.js"></script>\n', '')
assert 'logos/logos.js' not in body
assert 'works offline, no install' in body
body = body.replace('works offline, no install', 'signed in with your Claude account')
page = f'''<title>Tee Studio</title>
<link rel="stylesheet" href="app/styles.css">
<script>window.TEE_CLAUDE_BUILD = true;</script>
{tags}{body}'''
out = ROOT / 'claude' / 'dist'
out.mkdir(parents=True, exist_ok=True)
(out / 'page.html').write_text(page)
print(f'{out / "page.html"}: {len(page)} characters')
