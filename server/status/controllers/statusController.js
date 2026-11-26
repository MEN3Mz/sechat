const STATS_PAGE = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<title>Server stats</title>
<body style="font-family:sans-serif;max-width:480px;margin:2em auto">
<h2>Server stats</h2><table id=t border=1 cellpadding=6 style="border-collapse:collapse"></table>
<script>
async function tick(){
  const m = await (await fetch('/metrics')).json();
  document.getElementById('t').innerHTML = Object.entries(m)
    .map(([k,v]) => '<tr><td>'+k+'</td><td>'+JSON.stringify(v)+'</td></tr>').join('');
}
tick(); setInterval(tick, 1000);
</script></body>`;

export function statusController(hub, metrics) {
  return {
    config: (req, res) => res.json({ accounts: hub.verifyToken !== null }),
    metrics: (req, res) => res.json(metrics.snapshot()),
    users: (req, res) => res.json(hub.users()),
    stats: (req, res) => res.type('html').send(STATS_PAGE),
  };
}
