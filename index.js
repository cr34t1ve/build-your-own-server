"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const net = __importStar(require("net"));
// append data to DynBuf
function bufPush(buf, data) {
    const newLen = buf.length + buf.length;
    if (buf.data.length < newLen) {
        // grow the capacity by the power of two
        let cap = Math.max(buf.data.length, 32);
        while (cap < newLen) {
            cap *= 2;
        }
        const grown = Buffer.alloc(cap);
        buf.data.copy(grown, 0, 0);
        buf.data = grown;
    }
    data.copy(buf.data, buf.length, 0);
    buf.length = newLen;
}
// parse & remove a message from the beginning of the buffer if possible
function cutMessage(buf) {
    // messages are separated by '\n'
    const idx = buf.data.subarray(0, buf.length).indexOf("\n");
    if (idx < 0) {
        return null; // not complete
    }
    // make a copy of the message and move the remaining data to the front
    const msg = Buffer.from(buf.data.subarray(0, idx + 1));
    bufPop(buf, idx + 1);
    return msg;
}
// remove data from the fron
function bufPop(buf, len) {
    buf.data.copyWithin(0, len, buf.length);
    buf.length -= len;
}
function soInit(socket) {
    const conn = {
        socket: socket,
        err: null,
        ended: false,
        reader: null,
    };
    socket.on("data", (data) => {
        console.assert(conn.reader);
        // pause the 'data' event until the next thread
        conn.socket.pause();
        // fulfill the promise of the current read
        conn.reader.resolve(data);
        conn.reader = null;
    });
    socket.on("end", () => {
        // this also fulfills the current read
        conn.ended = true;
        if (conn.reader) {
            conn.reader.resolve(Buffer.from("")); // EOF
            conn.reader = null;
        }
    });
    socket.on("error", (err) => {
        // errors are also delivered to the current read
        conn.err = err;
        if (conn.reader) {
            conn.reader.reject(err);
            conn.reader = null;
        }
    });
    return conn;
}
// returns an empty `Buffer` after EOF
function soRead(conn) {
    console.assert(!conn.reader); // no concurrent calls
    return new Promise((resolve, reject) => {
        // if the connection is not readable, complete the promise now.
        if (conn.err) {
            reject(conn.err);
            return;
        }
        if (conn.ended) {
            resolve(Buffer.from("")); // EOF
            return;
        }
        // save the promise callbacks
        conn.reader = { resolve: resolve, reject: reject };
        // and resume the 'data' event to fulfill the promise later
        conn.socket.resume();
    });
}
function soWrite(conn, data) {
    console.assert(data.length > 0);
    return new Promise((resolve, reject) => {
        if (conn.err) {
            reject(conn.err);
            return;
        }
        conn.socket.write(data, (err) => {
            if (err) {
                reject(err);
            }
            else {
                resolve();
            }
        });
    });
}
function serveClient(socket) {
    return __awaiter(this, void 0, void 0, function* () {
        const conn = soInit(socket);
        const buf = { data: Buffer.alloc(0), length: 0 };
        while (true) {
            // try to get 1 message from the buffer
            const msg = cutMessage(buf);
            if (!msg) {
                // need some data
                const data = yield soRead(conn);
                bufPush(buf, data);
                // EOF?
                if (data.length === 0) {
                    // something here
                    console.log("end connection");
                    break;
                }
                // got some data, try it again
                continue;
            }
            // process the messahe and send the response
            if (msg.equals(Buffer.from("quit\n"))) {
                yield soWrite(conn, Buffer.from("Bye.\n"));
                socket.destroy();
                return;
            }
            else {
                const reply = Buffer.concat([Buffer.from("Echo: "), msg]);
                yield soWrite(conn, reply);
            }
        } // loop for messages
    });
}
function newConn(socket) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("New connection", socket.remoteAddress, socket.remotePort);
        try {
            yield serveClient(socket);
        }
        catch (exc) {
            console.error("exception:", exc);
        }
        finally {
            socket.destroy();
        }
        // MOVED TO ASYNC/AWAIT
        // socket.on("end", () => {
        //   // FIN received. THe connection will be closed automatically
        //   console.log("EOF.");
        // });
        // socket.on("data", (data: Buffer) => {
        //   console.log("data:", data);
        //   socket.write(data); //echo back the data
        //   // Actively close the connection if the data contains 'q'
        //   if (data.includes("q")) {
        //     console.log("closing.");
        //     socket.end(); // this will send FIN and close the connection
        //   }
        // });
    });
}
let server = net.createServer({
    pauseOnConnect: true, //required by `TCPConn`
});
server.on("connection", newConn);
server.on("error", (err) => {
    throw err;
});
server.listen({ host: "127.0.0.1", port: 1234 });
