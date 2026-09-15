import os
import sys
import sqlite3
import base64
import re
import json
import urllib.parse

def get_metadata():
    titles = {}
    workspaces = {}
    appdata = os.environ.get('APPDATA', '')
    userprofile = os.environ.get('USERPROFILE', os.path.expanduser('~'))

    # 1. state.vscdb for titles
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

    # 4. Extract Workspaces from conversations/*.db
    conv_dirs = [
        os.path.join(userprofile, '.gemini', 'antigravity-cli', 'conversations'),
        os.path.join(userprofile, '.gemini', 'antigravity-ide', 'conversations'),
        os.path.join(userprofile, '.gemini', 'antigravity', 'conversations')
    ]
    for cd in conv_dirs:
        if os.path.exists(cd):
            try:
                for f in os.listdir(cd):
                    if f.endswith('.db'):
                        cid = f[:-3]
                        try:
                            conn = sqlite3.connect(os.path.join(cd, f))
                            cur = conn.cursor()
                            cur.execute("SELECT data FROM trajectory_metadata_blob WHERE id='main';")
                            row = cur.fetchone()
                            if row and row[0]:
                                raw = row[0]
                                m_uri = re.search(rb'file:///([^\x00-\x1f\x7f-\xff\x12\x1a\x22]+)', raw)
                                m_corpus = re.search(rb'\x1aS\n\x1c([a-zA-Z0-9_\-\./]+)', raw) or re.search(rb'\n\x1c([a-zA-Z0-9_\-\./]+)', raw)

                                if m_uri:
                                    raw_uri_str = 'file:///' + m_uri.group(1).decode('utf-8', 'ignore').rstrip('\x12\x1a\x00')
                                    clean_path = urllib.parse.unquote(raw_uri_str.replace('file:///', ''))
                                    if clean_path.startswith('/') and len(clean_path) > 2 and clean_path[2] == ':':
                                        clean_path = clean_path[1:]
                                    clean_path = clean_path.replace('/', '\\')
                                    ws_name = os.path.basename(clean_path.rstrip('\\/')) or clean_path
                                    corpus = m_corpus.group(1).decode('utf-8', 'ignore') if m_corpus else None

                                    workspaces[cid] = {
                                        'uri': raw_uri_str,
                                        'path': clean_path,
                                        'name': ws_name,
                                        'corpus': corpus
                                    }
                            conn.close()
                        except:
                            pass
            except:
                pass

    # 5. Extract Workspaces from workspaceStorage
    ws_storage = os.path.join(appdata, 'Antigravity IDE', 'User', 'workspaceStorage')
    if os.path.exists(ws_storage):
        try:
            for ws_dir in os.listdir(ws_storage):
                ws_json = os.path.join(ws_storage, ws_dir, 'workspace.json')
                db_path = os.path.join(ws_storage, ws_dir, 'state.vscdb')
                folder_uri = None
                if os.path.exists(ws_json):
                    try:
                        with open(ws_json, 'r', encoding='utf-8') as fp:
                            folder_uri = json.load(fp).get('folder')
                    except:
                        pass
                if folder_uri and os.path.exists(db_path):
                    try:
                        clean_path = urllib.parse.unquote(folder_uri.replace('file:///', ''))
                        if clean_path.startswith('/') and len(clean_path) > 2 and clean_path[2] == ':':
                            clean_path = clean_path[1:]
                        clean_path = clean_path.replace('/', '\\')
                        ws_name = os.path.basename(clean_path.rstrip('\\/')) or clean_path

                        conn = sqlite3.connect(db_path)
                        cur = conn.cursor()
                        for (k,) in cur.execute('SELECT key FROM ItemTable'):
                            m = re.search(r'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', k)
                            if m:
                                cid = m.group(1)
                                if cid not in workspaces:
                                    workspaces[cid] = {
                                        'uri': folder_uri,
                                        'path': clean_path,
                                        'name': ws_name
                                    }
                        conn.close()
                    except:
                        pass
        except:
            pass

    return {
        'titles': titles,
        'workspaces': workspaces
    }

if __name__ == '__main__':
    data = get_metadata()
    json.dump(data, sys.stdout)

