// test/http-client.test.ts

import { describe, it, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as http from 'node:http';
import { httpPost } from '../src/http-client.js';

describe('httpPost', () => {
  let server: http.Server | null = null;

  afterEach((_, done) => {
    if (server) {
      server.close(() => done());
      server = null;
    } else {
      done();
    }
  });

  it('should make a successful POST request', async () => {
    let receivedBody = '';
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        receivedBody = body;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
    });

    await new Promise<void>(resolve => server!.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    const result = await httpPost(`http://localhost:${port}/test`, { key: 'value' });
    assert.strictEqual(result, '{"ok":true}');
    assert.strictEqual(JSON.parse(receivedBody).key, 'value');
  });

  it('should reject on non-2xx status codes', async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(500);
      res.end('Internal Server Error');
    });

    await new Promise<void>(resolve => server!.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    await assert.rejects(
      () => httpPost(`http://localhost:${port}/test`, {}),
      (err: Error) => {
        assert.ok(err.message.includes('500'));
        return true;
      }
    );
  });

  it('should reject on connection error', async () => {
    // Port that nothing is listening on
    await assert.rejects(
      () => httpPost('http://localhost:19999/test', {}),
      (err: Error) => {
        assert.ok(err.message.includes('request error'));
        return true;
      }
    );
  });
});
