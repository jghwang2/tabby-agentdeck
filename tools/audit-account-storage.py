"""Read-only storage audit; skip reparse points and never read credentials."""
import collections
import datetime
import json
import os
import sys

root, output = sys.argv[1:]
groups = collections.defaultdict(lambda: [0, 0])
categories = collections.defaultdict(lambda: [0, 0])
copies = collections.defaultdict(lambda: [0, 0])
largest = []
links = []
errors = []
total = count = 0
for base, dirs, files in os.walk(root, followlinks=False, onerror=lambda e: errors.append(str(e))):
    keep = []
    for name in dirs:
        p = os.path.join(base, name)
        if os.path.islink(p) or os.path.isjunction(p):
            links.append(p)
        else:
            keep.append(name)
    dirs[:] = keep
    for name in files:
        p = os.path.join(base, name)
        try:
            stat = os.stat(p)
        except OSError as e:
            errors.append(str(e))
            continue
        rel = os.path.relpath(p, root).replace('\\', '/')
        parts = rel.split('/')
        total += stat.st_size
        count += 1
        key = '/'.join(parts[:5]) if len(parts) > 5 else '/'.join(parts[:-1])
        for record in [groups[key]]:
            record[0] += stat.st_size
            record[1] += 1
        category = 'git-history' if '/.git/' in rel else 'node_modules' if '/node_modules/' in rel else os.path.splitext(name)[1].lower() or '(no extension)'
        categories[category][0] += stat.st_size
        categories[category][1] += 1
        if '.staging' in parts:
            key = '/'.join(parts[:parts.index('.staging') + 2])
            copies[key][0] += stat.st_size
            copies[key][1] += 1
        largest.append((stat.st_size, rel))
    largest = sorted(largest, reverse=True)[:20]

def rows(items):
    return [{'path': k, 'bytes': v[0], 'files': v[1]} for k, v in sorted(items.items(), key=lambda x: x[1][0], reverse=True)]

report = dict(root=root, measured=datetime.datetime.now().isoformat(), bytes=total, files=count,
              groups=rows(groups), categories=rows(categories), staging_copies=rows(copies),
              largest_files=largest, excluded_links=links, errors=errors)
with open(output, 'w', encoding='utf-8') as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
print(json.dumps({'GiB': round(total / 2**30, 3), 'files': count, 'copies': len(copies),
                  'categories': rows(categories)[:8], 'errors': len(errors), 'report': output}))
