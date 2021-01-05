require('dotenv').config();
const fs = require('fs');
const WebSocket = require('ws');

let http;
let options;

if (process.env.PROD) {
    http = require('http');

    options = {};
} else {
    http = require('https');

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

wss.on("connection", (ws) => {
    ws.on("open", () => console.log("Opened"));
    ws.on("close", () => console.log("Closed"));
    ws.on("message", (message) => {
        wss.clients.forEach((client) => {
            // A client WebSocket broadcasting to all connected WebSocket clients, excluding itself
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message)
            }
        })
    });
});

const PORT = process.env.PORT || 8000;

server.listen(PORT, () => console.log('Listening on %s', PORT));

