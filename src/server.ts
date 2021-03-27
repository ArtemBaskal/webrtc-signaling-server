import WebSocket, { Data } from 'ws';
import fs from 'fs';
import { OAuth2Client } from 'google-auth-library';
import { config } from 'dotenv';
import http, { IncomingMessage, ServerResponse } from 'http';
import https from 'https';
import { Duplex } from 'stream';
import { Socket } from 'net';
import { getQueryParam } from './helpers';

config();

let httpServer;
let options;

const BUILD_ENVS = {
  PROD: 'PROD',
  DEV: 'DEV',
};

const { BUILD_ENV, DEV_TOKEN, CLIENT_ID } = process.env;
const isProd = BUILD_ENV === BUILD_ENVS.PROD;
const isDev = BUILD_ENV === BUILD_ENVS.DEV;

if (isProd) {
  httpServer = http;
  options = {};
} else if (isDev) {
  httpServer = https;
  /* Fake cert */
  options = {
    key: fs.readFileSync('key.pem'),
    cert: fs.readFileSync('cert.pem'),
  };
} else {
  throw new Error(`BUILD_ENV is incorrect: ${BUILD_ENV}`);
}

const server = httpServer.createServer(
  options,
  (request: IncomingMessage, response: ServerResponse) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8;' });

    response.write('<h2>WebRTC WebSocket-based Signaling Server</h2>');
    response.end();
  },
);

const wss = new WebSocket.Server({ noServer: true });

interface MyWebSocket extends WebSocket {
    isAlive?: boolean,
}

const ROOMS_TO_CLIENTS_MAP: { [key: string]: MyWebSocket[] } = {};
const QUERY_PARAM_ROOM_NAME = 'room';
const MAX_CLIENTS_IN_ROOM = 2;

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {
};

const heartbeat = (ws: MyWebSocket) => {
  /* eslint no-param-reassign: ["error", { "ignorePropertyModificationsFor": ["ws"] }] */
  ws.isAlive = true;
};

const interval = setInterval(() => {
  wss.clients.forEach((ws: MyWebSocket) => {
    if (ws.isAlive === false) {
      ws.terminate();
      return;
    }

    ws.isAlive = false;
    ws.ping(noop);
  });
}, 30000);

const verify = async (token: string, clientId: string): Promise<void> => {
  const client = new OAuth2Client(clientId);

  const ticket = await client.verifyIdToken({
    idToken: token,
    audience: CLIENT_ID,
  });

  const payload = ticket.getPayload();

  if (!payload) {
    throw new Error(`Incorrect token: ${token}`);
  }

  const { email, name, sub: userid } = payload;

  console.log(`User ${name} <${email}> is verified (userid#${userid})`);
};

type cbType = (error?: string | null, client?: { client: boolean }) => void;

const authenticate = async (request: IncomingMessage, callback: cbType) => {
  const tokenHeader = request.headers['sec-websocket-protocol'];
  const tokenHeaderKey = 'id_token, ';
  if (!tokenHeader || !tokenHeader.startsWith(tokenHeaderKey)) {
    callback('Incorrect HTTP header \'sec-websocket-protocol\' with OAuth2 token');
    return;
  }

  const token = tokenHeader.replace(/id_token, /, '');
  if (token === DEV_TOKEN) {
    console.log('DEV_TOKEN is correct, skip user verification');
  } else if (CLIENT_ID === undefined) {
    console.error('CLIENT_ID is not specified');
  } else {
    try {
      await verify(token, CLIENT_ID);
    } catch (err) {
      callback(err);
      return;
    }
  }

  const room = getQueryParam(request, QUERY_PARAM_ROOM_NAME);
  if (!room) {
    callback('Room number is not specified');
    return;
  }

  const clientsInRoom = ROOMS_TO_CLIENTS_MAP[room] || [];
  if (clientsInRoom.length >= MAX_CLIENTS_IN_ROOM) {
    callback(`Room volume is exceeded: ${MAX_CLIENTS_IN_ROOM - 1}`);
  } else {
    callback(null, { client: true });
  }
};

server.on('upgrade', async (response: IncomingMessage, socket: Duplex, head: Buffer) => {
  await authenticate(response, (err, client) => {
    if (err || !client) {
      const STATUS_CODES = {
        401: 'Unauthorized',
      };
      const code = 401;

      socket.write(`HTTP/1.1 ${code} ${STATUS_CODES[code]}\r\n\r\n${err}`);
      // FIXME pass error argument once bug is fixed https://github.com/nodejs/node/issues/33434
      socket.destroy();
      console.error(err);
      return;
    }

    wss.handleUpgrade(response, socket as Socket, head, (ws) => {
      wss.emit('connection', ws, response /* client */);
    });
  });
});

wss.on('connection', (ws: MyWebSocket, request: IncomingMessage) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    heartbeat(ws);
  });

  const room = getQueryParam(request, QUERY_PARAM_ROOM_NAME) as string;
  console.log("Connect to room: '%s'.", room);
  const clientsInRoom = ROOMS_TO_CLIENTS_MAP[room] || [];
  ROOMS_TO_CLIENTS_MAP[room] = clientsInRoom.concat(ws);

  ws.on('close', (code: number, reason: string) => {
    ROOMS_TO_CLIENTS_MAP[room] = ROOMS_TO_CLIENTS_MAP[room].filter((client) => client !== ws);
    console.log("Close connection: code '%d', reason '%s'.", code, reason);

    if (ROOMS_TO_CLIENTS_MAP[room].length === 0) {
      delete ROOMS_TO_CLIENTS_MAP[room];
      console.log("Delete room: '%s'.", room);
    }
  });

  ws.on('message', (message: Data) => {
    ROOMS_TO_CLIENTS_MAP[room].forEach((client) => {
      // A client WebSocket broadcasting to all connected WebSocket clients in this room,
      // excluding itself
      if (client !== ws && client.isAlive && client.readyState === WebSocket.OPEN) {
        client.send(message);
        console.log("Send message: '%s'", message);
      }
    });
  });
});

wss.on('close', () => {
  clearInterval(interval);
  console.log('wss closed');
});

const PORT = process.env.PORT || 8000;

server.listen(PORT, () => console.log('Listening on port %s', PORT));
