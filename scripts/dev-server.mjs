import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GET as getDashboard } from '../api/dashboard.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT) || 8901;
const TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

async function sendApi(response) {
  const apiResponse = await getDashboard();
  response.statusCode = apiResponse.status;
  for (const [key, value] of apiResponse.headers) response.setHeader(key, value);
  response.end(Buffer.from(await apiResponse.arrayBuffer()));
}

function sendFile(requestUrl, response) {
  const pathname = new URL(requestUrl, 'http://localhost').pathname;
  const relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const filePath = resolve(ROOT, relativePath);
  if (!filePath.startsWith(`${ROOT}${sep}`) || !existsSync(filePath)) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.setHeader('Content-Type', TYPES[extname(filePath)] || 'application/octet-stream');
  createReadStream(filePath).pipe(response);
}

createServer(async (request, response) => {
  if (request.url?.split('?')[0] === '/api/dashboard') {
    await sendApi(response);
    return;
  }
  sendFile(request.url || '/', response);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`BNM dashboard: http://127.0.0.1:${PORT}`);
});
