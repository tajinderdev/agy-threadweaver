import os
import sqlite3
import base64
import re

state_db = r'C:\Users\tajinder.s\AppData\Roaming\Antigravity IDE\User\globalStorage\state.vscdb'
summaries_db = r'C:\Users\tajinder.s\.gemini\antigravity-cli\conversation_summaries.db'

titles = {}

# 1. Read state.vscdb trajectorySummaries
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
    except Exception as e:
        print('Error reading state_db:', e)

# 2. Read conversation_summaries.db
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
    except Exception as e:
        print('Error reading summaries_db:', e)

# 3. Read annotations
ann_dirs = [
  r'C:\Users\tajinder.s\.gemini\antigravity-cli\annotations',
  r'C:\Users\tajinder.s\.gemini\antigravity\annotations',
  r'C:\Users\tajinder.s\.gemini\antigravity-ide\annotations'
]
for ad in ann_dirs:
    if os.path.exists(ad):
        for f in os.listdir(ad):
            if f.endswith('.pbtxt'):
                cid = f[:-6]
                try:
                    with open(os.path.join(ad, f), 'r', encoding='utf-8', errors='ignore') as fp:
                        content = fp.read()
                        m = re.search(r'title:\s*"([^"]+)"', content)
                        if m and cid not in titles:
                            titles[cid] = m.group(1)
                except:
                    pass

print(f"Total resolved titles: {len(titles)}")
print("\nSample 20 resolved titles:")
for k, v in list(titles.items())[:20]:
    print(f"  {k} -> {v}")
