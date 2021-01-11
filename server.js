require('dotenv').config();
const fs = require('fs');
const WebSocket = require('ws');
const url = require('url');

let http;
let options;

if (process.env.BUILD_ENV === 'prod') {
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

const wss = new WebSocket.Server({server});

/**
 * @type {{[string] : WebSocket[]}}
 */
const ROOMS_TO_CLIENTS_MAP = {};
const QUERY_PARAM_ROOM_NAME = 'room';

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

/* TODO add ws bufferization? */
wss.on("connection", (ws, request) => {
    const room = getQueryParam(request, QUERY_PARAM_ROOM_NAME);
    console.log('room=%s', room);
    const clientsInRoom = ROOMS_TO_CLIENTS_MAP[room] || [];
    ROOMS_TO_CLIENTS_MAP[room] = clientsInRoom.concat(ws);

    ws.on("close", (code, reason) => {
        console.log("Closed: code %d, reason %s", code, reason);
        ROOMS_TO_CLIENTS_MAP[room] = ROOMS_TO_CLIENTS_MAP[room].filter((client) => client !== ws);

        if (ROOMS_TO_CLIENTS_MAP[room].length === 0) {
            delete ROOMS_TO_CLIENTS_MAP[room];
        }
    });

    ws.on("message", (message) => {
        console.log('message=%s', room);
        ROOMS_TO_CLIENTS_MAP[room].forEach((client) => {
            // A client WebSocket broadcasting to all connected WebSocket clients in this room, excluding itself
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message)
            }
        })
    });
});

const PORT = process.env.PORT || 8000;

server.listen(PORT, () => console.log('Listening on port %s', PORT));

