"""Scan every saved image member, including compressed layer blobs, without extraction."""
import gzip
import json
import sys
import tarfile

with open(sys.argv[2], 'rb') as source:
    needle = source.read().strip()
found = 0
members = 0
compressed = 0
with tarfile.open(sys.argv[1], 'r:*') as archive:
    for member in archive:
        if not member.isfile():
            continue
        members += 1
        stream = archive.extractfile(member)
        prefix = stream.read(2)
        stream.seek(0)
        if prefix == b'\x1f\x8b':
            stream = gzip.GzipFile(fileobj=stream)
            compressed += 1
        tail = b''
        while True:
            chunk = stream.read(1024 * 1024)
            if not chunk:
                break
            data = tail + chunk
            if needle in data:
                found += 1
            tail = data[-len(needle):]
print(json.dumps({'members': members, 'compressedMembers': compressed, 'credentialMatches': found}))
sys.exit(1 if found else 0)
