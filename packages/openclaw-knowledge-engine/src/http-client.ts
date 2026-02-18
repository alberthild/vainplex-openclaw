// src/http-client.ts

import * as http from 'node:http';
import * as https from 'node:https';

interface HttpPostOptions {
  hostname: string;
  port: string;
  path: string;
  method: 'POST';
  headers: Record<string, string | number>;
}

/**
 * Selects the correct HTTP/HTTPS module based on the URL protocol.
 */
function selectTransport(protocol: string): typeof http | typeof https {
  return protocol === 'https:' ? https : http;
}

/**
 * Builds request options from a URL and payload.
 */
function buildRequestOptions(url: URL, payload: string): HttpPostOptions {
  return {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  };
}

/**
 * Makes an HTTP or HTTPS POST request, auto-selecting the
 * transport based on the URL's protocol.
 *
 * @param url  The full URL string to POST to.
 * @param body The payload object to JSON-serialize and send.
 * @returns A promise resolving with the response body string.
 */
export function httpPost(url: string, body: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = JSON.stringify(body);
    const options = buildRequestOptions(parsed, payload);
    const transport = selectTransport(parsed.protocol);

    const req = transport.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(
            `HTTP request failed with status ${res.statusCode}: ${data}`
          ));
        }
      });
    });

    req.on('error', (e) => {
      reject(new Error(`HTTP request error: ${e.message}`));
    });

    req.write(payload);
    req.end();
  });
}
