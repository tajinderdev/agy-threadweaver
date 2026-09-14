import os
import sys
import sqlite3
import base64
import re
import json

def get_all_titles():
    titles = {}
    appdata = os.environ.get('APPDATA', '')
    userprofile = os.environ.get('USERPROFILE', os.path.expanduser('~'))

    # 1. state.vscdb
    state_db = os.path.join(appdata, 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb')
    if os.path.exists(state_db):
        try:
            conn = sqlite3.connect(state_db)
            cur = conn.cursor()
            cur.execute("SELECT value FROM ItemTable WHERE key='antigravityUnifiedStateSync.trajectorySummaries';")
            row = cur.fetchone()
            if row and row[0]:
                raw = base64.b64decode(row[0])
                pattern = re.compile(rb'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[^\w]+([A-Za-z0-9+/=]{20,})')
                for uuid, b64part in pattern.findall(raw):
                    try:
                        decoded = base64.b64decode(b64part)
                        m = re.search(rb'[\x08-\x20]([A-Z][a-zA-Z0-9 _\-\(\)]{4,60})', decoded)
                        if m:
                            titles[uuid.decode()] = m.group(1).decode('utf-8', 'ignore').strip()
                    except:
                        pass
            conn.close()
        except:
            pass

    # 2. conversation_summaries.db
    summaries_db = os.path.join(userprofile, '.gemini', 'antigravity-cli', 'conversation_summaries.db')
    if os.path.exists(summaries_db):
        try:
            conn = sqlite3.connect(summaries_db)
            cur = conn.cursor()
            cur.execute("SELECT conversation_id, title, preview FROM conversation_summaries;")
            for cid, title, prev in cur.fetchall():
                best = (title or prev or '').strip()
                if best and cid not in titles:
                    titles[cid] = best
            conn.close()
        except:
            pass

    # 3. Annotations (.pbtxt)
    ann_dirs = [
        os.path.join(userprofile, '.gemini', 'antigravity-cli', 'annotations'),
        os.path.join(userprofile, '.gemini', 'antigravity', 'annotations'),
        os.path.join(userprofile, '.gemini', 'antigravity-ide', 'annotations')
    ]
    for ad in ann_dirs:
        if os.path.exists(ad):
            try:
                for f in os.listdir(ad):
                    if f.endswith('.pbtxt'):
                        cid = f[:-6]
                        try:
                            with open(os.path.join(ad, f), 'r', encoding='utf-8', errors='ignore') as fp:
                                content = fp.read()
                                m = re.search(r'title:\s*"([^"]+)"', content)
                                if m and cid not in titles:
                                    titles[cid] = m.group(1).strip()
                        except:
                            pass
            except:
                pass

    return titles

if __name__ == '__main__':
    titles = get_all_titles()
    json.dump(titles, sys.stdout)
