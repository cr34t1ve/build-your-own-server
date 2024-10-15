import * as net from "net";

// A promise-based API for TCP sockets
type TCPConn = {
  // the JS socket object
  socket: net.Socket;
  // from the 'error' event
  err: null | Error;
  // EOF, from the 'end' event
  ended: boolean;
  // the callbacks of the promise of the current read
  reader: null | {
    resolve: (value: Buffer) => void;
    reject: (reason: Error) => void;
  };
};

type DynBuf = {
  data: Buffer;
  length: number;
};

// TODO: convert the `accept` primitive to await
type TCPListener = {
  socket: net.Socket;
};

// append data to DynBuf
function bufPush(buf: DynBuf, data: Buffer): void {
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
function cutMessage(buf: DynBuf): null | Buffer {
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
function bufPop(buf: DynBuf, len: number): void {
  buf.data.copyWithin(0, len, buf.length);
  buf.length -= len;
}

function soInit(socket: net.Socket): TCPConn {
  const conn: TCPConn = {
    socket: socket,
    err: null,
    ended: false,
    reader: null,
  };

  socket.on("data", (data: Buffer) => {
    console.assert(conn.reader);
    // pause the 'data' event until the next thread
    conn.socket.pause();
    // fulfill the promise of the current read
    conn.reader!.resolve(data);
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

  socket.on("error", (err: Error) => {
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
function soRead(conn: TCPConn): Promise<Buffer> {
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

function soWrite(conn: TCPConn, data: Buffer): Promise<void> {
  console.assert(data.length > 0);
  return new Promise((resolve, reject) => {
    if (conn.err) {
      reject(conn.err);
      return;
    }

    conn.socket.write(data, (err?: Error) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

async function serveClient(socket: net.Socket): Promise<void> {
  const conn: TCPConn = soInit(socket);
  const buf: DynBuf = { data: Buffer.alloc(0), length: 0 };
  while (true) {
    // try to get 1 message from the buffer
    const msg = cutMessage(buf);
    if (!msg) {
      // need some data
      const data = await soRead(conn);
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
      await soWrite(conn, Buffer.from("Bye.\n"));
      socket.destroy();
      return;
    } else {
      const reply = Buffer.concat([Buffer.from("Echo: "), msg]);
      await soWrite(conn, reply);
    }
  } // loop for messages
}

async function newConn(socket: net.Socket): Promise<void> {
  console.log("New connection", socket.remoteAddress, socket.remotePort);
  try {
    await serveClient(socket);
  } catch (exc) {
    console.error("exception:", exc);
  } finally {
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
}

let server = net.createServer({
  pauseOnConnect: true, //required by `TCPConn`
});
server.on("connection", newConn);
server.on("error", (err: Error) => {
  throw err;
});
server.listen({ host: "127.0.0.1", port: 1234 });
