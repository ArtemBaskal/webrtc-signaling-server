require('dotenv').config();
const fs = require('fs');
const WebSocket = require('ws');
const url = require('url');
const {OAuth2Client} = require('google-auth-library');

let http;
let options;

const BUILD_ENVS = {
    prod: 'prod',
    dev: 'dev'
};

const {BUILD_ENV, DEV_TOKEN, CLIENT_ID} = process.env;
const isProd = BUILD_ENV === BUILD_ENVS.prod;

if (isProd) {
    http = require('http');
    options = {};
} else {
    http = require('https');
    /* Fake cert */
    options = {
        key: fs.readFileSync('key.pem'),
        cert: fs.readFileSync('cert.pem')
    }
}

const server = http.createServer(
    options,
    (request, response) => {
        response.writeHeader(200, {"Content-Type": "text/html; charset=utf-8;"});

        response.write("<h2>WebRTC WebSocket-based Signaling Server</h2>");
        response.end();
    });

const wss = new WebSocket.Server({noServer: true});

/**
 * @type {{[string] : WebSocket[]}}
 */
const ROOMS_TO_CLIENTS_MAP = {};
const QUERY_PARAM_ROOM_NAME = 'room';
const MAX_CLIENTS_IN_ROOM = 2;

/**
 *
 * @param request {object}
 * @param paramName {string}
 * @returns {string}
 */
const getQueryParam = (request, paramName) => {
    const query = url.parse(request.url).query;
    const urlSearchParams = new URLSearchParams(query);

    return urlSearchParams.get(paramName);
};

const noop = () => {
};

const heartbeat = (ws) => {
    ws.isAlive = true;
}

const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            return ws.terminate();
        }

        ws.isAlive = false;
        ws.ping(noop);
    });
}, 30000);

async function verify(token, CLIENT_ID) {
    const client = new OAuth2Client(CLIENT_ID);

    const ticket = await client.verifyIdToken({
        idToken: token,
        audience: CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const {email, name, sub: userid} = payload;
    console.log(`User ${name} <${email}> is verified (userid#${userid})`);
}

const authenticate = async (request, callback) => {
    const tokenHeader = request.headers['sec-websocket-protocol'];
    const tokenHeaderKey = 'id_token, ';
    if (!tokenHeader || !tokenHeader.startsWith(tokenHeaderKey)) {
        return callback(`Incorrect HTTP header 'sec-websocket-protocol' with OAuth2 token`);
    }

    const token = tokenHeader.replace(/id_token, /, '');
    if (token === DEV_TOKEN) {
        console.log('DEV_TOKEN is correct, skip user verification');
    } else {
        try {
            await verify(token, CLIENT_ID);
        } catch (err) {
            return callback(err);
        }
    }

    const room = getQueryParam(request, QUERY_PARAM_ROOM_NAME);
    if (!room) {
        return callback(`Room number is not specified`);
    }

    const clientsInRoom = ROOMS_TO_CLIENTS_MAP[room] || [];
    if (clientsInRoom.length >= MAX_CLIENTS_IN_ROOM) {
        callback(`Room volume is exceeded: ${MAX_CLIENTS_IN_ROOM - 1}`);
    } else {
        // TODO verify client credentials on server
        callback(null, {client: true});
    }
};

server.on('upgrade', (request, socket, head) => {
    authenticate(request, (err, client) => {
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

        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request, /*client*/);
        });
    });
});

wss.on("connection", (ws, request, client) => {
    ws.isAlive = true;
    ws.on("pong", () => {
        heartbeat(ws);
    });

    const room = getQueryParam(request, QUERY_PARAM_ROOM_NAME);
    console.log("Connect to room: '%s'.", room);
    const clientsInRoom = ROOMS_TO_CLIENTS_MAP[room] || [];
    ROOMS_TO_CLIENTS_MAP[room] = clientsInRoom.concat(ws);

    ws.on("close", (code, reason) => {
        ROOMS_TO_CLIENTS_MAP[room] = ROOMS_TO_CLIENTS_MAP[room].filter((client) => client !== ws);
        console.log("Close connection: code '%d', reason '%s'.", code, reason);

        if (ROOMS_TO_CLIENTS_MAP[room].length === 0) {
            delete ROOMS_TO_CLIENTS_MAP[room];
            console.log("Delete room: '%s'.", room);
        }
    });

    ws.on("message", (message) => {
        ROOMS_TO_CLIENTS_MAP[room].forEach((client) => {
            // A client WebSocket broadcasting to all connected WebSocket clients in this room, excluding itself
            if (client !== ws && client.isAlive && client.readyState === WebSocket.OPEN) {
                client.send(message);
                console.log("Send message: '%s'", message);
            }
        })
    });
});

wss.on('close', () => {
    clearInterval(interval);
    console.log('wss closed');
});

const PORT = process.env.PORT || 8000;

server.listen(PORT, () => console.log("Listening on port %s", PORT));

