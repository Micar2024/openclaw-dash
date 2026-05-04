const { WebSocketServer } = require('ws');

function parseUrlToken (req) {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    return url.searchParams.get('token') || '';
  } catch {
    return '';
  }
}

function sendJson (ws, payload) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function attachRealtimeServer (server, options) {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set();

  function isAuthorized (req) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : parseUrlToken(req);
    const cookies = options.parseCookies({ headers: { cookie: req.headers.cookie || '' } });
    return options.isValidToken(token) || options.isValidSession(cookies[options.sessionCookie]);
  }

  async function pushSnapshot (ws) {
    try {
      sendJson(ws, { type: 'snapshot', data: await options.collectSnapshot() });
    } catch (error) {
      sendJson(ws, { type: 'error', message: error.message || '实时状态读取失败。' });
    }
  }

  server.on('upgrade', (req, socket, head) => {
    if (!req.url || !req.url.startsWith('/ws/events')) return;

    if (!isAuthorized(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    sendJson(ws, { type: 'hello', intervalMs: options.intervalMs });
    pushSnapshot(ws);
    ws.on('close', () => clients.delete(ws));
  });

  const timer = setInterval(() => {
    for (const ws of clients) pushSnapshot(ws);
  }, options.intervalMs);

  wss.on('close', () => clearInterval(timer));

  return {
    broadcast: async (type = 'snapshot') => {
      const data = await options.collectSnapshot();
      for (const ws of clients) sendJson(ws, { type, data });
    },
    close: () => {
      clearInterval(timer);
      wss.close();
    },
    clientCount: () => clients.size
  };
}

module.exports = { attachRealtimeServer };
