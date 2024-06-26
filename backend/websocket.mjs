// https://github.com/llaine/nodejs-websocket-server/blob/master/server.js
// https://github.com/ErickWendel/websockets-with-nodejs-from-scratch/blob/main/nodejs-raw-websocket/server.mjs

import {createServer} from 'http';
import {EventEmitter} from 'events';
import crypto from 'crypto';

export const opcodes = {
    CONTINUE: 0x0,
    TEXT: 0x1,
    BINARY: 0x2,
    CLOSE: 0x8,
    PING: 0x9,
    PONG: 0xa
};
export const readyStates = {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3
};

export function listen(port, connectionHandler) {
    const server = createServer((request, response) => {
        response.writeHead(200).end();
    }).listen(port);

    server.on('upgrade', (request, socket, head) => {
        const websocket = new WebSocketConnection(request, socket, head);
        connectionHandler(websocket);
    });
}

const KEY_SUFFIX = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class WebSocketConnection extends EventEmitter {
    constructor(request, socket, head) {
        super();

        this.key = request.headers['sec-websocket-key'];
        this.socket = socket;
        this.readyState = readyStates.OPEN;

        socket.write([
            'HTTP/1.1 101 Switching Protocols',
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Accept: ${hashWebSocketKey(this.key)}`,
            ''
        ].map(line => line.concat('\r\n')).join(''));

        socket.on('readable', () => this.#processMessage());
    }

    #processMessage() {
        const [byte1] = this.socket.read(1);
        const fin = byte1 & 0b10000000;
        const opcode = byte1 & 0b00001111;

        const [byte2] = this.socket.read(1);
        const mask = byte2 & 0b10000000;
        const lengthIndicator = byte2 & 0b01111111;
        
        if (fin == 0) this.sendCloseFrame(1002, 'fragmented messages not supported')
        if (mask == 0) this.sendCloseFrame(1002, 'message not masked');

        let length;
        if (lengthIndicator <= 125) length = lengthIndicator;
        else if (lengthIndicator == 126) length = socket.read(2).readUint16BE(0);
        else this.sendCloseFrame(1009, 'message too long');

        const maskKey = this.socket.read(4);
        const encoded = this.socket.read(length)
        const decoded = unmask(encoded, maskKey);
        
        this.#handleFrame(opcode, decoded);
    }

    #handleFrame(opcode, buffer) {
        switch (opcode) {
            case opcodes.TEXT:
                this.emit('data', opcode, buffer.toString('utf8'));
                break;
            case opcodes.BINARY:
                this.emit('data', opcode, buffer);
                break;
            case opcodes.PING:
                this.#sendBuffer(opcodes.PONG, buffer);
                break;
            case opcodes.PONG:
                this.emit('data', opcode, buffer);
                break;
            case opcodes.CLOSE:
                this.#receiveCloseFrame(buffer);
                break;
            default:
                this.sendCloseFrame(1002, 'unknown opcode');
        }
    }

    send(object) {
        let opcode, payload;
        if (typeof object == 'string') {
            opcode = opcodes.TEXT;
            payload = Buffer.from(object, 'utf8');
        } else if (Buffer.isBuffer(object)) {
            opcode = opcodes.BINARY;
            payload = object;
        } else throw new Error('Sent message must be a string or buffer.');
        this.#sendBuffer(opcode, payload);
    }

    #sendBuffer(opcode, buffer) {
        this.socket.write(encodeBuffer(opcode, buffer));
    }

    sendCloseFrame(code, reason='') {
        if (this.readyState != readyStates.OPEN) return;
        
        this.readyState = readyStates.CLOSING;

        const buffer = Buffer.allocUnsafe(Buffer.byteLength(reason) + 2);
        buffer.writeUInt16BE(code, 0);
        buffer.write(reason, 2);
        this.socket.end(encodeBuffer(opcodes.CLOSE, buffer));
    }

    #receiveCloseFrame(buffer) {
        const {code, reason} = getCloseCodeAndReason(buffer);

        if (this.readyState == readyStates.OPEN) {
            this.readyState = readyStates.CLOSED;

            this.#sendBuffer(opcodes.CLOSE, buffer);

            this.socket.destroy();
            this.emit('close', code, reason);
        } else if (this.readyState == readyStates.CLOSING) {
            this.socket.destroy();
            this.emit('close', code, reason);
        } else throw new Error('Connection is already in CLOSED state.');
    }
}

function hashWebSocketKey(key) {
    return crypto.createHash('sha1')
        .update(key + KEY_SUFFIX, 'ascii')
        .digest('base64');
}

function unmask(encoded, maskKey) {
    if (!Buffer.isBuffer(encoded)) return Buffer.from([]);

    const decoded = Buffer.from(encoded);
    for (let i = 0; i < encoded.length; i++)
        decoded[i] = encoded[i] ^ maskKey[i % 4];
    return decoded;
}

function encodeBuffer(opcode, buffer) {
    let encoded;

    const byte1 = 0b10000000 | opcode;
    const length = buffer.length;
    let byte2;

    if (length <= 125) {
        encoded = Buffer.allocUnsafe(buffer.length + 2 + 0);
        byte2 = length;
        encoded.writeUInt8(byte1, 0);
        encoded.writeUInt8(byte2, 1);
        buffer.copy(encoded, 2);
    } else if (length < (1 << 16)) {
        encoded = Buffer.allocUnsafe(buffer.length + 2 + 2);
        byte2 = 126;
        encoded.writeUInt8(byte1, 0);
        encoded.writeUInt8(byte2, 1);
        encoded.writeUInt16BE(length, 2);
        buffer.copy(encoded, 4);
    } else if (length < (1 << 16)) {
        encoded = Buffer.allocUnsafe(payload.length + 2 + 8);
        byte2 = 127;
        encoded.writeUInt8(byte1, 0);
        encoded.writeUInt8(byte2, 1);
        encoded.writeUInt32BE(0, 2);
        encoded.writeUInt32BE(length, 6);
        buffer.copy(encoded, 10);
    } else throw new Error('Cannot encode a buffer with a length greater than 2^32.');
    
    return encoded;
}

function getCloseCodeAndReason(buffer) {
    let code, reason;
    if (buffer.length > 2) {
        code = buffer.readUint16BE(0);
        reason = buffer.toString('utf8', 2);
    }
    return {code, reason};
}