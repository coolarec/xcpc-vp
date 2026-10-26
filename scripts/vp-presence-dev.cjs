/** Shared across local browser tabs; production uses the EdgeOne Blob function. */
module.exports = function vpPresenceDev() {
  const records = new Map();
  const store = {
    async setJSON(key, value) { records.set(key, value); },
    async delete(key) { records.delete(key); },
    async list({ prefix, directories, limit = Infinity }) {
      const keys = [...records.keys()].filter(key => key.startsWith(prefix)).sort();
      if (directories) {
        const groups = keys.map(key => {
          const end = key.indexOf('/', prefix.length);
          return end < 0 ? undefined : key.slice(0, end + 1);
        }).filter(Boolean);
        return { blobs: [], directories: [...new Set(groups)].slice(0, limit) };
      }
      return { blobs: keys.slice(0, limit).map(key => ({ key })), directories: [] };
    },
  };
  return {
    name: 'vp-presence-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/api/vp-presence') return next();
        try {
          const chunks = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 1024) {
              res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
              res.end(JSON.stringify({ error: 'Invalid heartbeat' }));
              return;
            }
            chunks.push(chunk);
          }
          const { handlePresence } = await server.ssrLoadModule('/src/server/vp-presence.ts');
          const request = new Request(`http://${req.headers.host}${req.url}`, {
            method: req.method,
            headers: req.headers,
            ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
          });
          const response = await handlePresence(request, store);
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(await response.text());
        } catch {
          res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: 'Presence unavailable' }));
        }
      });
    },
  };
};
