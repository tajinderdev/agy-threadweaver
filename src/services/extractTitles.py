import os
import sys
import platform
import sqlite3
import base64
import re
import json
import urllib.parse


# ─── Platform Detection ───────────────────────────────────────────────────────

def detect_platform():
    """Returns one of: 'windows', 'macos', 'linux', 'wsl'."""
    if sys.platform == 'win32':
        return 'windows'
    if sys.platform == 'darwin':
        return 'macos'
    if sys.platform.startswith('linux'):
        try:
            with open('/proc/version', 'r') as f:
                if re.search(r'microsoft|wsl', f.read(), re.IGNORECASE):
                    return 'wsl'
        except Exception:
            pass
        return 'linux'
    return 'linux'


def get_home():
    return os.path.expanduser('~')


def resolve_windows_home_from_wsl():
    """On WSL: resolve the Windows user home via /mnt/c/Users/<user>."""
    userprofile = os.environ.get('USERPROFILE', '')
    if userprofile:
        # Convert Windows path e.g. C:\Users\foo -> /mnt/c/Users/foo
        m = re.match(r'^([A-Za-z]):[\\\/](.*)', userprofile)
        if m:
            drive = m.group(1).lower()
            rest = m.group(2).replace('\\', '/')
            wsl_path = f'/mnt/{drive}/{rest}'
            if os.path.exists(wsl_path):
                return wsl_path

    # Probe /mnt/c/Users/ for first non-system user dir
    mount = '/mnt/c/Users'
    if os.path.exists(mount):
        system_dirs = {'Public', 'Default', 'All Users', 'Default User'}
        try:
            for entry in os.listdir(mount):
                full = os.path.join(mount, entry)
                if os.path.isdir(full) and entry not in system_dirs:
                    return full
        except Exception:
            pass
    return None


