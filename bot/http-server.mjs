import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const HOST = '0.0.0.0';
const DEFAULT_PORT = 3001;
const MAX_BODY_SIZE_BYTES = 1024 * 1024;
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.zip': 'application/zip',
};

const sendJson = (response, statusCode, payload) => {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
};

const readJsonBody = (request) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let totalSize = 0;

    request.on('data', (chunk) => {
      totalSize += chunk.length;

      if (totalSize > MAX_BODY_SIZE_BYTES) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });

    request.on('error', reject);
  });

const parsePort = (value) => {
  const port = Number(value || DEFAULT_PORT);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Некорректный PORT: "${value}"`);
  }

  return port;
};

const sendFile = async (request, response, filePath) => {
  const file = await readFile(filePath);
  const contentType = MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';

  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': file.length,
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  response.end(file);
};

const serveMiniApp = async (request, response, pathname, publicDir) => {
  let decodedPath;

  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    sendJson(response, 400, { error: 'Invalid URL' });
    return;
  }

  const requestedPath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const filePath = resolve(publicDir, requestedPath);
  const isInsidePublicDir = filePath === publicDir || filePath.startsWith(`${publicDir}${sep}`);

  if (!isInsidePublicDir || requestedPath.split('/').some((part) => part.startsWith('.'))) {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  try {
    const fileStats = await stat(filePath);

    if (fileStats.isFile()) {
      await sendFile(request, response, filePath);
      return;
    }
  } catch {
    // Для маршрутов SPA ниже возвращается index.html.
  }

  if (!extname(requestedPath)) {
    try {
      await sendFile(request, response, resolve(publicDir, 'index.html'));
      return;
    } catch {
      sendJson(response, 503, { error: 'Mini app build not found' });
      return;
    }
  }

  sendJson(response, 404, { error: 'Not found' });
};

export const startHttpServer = ({
  port = process.env.PORT,
  publicDir = resolve(process.cwd(), 'public'),
  onAnalyticsEvent,
  onWebhookEvent,
} = {}) => {
  const resolvedPort = parsePort(port);
  const resolvedPublicDir = resolve(publicDir);

  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, {
        status: 'ok',
        service: 'main_region_app',
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/webhook') {
      try {
        const event = await readJsonBody(request);

        console.log('Получено событие MAX webhook:', JSON.stringify(event));
        await onWebhookEvent?.(event);
        sendJson(response, 200, { status: 'ok' });
      } catch (error) {
        if (error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE') {
          sendJson(response, 413, { error: 'Payload too large' });
          return;
        }

        sendJson(response, 400, { error: 'Invalid JSON' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/analytics/event') {
      try {
        const event = await readJsonBody(request);

        await onAnalyticsEvent?.({
          event: event.event,
          params: event.params,
          path: event.path,
        });
        sendJson(response, 200, { status: 'ok' });
      } catch (error) {
        if (error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE') {
          sendJson(response, 413, { error: 'Payload too large' });
          return;
        }

        sendJson(response, 400, { error: 'Invalid JSON' });
      }
      return;
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      await serveMiniApp(request, response, url.pathname, resolvedPublicDir);
      return;
    }

    sendJson(response, 405, { error: 'Method not allowed' });
  });

  server.listen(resolvedPort, HOST, () => {
    console.log(`HTTP-сервер запущен на http://${HOST}:${resolvedPort}`);
  });

  return server;
};
