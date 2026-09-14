const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

function resolveAllTitles() {
  const titles = new Map();
  const homeDir = os.homedir();

  // 1. Read all annotation files (.pbtxt)
  const annDirs = [
    path.join(homeDir, '.gemini', 'antigravity-cli', 'annotations'),
    path.join(homeDir, '.gemini', 'antigravity', 'annotations'),
    path.join(homeDir, '.gemini', 'antigravity-ide', 'annotations')
  ];

  for (const ad of annDirs) {
    if (fs.existsSync(ad)) {
      try {
        const files = fs.readdirSync(ad);
        for (const f of files) {
          if (f.endsWith('.pbtxt')) {
            const threadId = f.slice(0, -6);
            const content = fs.readFileSync(path.join(ad, f), 'utf8');
            const match = content.match(/title:\s*"([^"]+)"/);
            if (match && match[1]) {
              titles.set(threadId, match[1].trim());
            }
          }
        }
      } catch (e) {
        console.warn('Error reading annotations:', e.message);
      }
    }
  }

  // 2. Query SQLite via python if available
  const stateDb = path.join(process.env.APPDATA || '', 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb');
  const summariesDb = path.join(homeDir, '.gemini', 'antigravity-cli', 'conversation_summaries.db');

  const pyScript = `
import os, sqlite3, base64, re, json

out = {}

state_db = r"${stateDb.replace(/\\/g, '\\\\')}"
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
                    m = re.search(rb'[\x08-\x20]([A-Z][a-zA-Z0-9 _\\-\\(\\)]{4,60})', decoded)
                    if m:
                        out[uuid.decode()] = m.group(1).decode('utf-8', 'ignore').strip()
                except:
                    pass
        conn.close()
    except:
        pass

sum_db = r"${summariesDb.replace(/\\/g, '\\\\')}"
if os.path.exists(sum_db):
    try:
        conn = sqlite3.connect(sum_db)
        cur = conn.cursor()
        cur.execute("SELECT conversation_id, title, preview FROM conversation_summaries;")
        for cid, title, prev in cur.fetchall():
            best = (title or prev or '').strip()
            if best and cid not in out:
                out[cid] = best
        conn.close()
    except:
        pass

print(json.dumps(out))
`;

  try {
    const pyOutput = execSync(`python -c ${JSON.stringify(pyScript)}`, { timeout: 3000, encoding: 'utf8' });
    const pyTitles = JSON.parse(pyOutput.trim());
    for (const [id, title] of Object.entries(pyTitles)) {
      if (!titles.has(id)) {
        titles.set(id, title);
      }
    }
  } catch (err) {
    console.warn('Python sqlite extraction failed or not available:', err.message);
  }

  return titles;
}

const titles = resolveAllTitles();
console.log('Total resolved titles:', titles.size);
console.log('Sample 10:');
let count = 0;
for (const [id, title] of titles.entries()) {
  console.log(`  ${id}: ${title}`);
  if (++count >= 10) break;
}
