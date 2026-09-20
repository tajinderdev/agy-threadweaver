const express = require('express');
const app = express();

app.get('/api/v1/workspaces/:encodedUri/threads', (req, res) => {
  res.json({ success: true, uri: decodeURIComponent(req.params.encodedUri) });
});

app.use((req, res) => res.status(404).send('Not Found'));

const server = app.listen(0, () => {
  const port = server.address().port;
  
  const testUri = encodeURIComponent("file:///d:/Work/2026/OSSI/Backups/CB%20Live/Live");
  
  fetch(`http://127.0.0.1:${port}/api/v1/workspaces/${testUri}/threads`)
    .then(r => r.json().then(j => console.log('Status:', r.status, 'Body:', j)).catch(() => console.log('Status:', r.status)))
    .catch(console.error)
    .finally(() => server.close());
});