def get_platform_paths(plat):
    """
    Returns a dict with all candidate path lists for the given platform:
      - protobufs:    agyhub_summaries_proto.pb locations
      - state_dbs:    state.vscdb (IDE global storage) locations
      - sum_dbs:      conversation_summaries.db locations
      - ann_dirs:     annotation directories
      - conv_dirs:    per-thread conversations/*.db directories
      - ws_storages:  workspaceStorage base directories
    """
    home = get_home()
    result = {
        'protobufs': [],
        'state_dbs': [],
        'sum_dbs': [],
        'ann_dirs': [],
        'conv_dirs': [],
        'ws_storages': [],
    }

    if plat == 'windows':
        appdata = os.environ.get('APPDATA', os.path.join(home, 'AppData', 'Roaming'))
        result['protobufs'] = [
            os.path.join(home, '.gemini', 'antigravity', 'agyhub_summaries_proto.pb'),
            os.path.join(home, '.gemini', 'antigravity-ide', 'agyhub_summaries_proto.pb'),
            os.path.join(home, '.gemini', 'agyhub_summaries_proto.pb'),
            os.path.join(home, '.gemini', 'antigravity-cli', 'agyhub_summaries_proto.pb'),
        ]
        result['state_dbs'] = [
            os.path.join(appdata, 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb'),
            os.path.join(appdata, 'antigravity-ide', 'User', 'globalStorage', 'state.vscdb'),
            os.path.join(appdata, 'Code', 'User', 'globalStorage', 'state.vscdb'),
        ]
        result['sum_dbs'] = [
            os.path.join(home, '.gemini', 'antigravity-cli', 'conversation_summaries.db'),
            os.path.join(home, '.gemini', 'antigravity-ide', 'conversation_summaries.db'),
            os.path.join(home, '.gemini', 'antigravity', 'conversation_summaries.db'),
        ]
        result['ann_dirs'] = [
            os.path.join(home, '.gemini', 'antigravity-cli', 'annotations'),
            os.path.join(home, '.gemini', 'antigravity', 'annotations'),
            os.path.join(home, '.gemini', 'antigravity-ide', 'annotations'),
        ]
        result['conv_dirs'] = [
            os.path.join(home, '.gemini', 'antigravity-ide', 'conversations'),
            os.path.join(home, '.gemini', 'antigravity-cli', 'conversations'),
            os.path.join(home, '.gemini', 'antigravity', 'conversations'),
        ]
        result['ws_storages'] = [
            os.path.join(appdata, 'Antigravity IDE', 'User', 'workspaceStorage'),
        ]

    elif plat == 'macos':
        app_support = os.path.join(home, 'Library', 'Application Support')
        result['protobufs'] = [
            os.path.join(home, '.gemini', 'antigravity', 'agyhub_summaries_proto.pb'),
            os.path.join(home, '.gemini', 'antigravity-ide', 'agyhub_summaries_proto.pb'),
            os.path.join(home, '.gemini', 'agyhub_summaries_proto.pb'),
            os.path.join(home, '.gemini', 'antigravity-cli', 'agyhub_summaries_proto.pb'),
            os.path.join(app_support, 'Antigravity IDE', 'agyhub_summaries_proto.pb'),
        ]
        result['state_dbs'] = [
            os.path.join(app_support, 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb'),
            os.path.join(app_support, 'Antigravity', 'User', 'globalStorage', 'state.vscdb'),
        ]
        result['sum_dbs'] = [
            os.path.join(home, '.gemini', 'antigravity-cli', 'conversation_summaries.db'),
            os.path.join(home, '.gemini', 'antigravity-ide', 'conversation_summaries.db'),
            os.path.join(home, '.gemini', 'antigravity', 'conversation_summaries.db'),
        ]
        result['ann_dirs'] = [
            os.path.join(home, '.gemini', 'antigravity-cli', 'annotations'),
            os.path.join(home, '.gemini', 'antigravity', 'annotations'),
            os.path.join(home, '.gemini', 'antigravity-ide', 'annotations'),
        ]
        result['conv_dirs'] = [
            os.path.join(home, '.gemini', 'antigravity-ide', 'conversations'),
            os.path.join(home, '.gemini', 'antigravity-cli', 'conversations'),
            os.path.join(home, '.gemini', 'antigravity', 'conversations'),
        ]
        result['ws_storages'] = [
            os.path.join(app_support, 'Antigravity IDE', 'User', 'workspaceStorage'),
        ]

    elif plat in ('linux', 'wsl'):
        xdg_data = os.environ.get('XDG_DATA_HOME', os.path.join(home, '.local', 'share'))
        result['protobufs'] = [
            os.path.join(home, '.gemini', 'antigravity', 'agyhub_summaries_proto.pb'),
            os.path.join(home, '.gemini', 'antigravity-ide', 'agyhub_summaries_proto.pb'),
            os.path.join(home, '.gemini', 'agyhub_summaries_proto.pb'),
            os.path.join(home, '.gemini', 'antigravity-cli', 'agyhub_summaries_proto.pb'),
        ]
        result['state_dbs'] = [
            os.path.join(home, '.config', 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb'),
            os.path.join(xdg_data, 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb'),
        ]
        result['sum_dbs'] = [
            os.path.join(home, '.gemini', 'antigravity-cli', 'conversation_summaries.db'),
            os.path.join(home, '.gemini', 'antigravity-ide', 'conversation_summaries.db'),
            os.path.join(home, '.gemini', 'antigravity', 'conversation_summaries.db'),
        ]
        result['ann_dirs'] = [
            os.path.join(home, '.gemini', 'antigravity-cli', 'annotations'),
            os.path.join(home, '.gemini', 'antigravity', 'annotations'),
            os.path.join(home, '.gemini', 'antigravity-ide', 'annotations'),
        ]
        result['conv_dirs'] = [
            os.path.join(home, '.gemini', 'antigravity-ide', 'conversations'),
            os.path.join(home, '.gemini', 'antigravity-cli', 'conversations'),
            os.path.join(home, '.gemini', 'antigravity', 'conversations'),
        ]
        result['ws_storages'] = [
            os.path.join(home, '.config', 'Antigravity IDE', 'User', 'workspaceStorage'),
            os.path.join(xdg_data, 'Antigravity IDE', 'User', 'workspaceStorage'),
        ]

        # WSL: also bridge to Windows-side paths via /mnt/c
        if plat == 'wsl':
            win_home = resolve_windows_home_from_wsl()
            if win_home:
                win_appdata = os.path.join(win_home, 'AppData', 'Roaming')
                result['protobufs'] += [
                    os.path.join(win_home, '.gemini', 'antigravity', 'agyhub_summaries_proto.pb'),
                    os.path.join(win_home, '.gemini', 'antigravity-ide', 'agyhub_summaries_proto.pb'),
                    os.path.join(win_home, '.gemini', 'agyhub_summaries_proto.pb'),
                ]
                result['state_dbs'].append(
                    os.path.join(win_appdata, 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb')
                )
                result['sum_dbs'] += [
                    os.path.join(win_home, '.gemini', 'antigravity-cli', 'conversation_summaries.db'),
                    os.path.join(win_home, '.gemini', 'antigravity', 'conversation_summaries.db'),
                ]
                result['ann_dirs'] += [
                    os.path.join(win_home, '.gemini', 'antigravity-cli', 'annotations'),
                    os.path.join(win_home, '.gemini', 'antigravity', 'annotations'),
                ]
                result['conv_dirs'] += [
                    os.path.join(win_home, '.gemini', 'antigravity-ide', 'conversations'),
                    os.path.join(win_home, '.gemini', 'antigravity-cli', 'conversations'),
                ]
                result['ws_storages'].append(
                    os.path.join(win_appdata, 'Antigravity IDE', 'User', 'workspaceStorage')
                )

    return result


# ─── Path Normalisation ───────────────────────────────────────────────────────

def normalize_uri_path(raw_uri_str, plat):
    """Converts a file:// URI to an OS-appropriate filesystem path."""
    clean = urllib.parse.unquote(raw_uri_str.replace('file:///', ''))
    # On WSL/Linux a Windows URI will look like /C:/Users/... - strip leading slash
    if plat in ('windows', 'wsl') and clean.startswith('/') and len(clean) > 2 and clean[2] == ':':
        clean = clean[1:]
    if plat == 'windows':
        clean = clean.replace('/', '\\').rstrip('\\')
    else:
        clean = clean.rstrip('/')
    return clean


# ─── Main Metadata Extractor ─────────────────────────────────────────────────

def get_metadata():
    titles = {}
    workspaces = {}
    plat = detect_platform()
    paths = get_platform_paths(plat)

    # 1. agyhub_summaries_proto.pb (Official Antigravity summaries & titles)
    for pb_path in paths['protobufs']:
        if os.path.exists(pb_path):
            try:
                with open(pb_path, 'rb') as f:
                    data = f.read()
                    uuid_pattern = rb'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'
                    matches = list(re.finditer(uuid_pattern, data))
                    for idx, m in enumerate(matches):
                        cid = m.group(1).decode()
                        start = m.start()
                        end = matches[idx + 1].start() if idx + 1 < len(matches) else min(len(data), start + 2000)
                        chunk = data[start:end]

                        # Title extraction: protobuf tag with readable title string
                        t_match = re.search(rb'\n([\x04-\x60])([A-Z][A-Za-z0-9 _\-\(\)\.,;:\'\"\/\\#@]{3,80})', chunk)
                        if t_match:
                            t_len = t_match.group(1)[0]
                            candidate = t_match.group(2).decode('utf-8', 'ignore')[:t_len].strip()
                            if candidate and not candidate.startswith('file:///') and not candidate.startswith('http') and len(candidate) > 3:
                                if cid not in titles or len(candidate) > len(titles[cid]):
                                    titles[cid] = candidate

                        # Workspace extraction
                        m_uri = re.search(rb'file:///[^\x00-\x1f\x7f-\xff\x1a\x12]+', chunk)
                        if m_uri:
                            raw_uri_str = m_uri.group(0).decode('utf-8', 'ignore')
                            clean_path = normalize_uri_path(raw_uri_str, plat)
                            ws_name = os.path.basename(clean_path) or clean_path
                            if cid not in workspaces:
                                workspaces[cid] = {
                                    'uri': raw_uri_str,
                                    'path': clean_path,
                                    'name': ws_name
                                }
            except Exception:
                pass

    # 2. state.vscdb for titles and trajectory summaries
    for sdb in paths['state_dbs']:
        if os.path.exists(sdb):
            try:
                conn = sqlite3.connect(sdb)
                cur = conn.cursor()
                cur.execute("SELECT value FROM ItemTable WHERE key='antigravityUnifiedStateSync.trajectorySummaries';")
                row = cur.fetchone()
                if row and row[0]:
                    try:
                        raw = base64.b64decode(row[0])
                        pattern = re.compile(rb'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[^\w]+([A-Za-z0-9+/=]{20,})')
                        for uuid, b64part in pattern.findall(raw):
                            try:
                                decoded = base64.b64decode(b64part)
                                m = re.search(rb'[\x08-\x20]([A-Z][a-zA-Z0-9 _\-\(\)]{4,60})', decoded)
                                if m and uuid.decode() not in titles:
                                    titles[uuid.decode()] = m.group(1).decode('utf-8', 'ignore').strip()
                            except Exception:
                                pass
                    except Exception:
                        pass
                conn.close()
            except Exception:
                pass

    # 3. conversation_summaries.db
    for sdb in paths['sum_dbs']:
        if os.path.exists(sdb):
            try:
                conn = sqlite3.connect(sdb)
                cur = conn.cursor()
                cur.execute("SELECT conversation_id, title, preview FROM conversation_summaries;")
                for cid, title, prev in cur.fetchall():
                    best = (title or prev or '').strip()
                    if best and cid not in titles:
                        titles[cid] = best
                conn.close()
            except Exception:
                pass

    # 4. Annotations (.pbtxt)
    for ad in paths['ann_dirs']:
        if os.path.exists(ad):
            try:
                for fname in os.listdir(ad):
                    if fname.endswith('.pbtxt'):
                        cid = fname[:-6]
                        try:
                            with open(os.path.join(ad, fname), 'r', encoding='utf-8', errors='ignore') as fp:
                                content = fp.read()
                                m = re.search(r'title:\s*"([^"]+)"', content)
                                if m and cid not in titles:
                                    titles[cid] = m.group(1).strip()
                        except Exception:
                            pass
            except Exception:
                pass

    # 5. Extract Workspaces from conversations/*.db (Authoritative project workspace directory)
    for cd in paths['conv_dirs']:
        if os.path.exists(cd):
            try:
                for fname in os.listdir(cd):
                    if fname.endswith('.db'):
                        cid = fname[:-3]
                        try:
                            conn = sqlite3.connect(os.path.join(cd, fname))
                            cur = conn.cursor()
                            cur.execute("SELECT data FROM trajectory_metadata_blob WHERE id='main';")
                            row = cur.fetchone()
                            if row and row[0]:
                                raw = row[0]
                                m_uri = re.search(rb'file:///[^\x00-\x1f\x7f-\xff\x1a\x12]+', raw)
                                m_corpus = re.search(rb'\x1aS\n\x1c([a-zA-Z0-9_\-\./]+)', raw) or re.search(rb'\n\x1c([a-zA-Z0-9_\-\./]+)', raw)

                                if m_uri:
                                    raw_uri_str = m_uri.group(0).decode('utf-8', 'ignore').rstrip('\x12\x1a\x00')
                                    clean_path = normalize_uri_path(raw_uri_str, plat)
                                    ws_name = os.path.basename(clean_path) or clean_path
                                    corpus = m_corpus.group(1).decode('utf-8', 'ignore') if m_corpus else None

                                    workspaces[cid] = {
                                        'uri': raw_uri_str,
                                        'path': clean_path,
                                        'name': ws_name,
                                        'corpus': corpus
                                    }
                            conn.close()
                        except Exception:
                            pass
            except Exception:
                pass

    # 6. Extract Workspaces from workspaceStorage
    for ws_storage in paths['ws_storages']:
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
                        except Exception:
                            pass
                    if folder_uri and os.path.exists(db_path):
                        try:
                            clean_path = normalize_uri_path(folder_uri, plat)
                            ws_name = os.path.basename(clean_path) or clean_path

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
                        except Exception:
                            pass
            except Exception:
                pass

    return {
        'titles': titles,
        'workspaces': workspaces
    }

if __name__ == '__main__':
    data = get_metadata()
    json.dump(data, sys.stdout)

