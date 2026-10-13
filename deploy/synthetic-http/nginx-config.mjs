import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from './environment.mjs';

export function renderNginx(config) {
  if (!config.proxyMode || config.bindIp !== '127.0.0.1' || !/^[a-f0-9]{64}$/.test(config.proxyKey)) throw new Error('Explicit synthetic proxy mode required.');
  const host = new URL(config.origin).hostname;
  return `user www-data;
worker_processes 1;
pid /run/anxin-synthetic-${config.environmentId}/nginx.pid;
error_log stderr warn;
events { worker_connections 128; }
http {
  access_log off;
  server_tokens off;
  client_max_body_size 11m;
  client_body_buffer_size 11m;
  client_body_timeout 30s;
  client_header_timeout 15s;
  send_timeout 65s;
  server {
    listen ${host}:80;
    server_name ${host};
    if ($http_host != "${host}") { return 400; }
${config.allowCidrs.map((cidr) => `    allow ${cidr};`).join('\n')}
    deny all;
    location / {
      proxy_pass http://127.0.0.1:${config.port};
      proxy_set_header Host $http_host;
      proxy_set_header Origin $http_origin;
      proxy_set_header X-Anxin-Synthetic-Proxy ${config.proxyKey};
      proxy_set_header X-Anxin-Synthetic-Source $remote_addr;
      proxy_set_header X-Forwarded-For "";
      proxy_set_header Forwarded "";
      proxy_connect_timeout 3s;
      proxy_read_timeout 65s;
      proxy_send_timeout 65s;
      proxy_request_buffering off;
      proxy_buffering off;
    }
  }
}
`;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const config = loadEnvironment(process.argv[2]);
    const path = join(config.root, 'nginx.conf');
    writeFileSync(path, renderNginx(config), { mode: 0o600, flag: 'wx' });
    console.log('Private synthetic Nginx configuration created; proxy key is not printed. Install as root-owned before root loads it.');
  } catch { console.error('Synthetic proxy configuration refused; private content suppressed.'); process.exitCode = 1; }
}
