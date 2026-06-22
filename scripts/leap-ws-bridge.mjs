import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const nativeDir = resolve(rootDir, 'native/leap-bridge');
const buildDir = resolve(nativeDir, 'build');
const bridgeBinary = resolve(buildDir, 'leap_bridge');
const sourceFile = resolve(nativeDir, 'src/leap_bridge.c');

const port = Number(process.env.TRACKING_WS_PORT ?? 6437);
const initialMode = normalizeMode(process.env.TRACKING_MODE) ?? 'desktop';
const clients = new Set();

ensureNativeBridge();

const leap = spawn(bridgeBinary, [initialMode], {
  cwd: rootDir,
  stdio: ['pipe', 'pipe', 'inherit'],
});

leap.on('exit', (code, signal) => {
  console.error(`Leap bridge exited (${signal ?? code}).`);
  process.exit(code ?? 1);
});

let stdoutBuffer = '';
leap.stdout.setEncoding('utf8');
leap.stdout.on('data', (chunk) => {
  stdoutBuffer += chunk;

  let newlineIndex;
  while ((newlineIndex = stdoutBuffer.indexOf('\n')) >= 0) {
    const line = stdoutBuffer.slice(0, newlineIndex).trim();
    stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);

    if (line.length > 0) {
      broadcast(line);
    }
  }
});

const server = createServer((_request, response) => {
  response.writeHead(426, { 'Content-Type': 'text/plain' });
  response.end('WebSocket endpoint only.\n');
});

server.on('upgrade', (request, socket) => {
  const key = request.headers['sec-websocket-key'];

  if (typeof key !== 'string') {
    socket.destroy();
    return;
  }

  const accept = createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');

  socket.write(
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      '',
    ].join('\r\n'),
  );

  clients.add(socket);
  socket.write(encodeFrame(JSON.stringify({
    version: 6,
    serviceVersion: 'screenthrough LeapC bridge',
  })));

  let inputBuffer = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    inputBuffer = Buffer.concat([inputBuffer, chunk]);
    const parsed = decodeFrames(inputBuffer);
    inputBuffer = parsed.remaining;

    for (const message of parsed.messages) {
      handleClientMessage(message);
    }
  });

  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`LeapC websocket bridge listening at ws://127.0.0.1:${port}/v6.json`);
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function shutdown() {
  for (const client of clients) {
    client.destroy();
  }

  leap.kill();
  server.close(() => process.exit(0));
}

function ensureNativeBridge() {
  const needsBuild =
    !existsSync(bridgeBinary) ||
    statSync(bridgeBinary).mtimeMs < statSync(sourceFile).mtimeMs;

  if (!needsBuild) {
    return;
  }

  let result = spawnSync('cmake', ['-S', nativeDir, '-B', buildDir], {
    cwd: rootDir,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  result = spawnSync('cmake', ['--build', buildDir], {
    cwd: rootDir,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function broadcast(message) {
  const frame = encodeFrame(message);

  for (const client of clients) {
    if (!client.destroyed) {
      client.write(frame);
    }
  }
}

function handleClientMessage(message) {
  let payload;

  try {
    payload = JSON.parse(message);
  } catch {
    return;
  }

  let mode;
  if (payload.optimizeScreentop === true) {
    mode = 'screentop';
  } else if (payload.optimizeHMD === true) {
    mode = 'hmd';
  } else if (payload.optimizeHMD === false || payload.mode === 'desktop') {
    mode = 'desktop';
  }

  if (mode) {
    leap.stdin.write(`${mode}\n`);
  }
}

function encodeFrame(message) {
  const payload = Buffer.from(message);

  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }

  if (payload.length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }

  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, payload]);
}

function decodeFrames(buffer) {
  const messages = [];
  let offset = 0;

  while (buffer.length - offset >= 2) {
    const firstByte = buffer[offset];
    const secondByte = buffer[offset + 1];
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) !== 0;
    let length = secondByte & 0x7f;
    let headerLength = 2;

    if (length === 126) {
      if (buffer.length - offset < 4) {
        break;
      }
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (buffer.length - offset < 10) {
        break;
      }
      length = Number(buffer.readBigUInt64BE(offset + 2));
      headerLength = 10;
    }

    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + length;
    if (buffer.length - offset < frameLength) {
      break;
    }

    const maskOffset = offset + headerLength;
    const payloadOffset = maskOffset + maskLength;
    const payload = Buffer.from(buffer.subarray(payloadOffset, payloadOffset + length));

    if (masked) {
      const mask = buffer.subarray(maskOffset, maskOffset + 4);
      for (let index = 0; index < payload.length; index++) {
        payload[index] ^= mask[index % 4];
      }
    }

    if (opcode === 0x8) {
      break;
    }

    if (opcode === 0x1) {
      messages.push(payload.toString('utf8'));
    }

    offset += frameLength;
  }

  return {
    messages,
    remaining: buffer.subarray(offset),
  };
}

function normalizeMode(value) {
  if (value === 'desktop' || value === 'screentop' || value === 'hmd') {
    return value;
  }

  return undefined;
}
