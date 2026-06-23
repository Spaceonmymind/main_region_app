import { createServer } from 'node:http';

const HOST = '0.0.0.0';
const DEFAULT_PORT = 3001;
const MAX_BODY_SIZE_BYTES = 1024 * 1024;

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

export const startHttpServer = ({ port = process.env.PORT } = {}) => {
  const resolvedPort = parsePort(port);

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

    sendJson(response, 404, { error: 'Not found' });
  });

  server.listen(resolvedPort, HOST, () => {
    console.log(`HTTP-сервер запущен на http://${HOST}:${resolvedPort}`);
  });

  return server;
};

