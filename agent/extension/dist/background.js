(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // node_modules/engine.io-parser/build/esm/commons.js
  var PACKET_TYPES = /* @__PURE__ */ Object.create(null);
  PACKET_TYPES["open"] = "0";
  PACKET_TYPES["close"] = "1";
  PACKET_TYPES["ping"] = "2";
  PACKET_TYPES["pong"] = "3";
  PACKET_TYPES["message"] = "4";
  PACKET_TYPES["upgrade"] = "5";
  PACKET_TYPES["noop"] = "6";
  var PACKET_TYPES_REVERSE = /* @__PURE__ */ Object.create(null);
  Object.keys(PACKET_TYPES).forEach((key) => {
    PACKET_TYPES_REVERSE[PACKET_TYPES[key]] = key;
  });
  var ERROR_PACKET = { type: "error", data: "parser error" };

  // node_modules/engine.io-parser/build/esm/encodePacket.browser.js
  var withNativeBlob = typeof Blob === "function" || typeof Blob !== "undefined" && Object.prototype.toString.call(Blob) === "[object BlobConstructor]";
  var withNativeArrayBuffer = typeof ArrayBuffer === "function";
  var isView = (obj) => {
    return typeof ArrayBuffer.isView === "function" ? ArrayBuffer.isView(obj) : obj && obj.buffer instanceof ArrayBuffer;
  };
  var encodePacket = ({ type, data }, supportsBinary, callback) => {
    if (withNativeBlob && data instanceof Blob) {
      if (supportsBinary) {
        return callback(data);
      } else {
        return encodeBlobAsBase64(data, callback);
      }
    } else if (withNativeArrayBuffer && (data instanceof ArrayBuffer || isView(data))) {
      if (supportsBinary) {
        return callback(data);
      } else {
        return encodeBlobAsBase64(new Blob([data]), callback);
      }
    }
    return callback(PACKET_TYPES[type] + (data || ""));
  };
  var encodeBlobAsBase64 = (data, callback) => {
    const fileReader = new FileReader();
    fileReader.onload = function() {
      const content = fileReader.result.split(",")[1];
      callback("b" + (content || ""));
    };
    return fileReader.readAsDataURL(data);
  };
  function toArray(data) {
    if (data instanceof Uint8Array) {
      return data;
    } else if (data instanceof ArrayBuffer) {
      return new Uint8Array(data);
    } else {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
  }
  var TEXT_ENCODER;
  function encodePacketToBinary(packet, callback) {
    if (withNativeBlob && packet.data instanceof Blob) {
      return packet.data.arrayBuffer().then(toArray).then(callback);
    } else if (withNativeArrayBuffer && (packet.data instanceof ArrayBuffer || isView(packet.data))) {
      return callback(toArray(packet.data));
    }
    encodePacket(packet, false, (encoded) => {
      if (!TEXT_ENCODER) {
        TEXT_ENCODER = new TextEncoder();
      }
      callback(TEXT_ENCODER.encode(encoded));
    });
  }

  // node_modules/engine.io-parser/build/esm/contrib/base64-arraybuffer.js
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var lookup = typeof Uint8Array === "undefined" ? [] : new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
  }
  var decode = (base64) => {
    let bufferLength = base64.length * 0.75, len = base64.length, i, p = 0, encoded1, encoded2, encoded3, encoded4;
    if (base64[base64.length - 1] === "=") {
      bufferLength--;
      if (base64[base64.length - 2] === "=") {
        bufferLength--;
      }
    }
    const arraybuffer = new ArrayBuffer(bufferLength), bytes = new Uint8Array(arraybuffer);
    for (i = 0; i < len; i += 4) {
      encoded1 = lookup[base64.charCodeAt(i)];
      encoded2 = lookup[base64.charCodeAt(i + 1)];
      encoded3 = lookup[base64.charCodeAt(i + 2)];
      encoded4 = lookup[base64.charCodeAt(i + 3)];
      bytes[p++] = encoded1 << 2 | encoded2 >> 4;
      bytes[p++] = (encoded2 & 15) << 4 | encoded3 >> 2;
      bytes[p++] = (encoded3 & 3) << 6 | encoded4 & 63;
    }
    return arraybuffer;
  };

  // node_modules/engine.io-parser/build/esm/decodePacket.browser.js
  var withNativeArrayBuffer2 = typeof ArrayBuffer === "function";
  var decodePacket = (encodedPacket, binaryType) => {
    if (typeof encodedPacket !== "string") {
      return {
        type: "message",
        data: mapBinary(encodedPacket, binaryType)
      };
    }
    const type = encodedPacket.charAt(0);
    if (type === "b") {
      return {
        type: "message",
        data: decodeBase64Packet(encodedPacket.substring(1), binaryType)
      };
    }
    const packetType = PACKET_TYPES_REVERSE[type];
    if (!packetType) {
      return ERROR_PACKET;
    }
    return encodedPacket.length > 1 ? {
      type: PACKET_TYPES_REVERSE[type],
      data: encodedPacket.substring(1)
    } : {
      type: PACKET_TYPES_REVERSE[type]
    };
  };
  var decodeBase64Packet = (data, binaryType) => {
    if (withNativeArrayBuffer2) {
      const decoded = decode(data);
      return mapBinary(decoded, binaryType);
    } else {
      return { base64: true, data };
    }
  };
  var mapBinary = (data, binaryType) => {
    switch (binaryType) {
      case "blob":
        if (data instanceof Blob) {
          return data;
        } else {
          return new Blob([data]);
        }
      case "arraybuffer":
      default:
        if (data instanceof ArrayBuffer) {
          return data;
        } else {
          return data.buffer;
        }
    }
  };

  // node_modules/engine.io-parser/build/esm/index.js
  var SEPARATOR = String.fromCharCode(30);
  var encodePayload = (packets, callback) => {
    const length = packets.length;
    const encodedPackets = new Array(length);
    let count = 0;
    packets.forEach((packet, i) => {
      encodePacket(packet, false, (encodedPacket) => {
        encodedPackets[i] = encodedPacket;
        if (++count === length) {
          callback(encodedPackets.join(SEPARATOR));
        }
      });
    });
  };
  var decodePayload = (encodedPayload, binaryType) => {
    const encodedPackets = encodedPayload.split(SEPARATOR);
    const packets = [];
    for (let i = 0; i < encodedPackets.length; i++) {
      const decodedPacket = decodePacket(encodedPackets[i], binaryType);
      packets.push(decodedPacket);
      if (decodedPacket.type === "error") {
        break;
      }
    }
    return packets;
  };
  function createPacketEncoderStream() {
    return new TransformStream({
      transform(packet, controller) {
        encodePacketToBinary(packet, (encodedPacket) => {
          const payloadLength = encodedPacket.length;
          let header;
          if (payloadLength < 126) {
            header = new Uint8Array(1);
            new DataView(header.buffer).setUint8(0, payloadLength);
          } else if (payloadLength < 65536) {
            header = new Uint8Array(3);
            const view = new DataView(header.buffer);
            view.setUint8(0, 126);
            view.setUint16(1, payloadLength);
          } else {
            header = new Uint8Array(9);
            const view = new DataView(header.buffer);
            view.setUint8(0, 127);
            view.setBigUint64(1, BigInt(payloadLength));
          }
          if (packet.data && typeof packet.data !== "string") {
            header[0] |= 128;
          }
          controller.enqueue(header);
          controller.enqueue(encodedPacket);
        });
      }
    });
  }
  var TEXT_DECODER;
  function totalLength(chunks) {
    return chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  }
  function concatChunks(chunks, size) {
    if (chunks[0].length === size) {
      return chunks.shift();
    }
    const buffer = new Uint8Array(size);
    let j = 0;
    for (let i = 0; i < size; i++) {
      buffer[i] = chunks[0][j++];
      if (j === chunks[0].length) {
        chunks.shift();
        j = 0;
      }
    }
    if (chunks.length && j < chunks[0].length) {
      chunks[0] = chunks[0].slice(j);
    }
    return buffer;
  }
  function createPacketDecoderStream(maxPayload, binaryType) {
    if (!TEXT_DECODER) {
      TEXT_DECODER = new TextDecoder();
    }
    const chunks = [];
    let state = 0;
    let expectedLength = -1;
    let isBinary2 = false;
    return new TransformStream({
      transform(chunk, controller) {
        chunks.push(chunk);
        while (true) {
          if (state === 0) {
            if (totalLength(chunks) < 1) {
              break;
            }
            const header = concatChunks(chunks, 1);
            isBinary2 = (header[0] & 128) === 128;
            expectedLength = header[0] & 127;
            if (expectedLength < 126) {
              state = 3;
            } else if (expectedLength === 126) {
              state = 1;
            } else {
              state = 2;
            }
          } else if (state === 1) {
            if (totalLength(chunks) < 2) {
              break;
            }
            const headerArray = concatChunks(chunks, 2);
            expectedLength = new DataView(headerArray.buffer, headerArray.byteOffset, headerArray.length).getUint16(0);
            state = 3;
          } else if (state === 2) {
            if (totalLength(chunks) < 8) {
              break;
            }
            const headerArray = concatChunks(chunks, 8);
            const view = new DataView(headerArray.buffer, headerArray.byteOffset, headerArray.length);
            const n = view.getUint32(0);
            if (n > Math.pow(2, 53 - 32) - 1) {
              controller.enqueue(ERROR_PACKET);
              break;
            }
            expectedLength = n * Math.pow(2, 32) + view.getUint32(4);
            state = 3;
          } else {
            if (totalLength(chunks) < expectedLength) {
              break;
            }
            const data = concatChunks(chunks, expectedLength);
            controller.enqueue(decodePacket(isBinary2 ? data : TEXT_DECODER.decode(data), binaryType));
            state = 0;
          }
          if (expectedLength === 0 || expectedLength > maxPayload) {
            controller.enqueue(ERROR_PACKET);
            break;
          }
        }
      }
    });
  }
  var protocol = 4;

  // node_modules/@socket.io/component-emitter/lib/esm/index.js
  function Emitter(obj) {
    if (obj)
      return mixin(obj);
  }
  function mixin(obj) {
    for (var key in Emitter.prototype) {
      obj[key] = Emitter.prototype[key];
    }
    return obj;
  }
  Emitter.prototype.on = Emitter.prototype.addEventListener = function(event, fn) {
    this._callbacks = this._callbacks || {};
    (this._callbacks["$" + event] = this._callbacks["$" + event] || []).push(fn);
    return this;
  };
  Emitter.prototype.once = function(event, fn) {
    function on2() {
      this.off(event, on2);
      fn.apply(this, arguments);
    }
    on2.fn = fn;
    this.on(event, on2);
    return this;
  };
  Emitter.prototype.off = Emitter.prototype.removeListener = Emitter.prototype.removeAllListeners = Emitter.prototype.removeEventListener = function(event, fn) {
    this._callbacks = this._callbacks || {};
    if (0 == arguments.length) {
      this._callbacks = {};
      return this;
    }
    var callbacks = this._callbacks["$" + event];
    if (!callbacks)
      return this;
    if (1 == arguments.length) {
      delete this._callbacks["$" + event];
      return this;
    }
    var cb;
    for (var i = 0; i < callbacks.length; i++) {
      cb = callbacks[i];
      if (cb === fn || cb.fn === fn) {
        callbacks.splice(i, 1);
        break;
      }
    }
    if (callbacks.length === 0) {
      delete this._callbacks["$" + event];
    }
    return this;
  };
  Emitter.prototype.emit = function(event) {
    this._callbacks = this._callbacks || {};
    var args = new Array(arguments.length - 1), callbacks = this._callbacks["$" + event];
    for (var i = 1; i < arguments.length; i++) {
      args[i - 1] = arguments[i];
    }
    if (callbacks) {
      callbacks = callbacks.slice(0);
      for (var i = 0, len = callbacks.length; i < len; ++i) {
        callbacks[i].apply(this, args);
      }
    }
    return this;
  };
  Emitter.prototype.emitReserved = Emitter.prototype.emit;
  Emitter.prototype.listeners = function(event) {
    this._callbacks = this._callbacks || {};
    return this._callbacks["$" + event] || [];
  };
  Emitter.prototype.hasListeners = function(event) {
    return !!this.listeners(event).length;
  };

  // node_modules/engine.io-client/build/esm/globals.js
  var nextTick = (() => {
    const isPromiseAvailable = typeof Promise === "function" && typeof Promise.resolve === "function";
    if (isPromiseAvailable) {
      return (cb) => Promise.resolve().then(cb);
    } else {
      return (cb, setTimeoutFn) => setTimeoutFn(cb, 0);
    }
  })();
  var globalThisShim = (() => {
    if (typeof self !== "undefined") {
      return self;
    } else if (typeof window !== "undefined") {
      return window;
    } else {
      return Function("return this")();
    }
  })();
  var defaultBinaryType = "arraybuffer";
  function createCookieJar() {
  }

  // node_modules/engine.io-client/build/esm/util.js
  function pick(obj, ...attr) {
    return attr.reduce((acc, k) => {
      if (obj.hasOwnProperty(k)) {
        acc[k] = obj[k];
      }
      return acc;
    }, {});
  }
  var NATIVE_SET_TIMEOUT = globalThisShim.setTimeout;
  var NATIVE_CLEAR_TIMEOUT = globalThisShim.clearTimeout;
  function installTimerFunctions(obj, opts) {
    if (opts.useNativeTimers) {
      obj.setTimeoutFn = NATIVE_SET_TIMEOUT.bind(globalThisShim);
      obj.clearTimeoutFn = NATIVE_CLEAR_TIMEOUT.bind(globalThisShim);
    } else {
      obj.setTimeoutFn = globalThisShim.setTimeout.bind(globalThisShim);
      obj.clearTimeoutFn = globalThisShim.clearTimeout.bind(globalThisShim);
    }
  }
  var BASE64_OVERHEAD = 1.33;
  function byteLength(obj) {
    if (typeof obj === "string") {
      return utf8Length(obj);
    }
    return Math.ceil((obj.byteLength || obj.size) * BASE64_OVERHEAD);
  }
  function utf8Length(str) {
    let c = 0, length = 0;
    for (let i = 0, l = str.length; i < l; i++) {
      c = str.charCodeAt(i);
      if (c < 128) {
        length += 1;
      } else if (c < 2048) {
        length += 2;
      } else if (c < 55296 || c >= 57344) {
        length += 3;
      } else {
        i++;
        length += 4;
      }
    }
    return length;
  }
  function randomString() {
    return Date.now().toString(36).substring(3) + Math.random().toString(36).substring(2, 5);
  }

  // node_modules/engine.io-client/build/esm/contrib/parseqs.js
  function encode(obj) {
    let str = "";
    for (let i in obj) {
      if (obj.hasOwnProperty(i)) {
        if (str.length)
          str += "&";
        str += encodeURIComponent(i) + "=" + encodeURIComponent(obj[i]);
      }
    }
    return str;
  }
  function decode2(qs) {
    let qry = {};
    let pairs = qs.split("&");
    for (let i = 0, l = pairs.length; i < l; i++) {
      let pair = pairs[i].split("=");
      qry[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
    }
    return qry;
  }

  // node_modules/engine.io-client/build/esm/transport.js
  var TransportError = class extends Error {
    constructor(reason, description, context) {
      super(reason);
      this.description = description;
      this.context = context;
      this.type = "TransportError";
    }
  };
  var Transport = class extends Emitter {
    /**
     * Transport abstract constructor.
     *
     * @param {Object} opts - options
     * @protected
     */
    constructor(opts) {
      super();
      this.writable = false;
      installTimerFunctions(this, opts);
      this.opts = opts;
      this.query = opts.query;
      this.socket = opts.socket;
      this.supportsBinary = !opts.forceBase64;
    }
    /**
     * Emits an error.
     *
     * @param {String} reason
     * @param description
     * @param context - the error context
     * @return {Transport} for chaining
     * @protected
     */
    onError(reason, description, context) {
      super.emitReserved("error", new TransportError(reason, description, context));
      return this;
    }
    /**
     * Opens the transport.
     */
    open() {
      this.readyState = "opening";
      this.doOpen();
      return this;
    }
    /**
     * Closes the transport.
     */
    close() {
      if (this.readyState === "opening" || this.readyState === "open") {
        this.doClose();
        this.onClose();
      }
      return this;
    }
    /**
     * Sends multiple packets.
     *
     * @param {Array} packets
     */
    send(packets) {
      if (this.readyState === "open") {
        this.write(packets);
      } else {
      }
    }
    /**
     * Called upon open
     *
     * @protected
     */
    onOpen() {
      this.readyState = "open";
      this.writable = true;
      super.emitReserved("open");
    }
    /**
     * Called with data.
     *
     * @param {String} data
     * @protected
     */
    onData(data) {
      const packet = decodePacket(data, this.socket.binaryType);
      this.onPacket(packet);
    }
    /**
     * Called with a decoded packet.
     *
     * @protected
     */
    onPacket(packet) {
      super.emitReserved("packet", packet);
    }
    /**
     * Called upon close.
     *
     * @protected
     */
    onClose(details) {
      this.readyState = "closed";
      super.emitReserved("close", details);
    }
    /**
     * Pauses the transport, in order not to lose packets during an upgrade.
     *
     * @param onPause
     */
    pause(onPause) {
    }
    createUri(schema, query = {}) {
      return schema + "://" + this._hostname() + this._port() + this.opts.path + this._query(query);
    }
    _hostname() {
      const hostname = this.opts.hostname;
      return hostname.indexOf(":") === -1 ? hostname : "[" + hostname + "]";
    }
    _port() {
      if (this.opts.port && (this.opts.secure && Number(this.opts.port) !== 443 || !this.opts.secure && Number(this.opts.port) !== 80)) {
        return ":" + this.opts.port;
      } else {
        return "";
      }
    }
    _query(query) {
      const encodedQuery = encode(query);
      return encodedQuery.length ? "?" + encodedQuery : "";
    }
  };

  // node_modules/engine.io-client/build/esm/transports/polling.js
  var Polling = class extends Transport {
    constructor() {
      super(...arguments);
      this._polling = false;
    }
    get name() {
      return "polling";
    }
    /**
     * Opens the socket (triggers polling). We write a PING message to determine
     * when the transport is open.
     *
     * @protected
     */
    doOpen() {
      this._poll();
    }
    /**
     * Pauses polling.
     *
     * @param {Function} onPause - callback upon buffers are flushed and transport is paused
     * @package
     */
    pause(onPause) {
      this.readyState = "pausing";
      const pause = () => {
        this.readyState = "paused";
        onPause();
      };
      if (this._polling || !this.writable) {
        let total = 0;
        if (this._polling) {
          total++;
          this.once("pollComplete", function() {
            --total || pause();
          });
        }
        if (!this.writable) {
          total++;
          this.once("drain", function() {
            --total || pause();
          });
        }
      } else {
        pause();
      }
    }
    /**
     * Starts polling cycle.
     *
     * @private
     */
    _poll() {
      this._polling = true;
      this.doPoll();
      this.emitReserved("poll");
    }
    /**
     * Overloads onData to detect payloads.
     *
     * @protected
     */
    onData(data) {
      const callback = (packet) => {
        if ("opening" === this.readyState && packet.type === "open") {
          this.onOpen();
        }
        if ("close" === packet.type) {
          this.onClose({ description: "transport closed by the server" });
          return false;
        }
        this.onPacket(packet);
      };
      decodePayload(data, this.socket.binaryType).forEach(callback);
      if ("closed" !== this.readyState) {
        this._polling = false;
        this.emitReserved("pollComplete");
        if ("open" === this.readyState) {
          this._poll();
        } else {
        }
      }
    }
    /**
     * For polling, send a close packet.
     *
     * @protected
     */
    doClose() {
      const close = () => {
        this.write([{ type: "close" }]);
      };
      if ("open" === this.readyState) {
        close();
      } else {
        this.once("open", close);
      }
    }
    /**
     * Writes a packets payload.
     *
     * @param {Array} packets - data packets
     * @protected
     */
    write(packets) {
      this.writable = false;
      encodePayload(packets, (data) => {
        this.doWrite(data, () => {
          this.writable = true;
          this.emitReserved("drain");
        });
      });
    }
    /**
     * Generates uri for connection.
     *
     * @private
     */
    uri() {
      const schema = this.opts.secure ? "https" : "http";
      const query = this.query || {};
      if (false !== this.opts.timestampRequests) {
        query[this.opts.timestampParam] = randomString();
      }
      if (!this.supportsBinary && !query.sid) {
        query.b64 = 1;
      }
      return this.createUri(schema, query);
    }
  };

  // node_modules/engine.io-client/build/esm/contrib/has-cors.js
  var value = false;
  try {
    value = typeof XMLHttpRequest !== "undefined" && "withCredentials" in new XMLHttpRequest();
  } catch (err) {
  }
  var hasCORS = value;

  // node_modules/engine.io-client/build/esm/transports/polling-xhr.js
  function empty() {
  }
  var BaseXHR = class extends Polling {
    /**
     * XHR Polling constructor.
     *
     * @param {Object} opts
     * @package
     */
    constructor(opts) {
      super(opts);
      if (typeof location !== "undefined") {
        const isSSL = "https:" === location.protocol;
        let port = location.port;
        if (!port) {
          port = isSSL ? "443" : "80";
        }
        this.xd = typeof location !== "undefined" && opts.hostname !== location.hostname || port !== opts.port;
      }
    }
    /**
     * Sends data.
     *
     * @param {String} data - data to send.
     * @param {Function} fn - called upon flush.
     * @private
     */
    doWrite(data, fn) {
      const req = this.request({
        method: "POST",
        data
      });
      req.on("success", fn);
      req.on("error", (xhrStatus, context) => {
        this.onError("xhr post error", xhrStatus, context);
      });
    }
    /**
     * Starts a poll cycle.
     *
     * @private
     */
    doPoll() {
      const req = this.request();
      req.on("data", this.onData.bind(this));
      req.on("error", (xhrStatus, context) => {
        this.onError("xhr poll error", xhrStatus, context);
      });
      this.pollXhr = req;
    }
  };
  var Request = class _Request extends Emitter {
    /**
     * Request constructor
     *
     * @param {Object} options
     * @package
     */
    constructor(createRequest, uri, opts) {
      super();
      this.createRequest = createRequest;
      installTimerFunctions(this, opts);
      this._opts = opts;
      this._method = opts.method || "GET";
      this._uri = uri;
      this._data = void 0 !== opts.data ? opts.data : null;
      this._create();
    }
    /**
     * Creates the XHR object and sends the request.
     *
     * @private
     */
    _create() {
      var _a;
      const opts = pick(this._opts, "agent", "pfx", "key", "passphrase", "cert", "ca", "ciphers", "rejectUnauthorized", "autoUnref");
      opts.xdomain = !!this._opts.xd;
      const xhr = this._xhr = this.createRequest(opts);
      try {
        xhr.open(this._method, this._uri, true);
        try {
          if (this._opts.extraHeaders) {
            xhr.setDisableHeaderCheck && xhr.setDisableHeaderCheck(true);
            for (let i in this._opts.extraHeaders) {
              if (this._opts.extraHeaders.hasOwnProperty(i)) {
                xhr.setRequestHeader(i, this._opts.extraHeaders[i]);
              }
            }
          }
        } catch (e) {
        }
        if ("POST" === this._method) {
          try {
            xhr.setRequestHeader("Content-type", "text/plain;charset=UTF-8");
          } catch (e) {
          }
        }
        try {
          xhr.setRequestHeader("Accept", "*/*");
        } catch (e) {
        }
        (_a = this._opts.cookieJar) === null || _a === void 0 ? void 0 : _a.addCookies(xhr);
        if ("withCredentials" in xhr) {
          xhr.withCredentials = this._opts.withCredentials;
        }
        if (this._opts.requestTimeout) {
          xhr.timeout = this._opts.requestTimeout;
        }
        xhr.onreadystatechange = () => {
          var _a2;
          if (xhr.readyState === 3) {
            (_a2 = this._opts.cookieJar) === null || _a2 === void 0 ? void 0 : _a2.parseCookies(
              // @ts-ignore
              xhr.getResponseHeader("set-cookie")
            );
          }
          if (4 !== xhr.readyState)
            return;
          if (200 === xhr.status || 1223 === xhr.status) {
            this._onLoad();
          } else {
            this.setTimeoutFn(() => {
              this._onError(typeof xhr.status === "number" ? xhr.status : 0);
            }, 0);
          }
        };
        xhr.send(this._data);
      } catch (e) {
        this.setTimeoutFn(() => {
          this._onError(e);
        }, 0);
        return;
      }
      if (typeof document !== "undefined") {
        this._index = _Request.requestsCount++;
        _Request.requests[this._index] = this;
      }
    }
    /**
     * Called upon error.
     *
     * @private
     */
    _onError(err) {
      this.emitReserved("error", err, this._xhr);
      this._cleanup(true);
    }
    /**
     * Cleans up house.
     *
     * @private
     */
    _cleanup(fromError) {
      if ("undefined" === typeof this._xhr || null === this._xhr) {
        return;
      }
      this._xhr.onreadystatechange = empty;
      if (fromError) {
        try {
          this._xhr.abort();
        } catch (e) {
        }
      }
      if (typeof document !== "undefined") {
        delete _Request.requests[this._index];
      }
      this._xhr = null;
    }
    /**
     * Called upon load.
     *
     * @private
     */
    _onLoad() {
      const data = this._xhr.responseText;
      if (data !== null) {
        this.emitReserved("data", data);
        this.emitReserved("success");
        this._cleanup();
      }
    }
    /**
     * Aborts the request.
     *
     * @package
     */
    abort() {
      this._cleanup();
    }
  };
  Request.requestsCount = 0;
  Request.requests = {};
  if (typeof document !== "undefined") {
    if (typeof attachEvent === "function") {
      attachEvent("onunload", unloadHandler);
    } else if (typeof addEventListener === "function") {
      const terminationEvent = "onpagehide" in globalThisShim ? "pagehide" : "unload";
      addEventListener(terminationEvent, unloadHandler, false);
    }
  }
  function unloadHandler() {
    for (let i in Request.requests) {
      if (Request.requests.hasOwnProperty(i)) {
        Request.requests[i].abort();
      }
    }
  }
  var hasXHR2 = function() {
    const xhr = newRequest({
      xdomain: false
    });
    return xhr && xhr.responseType !== null;
  }();
  var XHR = class extends BaseXHR {
    constructor(opts) {
      super(opts);
      const forceBase64 = opts && opts.forceBase64;
      this.supportsBinary = hasXHR2 && !forceBase64;
    }
    request(opts = {}) {
      Object.assign(opts, { xd: this.xd }, this.opts);
      return new Request(newRequest, this.uri(), opts);
    }
  };
  function newRequest(opts) {
    const xdomain = opts.xdomain;
    try {
      if ("undefined" !== typeof XMLHttpRequest && (!xdomain || hasCORS)) {
        return new XMLHttpRequest();
      }
    } catch (e) {
    }
    if (!xdomain) {
      try {
        return new globalThisShim[["Active"].concat("Object").join("X")]("Microsoft.XMLHTTP");
      } catch (e) {
      }
    }
  }

  // node_modules/engine.io-client/build/esm/transports/websocket.js
  var isReactNative = typeof navigator !== "undefined" && typeof navigator.product === "string" && navigator.product.toLowerCase() === "reactnative";
  var BaseWS = class extends Transport {
    get name() {
      return "websocket";
    }
    doOpen() {
      const uri = this.uri();
      const protocols = this.opts.protocols;
      const opts = isReactNative ? {} : pick(this.opts, "agent", "perMessageDeflate", "pfx", "key", "passphrase", "cert", "ca", "ciphers", "rejectUnauthorized", "localAddress", "protocolVersion", "origin", "maxPayload", "family", "checkServerIdentity");
      if (this.opts.extraHeaders) {
        opts.headers = this.opts.extraHeaders;
      }
      try {
        this.ws = this.createSocket(uri, protocols, opts);
      } catch (err) {
        return this.emitReserved("error", err);
      }
      this.ws.binaryType = this.socket.binaryType;
      this.addEventListeners();
    }
    /**
     * Adds event listeners to the socket
     *
     * @private
     */
    addEventListeners() {
      this.ws.onopen = () => {
        if (this.opts.autoUnref) {
          this.ws._socket.unref();
        }
        this.onOpen();
      };
      this.ws.onclose = (closeEvent) => this.onClose({
        description: "websocket connection closed",
        context: closeEvent
      });
      this.ws.onmessage = (ev) => this.onData(ev.data);
      this.ws.onerror = (e) => this.onError("websocket error", e);
    }
    write(packets) {
      this.writable = false;
      for (let i = 0; i < packets.length; i++) {
        const packet = packets[i];
        const lastPacket = i === packets.length - 1;
        encodePacket(packet, this.supportsBinary, (data) => {
          try {
            this.doWrite(packet, data);
          } catch (e) {
          }
          if (lastPacket) {
            nextTick(() => {
              this.writable = true;
              this.emitReserved("drain");
            }, this.setTimeoutFn);
          }
        });
      }
    }
    doClose() {
      if (typeof this.ws !== "undefined") {
        this.ws.onerror = () => {
        };
        this.ws.close();
        this.ws = null;
      }
    }
    /**
     * Generates uri for connection.
     *
     * @private
     */
    uri() {
      const schema = this.opts.secure ? "wss" : "ws";
      const query = this.query || {};
      if (this.opts.timestampRequests) {
        query[this.opts.timestampParam] = randomString();
      }
      if (!this.supportsBinary) {
        query.b64 = 1;
      }
      return this.createUri(schema, query);
    }
  };
  var WebSocketCtor = globalThisShim.WebSocket || globalThisShim.MozWebSocket;
  var WS = class extends BaseWS {
    createSocket(uri, protocols, opts) {
      return !isReactNative ? protocols ? new WebSocketCtor(uri, protocols) : new WebSocketCtor(uri) : new WebSocketCtor(uri, protocols, opts);
    }
    doWrite(_packet, data) {
      this.ws.send(data);
    }
  };

  // node_modules/engine.io-client/build/esm/transports/webtransport.js
  var WT = class extends Transport {
    get name() {
      return "webtransport";
    }
    doOpen() {
      try {
        this._transport = new WebTransport(this.createUri("https"), this.opts.transportOptions[this.name]);
      } catch (err) {
        return this.emitReserved("error", err);
      }
      this._transport.closed.then(() => {
        this.onClose();
      }).catch((err) => {
        this.onError("webtransport error", err);
      });
      this._transport.ready.then(() => {
        this._transport.createBidirectionalStream().then((stream) => {
          const decoderStream = createPacketDecoderStream(Number.MAX_SAFE_INTEGER, this.socket.binaryType);
          const reader = stream.readable.pipeThrough(decoderStream).getReader();
          const encoderStream = createPacketEncoderStream();
          encoderStream.readable.pipeTo(stream.writable);
          this._writer = encoderStream.writable.getWriter();
          const read = () => {
            reader.read().then(({ done, value: value2 }) => {
              if (done) {
                return;
              }
              this.onPacket(value2);
              read();
            }).catch((err) => {
            });
          };
          read();
          const packet = { type: "open" };
          if (this.query.sid) {
            packet.data = `{"sid":"${this.query.sid}"}`;
          }
          this._writer.write(packet).then(() => this.onOpen());
        });
      });
    }
    write(packets) {
      this.writable = false;
      for (let i = 0; i < packets.length; i++) {
        const packet = packets[i];
        const lastPacket = i === packets.length - 1;
        this._writer.write(packet).then(() => {
          if (lastPacket) {
            nextTick(() => {
              this.writable = true;
              this.emitReserved("drain");
            }, this.setTimeoutFn);
          }
        });
      }
    }
    doClose() {
      var _a;
      (_a = this._transport) === null || _a === void 0 ? void 0 : _a.close();
    }
  };

  // node_modules/engine.io-client/build/esm/transports/index.js
  var transports = {
    websocket: WS,
    webtransport: WT,
    polling: XHR
  };

  // node_modules/engine.io-client/build/esm/contrib/parseuri.js
  var re = /^(?:(?![^:@\/?#]+:[^:@\/]*@)(http|https|ws|wss):\/\/)?((?:(([^:@\/?#]*)(?::([^:@\/?#]*))?)?@)?((?:[a-f0-9]{0,4}:){2,7}[a-f0-9]{0,4}|[^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/;
  var parts = [
    "source",
    "protocol",
    "authority",
    "userInfo",
    "user",
    "password",
    "host",
    "port",
    "relative",
    "path",
    "directory",
    "file",
    "query",
    "anchor"
  ];
  function parse(str) {
    if (str.length > 8e3) {
      throw "URI too long";
    }
    const src = str, b = str.indexOf("["), e = str.indexOf("]");
    if (b != -1 && e != -1) {
      str = str.substring(0, b) + str.substring(b, e).replace(/:/g, ";") + str.substring(e, str.length);
    }
    let m = re.exec(str || ""), uri = {}, i = 14;
    while (i--) {
      uri[parts[i]] = m[i] || "";
    }
    if (b != -1 && e != -1) {
      uri.source = src;
      uri.host = uri.host.substring(1, uri.host.length - 1).replace(/;/g, ":");
      uri.authority = uri.authority.replace("[", "").replace("]", "").replace(/;/g, ":");
      uri.ipv6uri = true;
    }
    uri.pathNames = pathNames(uri, uri["path"]);
    uri.queryKey = queryKey(uri, uri["query"]);
    return uri;
  }
  function pathNames(obj, path) {
    const regx = /\/{2,9}/g, names = path.replace(regx, "/").split("/");
    if (path.slice(0, 1) == "/" || path.length === 0) {
      names.splice(0, 1);
    }
    if (path.slice(-1) == "/") {
      names.splice(names.length - 1, 1);
    }
    return names;
  }
  function queryKey(uri, query) {
    const data = {};
    query.replace(/(?:^|&)([^&=]*)=?([^&]*)/g, function($0, $1, $2) {
      if ($1) {
        data[$1] = $2;
      }
    });
    return data;
  }

  // node_modules/engine.io-client/build/esm/socket.js
  var withEventListeners = typeof addEventListener === "function" && typeof removeEventListener === "function";
  var OFFLINE_EVENT_LISTENERS = [];
  if (withEventListeners) {
    addEventListener("offline", () => {
      OFFLINE_EVENT_LISTENERS.forEach((listener) => listener());
    }, false);
  }
  var SocketWithoutUpgrade = class _SocketWithoutUpgrade extends Emitter {
    /**
     * Socket constructor.
     *
     * @param {String|Object} uri - uri or options
     * @param {Object} opts - options
     */
    constructor(uri, opts) {
      super();
      this.binaryType = defaultBinaryType;
      this.writeBuffer = [];
      this._prevBufferLen = 0;
      this._pingInterval = -1;
      this._pingTimeout = -1;
      this._maxPayload = -1;
      this._pingTimeoutTime = Infinity;
      if (uri && "object" === typeof uri) {
        opts = uri;
        uri = null;
      }
      if (uri) {
        const parsedUri = parse(uri);
        opts.hostname = parsedUri.host;
        opts.secure = parsedUri.protocol === "https" || parsedUri.protocol === "wss";
        opts.port = parsedUri.port;
        if (parsedUri.query)
          opts.query = parsedUri.query;
      } else if (opts.host) {
        opts.hostname = parse(opts.host).host;
      }
      installTimerFunctions(this, opts);
      this.secure = null != opts.secure ? opts.secure : typeof location !== "undefined" && "https:" === location.protocol;
      if (opts.hostname && !opts.port) {
        opts.port = this.secure ? "443" : "80";
      }
      this.hostname = opts.hostname || (typeof location !== "undefined" ? location.hostname : "localhost");
      this.port = opts.port || (typeof location !== "undefined" && location.port ? location.port : this.secure ? "443" : "80");
      this.transports = [];
      this._transportsByName = {};
      opts.transports.forEach((t) => {
        const transportName = t.prototype.name;
        this.transports.push(transportName);
        this._transportsByName[transportName] = t;
      });
      this.opts = Object.assign({
        path: "/engine.io",
        agent: false,
        withCredentials: false,
        upgrade: true,
        timestampParam: "t",
        rememberUpgrade: false,
        addTrailingSlash: true,
        rejectUnauthorized: true,
        perMessageDeflate: {
          threshold: 1024
        },
        transportOptions: {},
        closeOnBeforeunload: false
      }, opts);
      this.opts.path = this.opts.path.replace(/\/$/, "") + (this.opts.addTrailingSlash ? "/" : "");
      if (typeof this.opts.query === "string") {
        this.opts.query = decode2(this.opts.query);
      }
      if (withEventListeners) {
        if (this.opts.closeOnBeforeunload) {
          this._beforeunloadEventListener = () => {
            if (this.transport) {
              this.transport.removeAllListeners();
              this.transport.close();
            }
          };
          addEventListener("beforeunload", this._beforeunloadEventListener, false);
        }
        if (this.hostname !== "localhost") {
          this._offlineEventListener = () => {
            this._onClose("transport close", {
              description: "network connection lost"
            });
          };
          OFFLINE_EVENT_LISTENERS.push(this._offlineEventListener);
        }
      }
      if (this.opts.withCredentials) {
        this._cookieJar = createCookieJar();
      }
      this._open();
    }
    /**
     * Creates transport of the given type.
     *
     * @param {String} name - transport name
     * @return {Transport}
     * @private
     */
    createTransport(name) {
      const query = Object.assign({}, this.opts.query);
      query.EIO = protocol;
      query.transport = name;
      if (this.id)
        query.sid = this.id;
      const opts = Object.assign({}, this.opts, {
        query,
        socket: this,
        hostname: this.hostname,
        secure: this.secure,
        port: this.port
      }, this.opts.transportOptions[name]);
      return new this._transportsByName[name](opts);
    }
    /**
     * Initializes transport to use and starts probe.
     *
     * @private
     */
    _open() {
      if (this.transports.length === 0) {
        this.setTimeoutFn(() => {
          this.emitReserved("error", "No transports available");
        }, 0);
        return;
      }
      const transportName = this.opts.rememberUpgrade && _SocketWithoutUpgrade.priorWebsocketSuccess && this.transports.indexOf("websocket") !== -1 ? "websocket" : this.transports[0];
      this.readyState = "opening";
      const transport = this.createTransport(transportName);
      transport.open();
      this.setTransport(transport);
    }
    /**
     * Sets the current transport. Disables the existing one (if any).
     *
     * @private
     */
    setTransport(transport) {
      if (this.transport) {
        this.transport.removeAllListeners();
      }
      this.transport = transport;
      transport.on("drain", this._onDrain.bind(this)).on("packet", this._onPacket.bind(this)).on("error", this._onError.bind(this)).on("close", (reason) => this._onClose("transport close", reason));
    }
    /**
     * Called when connection is deemed open.
     *
     * @private
     */
    onOpen() {
      this.readyState = "open";
      _SocketWithoutUpgrade.priorWebsocketSuccess = "websocket" === this.transport.name;
      this.emitReserved("open");
      this.flush();
    }
    /**
     * Handles a packet.
     *
     * @private
     */
    _onPacket(packet) {
      if ("opening" === this.readyState || "open" === this.readyState || "closing" === this.readyState) {
        this.emitReserved("packet", packet);
        this.emitReserved("heartbeat");
        switch (packet.type) {
          case "open":
            this.onHandshake(JSON.parse(packet.data));
            break;
          case "ping":
            this._sendPacket("pong");
            this.emitReserved("ping");
            this.emitReserved("pong");
            this._resetPingTimeout();
            break;
          case "error":
            const err = new Error("server error");
            err.code = packet.data;
            this._onError(err);
            break;
          case "message":
            this.emitReserved("data", packet.data);
            this.emitReserved("message", packet.data);
            break;
        }
      } else {
      }
    }
    /**
     * Called upon handshake completion.
     *
     * @param {Object} data - handshake obj
     * @private
     */
    onHandshake(data) {
      this.emitReserved("handshake", data);
      this.id = data.sid;
      this.transport.query.sid = data.sid;
      this._pingInterval = data.pingInterval;
      this._pingTimeout = data.pingTimeout;
      this._maxPayload = data.maxPayload;
      this.onOpen();
      if ("closed" === this.readyState)
        return;
      this._resetPingTimeout();
    }
    /**
     * Sets and resets ping timeout timer based on server pings.
     *
     * @private
     */
    _resetPingTimeout() {
      this.clearTimeoutFn(this._pingTimeoutTimer);
      const delay2 = this._pingInterval + this._pingTimeout;
      this._pingTimeoutTime = Date.now() + delay2;
      this._pingTimeoutTimer = this.setTimeoutFn(() => {
        this._onClose("ping timeout");
      }, delay2);
      if (this.opts.autoUnref) {
        this._pingTimeoutTimer.unref();
      }
    }
    /**
     * Called on `drain` event
     *
     * @private
     */
    _onDrain() {
      this.writeBuffer.splice(0, this._prevBufferLen);
      this._prevBufferLen = 0;
      if (0 === this.writeBuffer.length) {
        this.emitReserved("drain");
      } else {
        this.flush();
      }
    }
    /**
     * Flush write buffers.
     *
     * @private
     */
    flush() {
      if ("closed" !== this.readyState && this.transport.writable && !this.upgrading && this.writeBuffer.length) {
        const packets = this._getWritablePackets();
        this.transport.send(packets);
        this._prevBufferLen = packets.length;
        this.emitReserved("flush");
      }
    }
    /**
     * Ensure the encoded size of the writeBuffer is below the maxPayload value sent by the server (only for HTTP
     * long-polling)
     *
     * @private
     */
    _getWritablePackets() {
      const shouldCheckPayloadSize = this._maxPayload && this.transport.name === "polling" && this.writeBuffer.length > 1;
      if (!shouldCheckPayloadSize) {
        return this.writeBuffer;
      }
      let payloadSize = 1;
      for (let i = 0; i < this.writeBuffer.length; i++) {
        const data = this.writeBuffer[i].data;
        if (data) {
          payloadSize += byteLength(data);
        }
        if (i > 0 && payloadSize > this._maxPayload) {
          return this.writeBuffer.slice(0, i);
        }
        payloadSize += 2;
      }
      return this.writeBuffer;
    }
    /**
     * Checks whether the heartbeat timer has expired but the socket has not yet been notified.
     *
     * Note: this method is private for now because it does not really fit the WebSocket API, but if we put it in the
     * `write()` method then the message would not be buffered by the Socket.IO client.
     *
     * @return {boolean}
     * @private
     */
    /* private */
    _hasPingExpired() {
      if (!this._pingTimeoutTime)
        return true;
      const hasExpired = Date.now() > this._pingTimeoutTime;
      if (hasExpired) {
        this._pingTimeoutTime = 0;
        nextTick(() => {
          this._onClose("ping timeout");
        }, this.setTimeoutFn);
      }
      return hasExpired;
    }
    /**
     * Sends a message.
     *
     * @param {String} msg - message.
     * @param {Object} options.
     * @param {Function} fn - callback function.
     * @return {Socket} for chaining.
     */
    write(msg, options, fn) {
      this._sendPacket("message", msg, options, fn);
      return this;
    }
    /**
     * Sends a message. Alias of {@link Socket#write}.
     *
     * @param {String} msg - message.
     * @param {Object} options.
     * @param {Function} fn - callback function.
     * @return {Socket} for chaining.
     */
    send(msg, options, fn) {
      this._sendPacket("message", msg, options, fn);
      return this;
    }
    /**
     * Sends a packet.
     *
     * @param {String} type - packet type.
     * @param {String} data.
     * @param {Object} options.
     * @param {Function} fn - callback function.
     * @private
     */
    _sendPacket(type, data, options, fn) {
      if ("function" === typeof data) {
        fn = data;
        data = void 0;
      }
      if ("function" === typeof options) {
        fn = options;
        options = null;
      }
      if ("closing" === this.readyState || "closed" === this.readyState) {
        return;
      }
      options = options || {};
      options.compress = false !== options.compress;
      const packet = {
        type,
        data,
        options
      };
      this.emitReserved("packetCreate", packet);
      this.writeBuffer.push(packet);
      if (fn)
        this.once("flush", fn);
      this.flush();
    }
    /**
     * Closes the connection.
     */
    close() {
      const close = () => {
        this._onClose("forced close");
        this.transport.close();
      };
      const cleanupAndClose = () => {
        this.off("upgrade", cleanupAndClose);
        this.off("upgradeError", cleanupAndClose);
        close();
      };
      const waitForUpgrade = () => {
        this.once("upgrade", cleanupAndClose);
        this.once("upgradeError", cleanupAndClose);
      };
      if ("opening" === this.readyState || "open" === this.readyState) {
        this.readyState = "closing";
        if (this.writeBuffer.length) {
          this.once("drain", () => {
            if (this.upgrading) {
              waitForUpgrade();
            } else {
              close();
            }
          });
        } else if (this.upgrading) {
          waitForUpgrade();
        } else {
          close();
        }
      }
      return this;
    }
    /**
     * Called upon transport error
     *
     * @private
     */
    _onError(err) {
      _SocketWithoutUpgrade.priorWebsocketSuccess = false;
      if (this.opts.tryAllTransports && this.transports.length > 1 && this.readyState === "opening") {
        this.transports.shift();
        return this._open();
      }
      this.emitReserved("error", err);
      this._onClose("transport error", err);
    }
    /**
     * Called upon transport close.
     *
     * @private
     */
    _onClose(reason, description) {
      if ("opening" === this.readyState || "open" === this.readyState || "closing" === this.readyState) {
        this.clearTimeoutFn(this._pingTimeoutTimer);
        this.transport.removeAllListeners("close");
        this.transport.close();
        this.transport.removeAllListeners();
        if (withEventListeners) {
          if (this._beforeunloadEventListener) {
            removeEventListener("beforeunload", this._beforeunloadEventListener, false);
          }
          if (this._offlineEventListener) {
            const i = OFFLINE_EVENT_LISTENERS.indexOf(this._offlineEventListener);
            if (i !== -1) {
              OFFLINE_EVENT_LISTENERS.splice(i, 1);
            }
          }
        }
        this.readyState = "closed";
        this.id = null;
        this.emitReserved("close", reason, description);
        this.writeBuffer = [];
        this._prevBufferLen = 0;
      }
    }
  };
  SocketWithoutUpgrade.protocol = protocol;
  var SocketWithUpgrade = class extends SocketWithoutUpgrade {
    constructor() {
      super(...arguments);
      this._upgrades = [];
    }
    onOpen() {
      super.onOpen();
      if ("open" === this.readyState && this.opts.upgrade) {
        for (let i = 0; i < this._upgrades.length; i++) {
          this._probe(this._upgrades[i]);
        }
      }
    }
    /**
     * Probes a transport.
     *
     * @param {String} name - transport name
     * @private
     */
    _probe(name) {
      let transport = this.createTransport(name);
      let failed = false;
      SocketWithoutUpgrade.priorWebsocketSuccess = false;
      const onTransportOpen = () => {
        if (failed)
          return;
        transport.send([{ type: "ping", data: "probe" }]);
        transport.once("packet", (msg) => {
          if (failed)
            return;
          if ("pong" === msg.type && "probe" === msg.data) {
            this.upgrading = true;
            this.emitReserved("upgrading", transport);
            if (!transport)
              return;
            SocketWithoutUpgrade.priorWebsocketSuccess = "websocket" === transport.name;
            this.transport.pause(() => {
              if (failed)
                return;
              if ("closed" === this.readyState)
                return;
              cleanup();
              this.setTransport(transport);
              transport.send([{ type: "upgrade" }]);
              this.emitReserved("upgrade", transport);
              transport = null;
              this.upgrading = false;
              this.flush();
            });
          } else {
            const err = new Error("probe error");
            err.transport = transport.name;
            this.emitReserved("upgradeError", err);
          }
        });
      };
      function freezeTransport() {
        if (failed)
          return;
        failed = true;
        cleanup();
        transport.close();
        transport = null;
      }
      const onerror = (err) => {
        const error = new Error("probe error: " + err);
        error.transport = transport.name;
        freezeTransport();
        this.emitReserved("upgradeError", error);
      };
      function onTransportClose() {
        onerror("transport closed");
      }
      function onclose() {
        onerror("socket closed");
      }
      function onupgrade(to) {
        if (transport && to.name !== transport.name) {
          freezeTransport();
        }
      }
      const cleanup = () => {
        transport.removeListener("open", onTransportOpen);
        transport.removeListener("error", onerror);
        transport.removeListener("close", onTransportClose);
        this.off("close", onclose);
        this.off("upgrading", onupgrade);
      };
      transport.once("open", onTransportOpen);
      transport.once("error", onerror);
      transport.once("close", onTransportClose);
      this.once("close", onclose);
      this.once("upgrading", onupgrade);
      if (this._upgrades.indexOf("webtransport") !== -1 && name !== "webtransport") {
        this.setTimeoutFn(() => {
          if (!failed) {
            transport.open();
          }
        }, 200);
      } else {
        transport.open();
      }
    }
    onHandshake(data) {
      this._upgrades = this._filterUpgrades(data.upgrades);
      super.onHandshake(data);
    }
    /**
     * Filters upgrades, returning only those matching client transports.
     *
     * @param {Array} upgrades - server upgrades
     * @private
     */
    _filterUpgrades(upgrades) {
      const filteredUpgrades = [];
      for (let i = 0; i < upgrades.length; i++) {
        if (~this.transports.indexOf(upgrades[i]))
          filteredUpgrades.push(upgrades[i]);
      }
      return filteredUpgrades;
    }
  };
  var Socket = class extends SocketWithUpgrade {
    constructor(uri, opts = {}) {
      const o = typeof uri === "object" ? uri : opts;
      if (!o.transports || o.transports && typeof o.transports[0] === "string") {
        o.transports = (o.transports || ["polling", "websocket", "webtransport"]).map((transportName) => transports[transportName]).filter((t) => !!t);
      }
      super(uri, o);
    }
  };

  // node_modules/engine.io-client/build/esm/index.js
  var protocol2 = Socket.protocol;

  // node_modules/socket.io-client/build/esm/url.js
  function url(uri, path = "", loc) {
    let obj = uri;
    loc = loc || typeof location !== "undefined" && location;
    if (null == uri)
      uri = loc.protocol + "//" + loc.host;
    if (typeof uri === "string") {
      if ("/" === uri.charAt(0)) {
        if ("/" === uri.charAt(1)) {
          uri = loc.protocol + uri;
        } else {
          uri = loc.host + uri;
        }
      }
      if (!/^(https?|wss?):\/\//.test(uri)) {
        if ("undefined" !== typeof loc) {
          uri = loc.protocol + "//" + uri;
        } else {
          uri = "https://" + uri;
        }
      }
      obj = parse(uri);
    }
    if (!obj.port) {
      if (/^(http|ws)$/.test(obj.protocol)) {
        obj.port = "80";
      } else if (/^(http|ws)s$/.test(obj.protocol)) {
        obj.port = "443";
      }
    }
    obj.path = obj.path || "/";
    const ipv6 = obj.host.indexOf(":") !== -1;
    const host = ipv6 ? "[" + obj.host + "]" : obj.host;
    obj.id = obj.protocol + "://" + host + ":" + obj.port + path;
    obj.href = obj.protocol + "://" + host + (loc && loc.port === obj.port ? "" : ":" + obj.port);
    return obj;
  }

  // node_modules/socket.io-parser/build/esm/index.js
  var esm_exports = {};
  __export(esm_exports, {
    Decoder: () => Decoder,
    Encoder: () => Encoder,
    PacketType: () => PacketType,
    isPacketValid: () => isPacketValid,
    protocol: () => protocol3
  });

  // node_modules/socket.io-parser/build/esm/is-binary.js
  var withNativeArrayBuffer3 = typeof ArrayBuffer === "function";
  var isView2 = (obj) => {
    return typeof ArrayBuffer.isView === "function" ? ArrayBuffer.isView(obj) : obj.buffer instanceof ArrayBuffer;
  };
  var toString = Object.prototype.toString;
  var withNativeBlob2 = typeof Blob === "function" || typeof Blob !== "undefined" && toString.call(Blob) === "[object BlobConstructor]";
  var withNativeFile = typeof File === "function" || typeof File !== "undefined" && toString.call(File) === "[object FileConstructor]";
  function isBinary(obj) {
    return withNativeArrayBuffer3 && (obj instanceof ArrayBuffer || isView2(obj)) || withNativeBlob2 && obj instanceof Blob || withNativeFile && obj instanceof File;
  }
  function hasBinary(obj, toJSON) {
    if (!obj || typeof obj !== "object") {
      return false;
    }
    if (Array.isArray(obj)) {
      for (let i = 0, l = obj.length; i < l; i++) {
        if (hasBinary(obj[i])) {
          return true;
        }
      }
      return false;
    }
    if (isBinary(obj)) {
      return true;
    }
    if (obj.toJSON && typeof obj.toJSON === "function" && arguments.length === 1) {
      return hasBinary(obj.toJSON(), true);
    }
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key) && hasBinary(obj[key])) {
        return true;
      }
    }
    return false;
  }

  // node_modules/socket.io-parser/build/esm/binary.js
  function deconstructPacket(packet) {
    const buffers = [];
    const packetData = packet.data;
    const pack = packet;
    pack.data = _deconstructPacket(packetData, buffers);
    pack.attachments = buffers.length;
    return { packet: pack, buffers };
  }
  function _deconstructPacket(data, buffers) {
    if (!data)
      return data;
    if (isBinary(data)) {
      const placeholder = { _placeholder: true, num: buffers.length };
      buffers.push(data);
      return placeholder;
    } else if (Array.isArray(data)) {
      const newData = new Array(data.length);
      for (let i = 0; i < data.length; i++) {
        newData[i] = _deconstructPacket(data[i], buffers);
      }
      return newData;
    } else if (typeof data === "object" && !(data instanceof Date)) {
      const newData = {};
      for (const key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          newData[key] = _deconstructPacket(data[key], buffers);
        }
      }
      return newData;
    }
    return data;
  }
  function reconstructPacket(packet, buffers) {
    packet.data = _reconstructPacket(packet.data, buffers);
    delete packet.attachments;
    return packet;
  }
  function _reconstructPacket(data, buffers) {
    if (!data)
      return data;
    if (data && data._placeholder === true) {
      const isIndexValid = typeof data.num === "number" && data.num >= 0 && data.num < buffers.length;
      if (isIndexValid) {
        return buffers[data.num];
      } else {
        throw new Error("illegal attachments");
      }
    } else if (Array.isArray(data)) {
      for (let i = 0; i < data.length; i++) {
        data[i] = _reconstructPacket(data[i], buffers);
      }
    } else if (typeof data === "object") {
      for (const key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          data[key] = _reconstructPacket(data[key], buffers);
        }
      }
    }
    return data;
  }

  // node_modules/socket.io-parser/build/esm/index.js
  var RESERVED_EVENTS = [
    "connect",
    // used on the client side
    "connect_error",
    // used on the client side
    "disconnect",
    // used on both sides
    "disconnecting",
    // used on the server side
    "newListener",
    // used by the Node.js EventEmitter
    "removeListener"
    // used by the Node.js EventEmitter
  ];
  var protocol3 = 5;
  var PacketType;
  (function(PacketType2) {
    PacketType2[PacketType2["CONNECT"] = 0] = "CONNECT";
    PacketType2[PacketType2["DISCONNECT"] = 1] = "DISCONNECT";
    PacketType2[PacketType2["EVENT"] = 2] = "EVENT";
    PacketType2[PacketType2["ACK"] = 3] = "ACK";
    PacketType2[PacketType2["CONNECT_ERROR"] = 4] = "CONNECT_ERROR";
    PacketType2[PacketType2["BINARY_EVENT"] = 5] = "BINARY_EVENT";
    PacketType2[PacketType2["BINARY_ACK"] = 6] = "BINARY_ACK";
  })(PacketType || (PacketType = {}));
  var Encoder = class {
    /**
     * Encoder constructor
     *
     * @param {function} replacer - custom replacer to pass down to JSON.parse
     */
    constructor(replacer) {
      this.replacer = replacer;
    }
    /**
     * Encode a packet as a single string if non-binary, or as a
     * buffer sequence, depending on packet type.
     *
     * @param {Object} obj - packet object
     */
    encode(obj) {
      if (obj.type === PacketType.EVENT || obj.type === PacketType.ACK) {
        if (hasBinary(obj)) {
          return this.encodeAsBinary({
            type: obj.type === PacketType.EVENT ? PacketType.BINARY_EVENT : PacketType.BINARY_ACK,
            nsp: obj.nsp,
            data: obj.data,
            id: obj.id
          });
        }
      }
      return [this.encodeAsString(obj)];
    }
    /**
     * Encode packet as string.
     */
    encodeAsString(obj) {
      let str = "" + obj.type;
      if (obj.type === PacketType.BINARY_EVENT || obj.type === PacketType.BINARY_ACK) {
        str += obj.attachments + "-";
      }
      if (obj.nsp && "/" !== obj.nsp) {
        str += obj.nsp + ",";
      }
      if (null != obj.id) {
        str += obj.id;
      }
      if (null != obj.data) {
        str += JSON.stringify(obj.data, this.replacer);
      }
      return str;
    }
    /**
     * Encode packet as 'buffer sequence' by removing blobs, and
     * deconstructing packet into object with placeholders and
     * a list of buffers.
     */
    encodeAsBinary(obj) {
      const deconstruction = deconstructPacket(obj);
      const pack = this.encodeAsString(deconstruction.packet);
      const buffers = deconstruction.buffers;
      buffers.unshift(pack);
      return buffers;
    }
  };
  var Decoder = class _Decoder extends Emitter {
    /**
     * Decoder constructor
     */
    constructor(opts) {
      super();
      this.opts = Object.assign({
        reviver: void 0,
        maxAttachments: 10
      }, typeof opts === "function" ? { reviver: opts } : opts);
    }
    /**
     * Decodes an encoded packet string into packet JSON.
     *
     * @param {String} obj - encoded packet
     */
    add(obj) {
      let packet;
      if (typeof obj === "string") {
        if (this.reconstructor) {
          throw new Error("got plaintext data when reconstructing a packet");
        }
        packet = this.decodeString(obj);
        const isBinaryEvent = packet.type === PacketType.BINARY_EVENT;
        if (isBinaryEvent || packet.type === PacketType.BINARY_ACK) {
          packet.type = isBinaryEvent ? PacketType.EVENT : PacketType.ACK;
          this.reconstructor = new BinaryReconstructor(packet);
          if (packet.attachments === 0) {
            super.emitReserved("decoded", packet);
          }
        } else {
          super.emitReserved("decoded", packet);
        }
      } else if (isBinary(obj) || obj.base64) {
        if (!this.reconstructor) {
          throw new Error("got binary data when not reconstructing a packet");
        } else {
          packet = this.reconstructor.takeBinaryData(obj);
          if (packet) {
            this.reconstructor = null;
            super.emitReserved("decoded", packet);
          }
        }
      } else {
        throw new Error("Unknown type: " + obj);
      }
    }
    /**
     * Decode a packet String (JSON data)
     *
     * @param {String} str
     * @return {Object} packet
     */
    decodeString(str) {
      let i = 0;
      const p = {
        type: Number(str.charAt(0))
      };
      if (PacketType[p.type] === void 0) {
        throw new Error("unknown packet type " + p.type);
      }
      if (p.type === PacketType.BINARY_EVENT || p.type === PacketType.BINARY_ACK) {
        const start = i + 1;
        while (str.charAt(++i) !== "-" && i != str.length) {
        }
        const buf = str.substring(start, i);
        if (buf != Number(buf) || str.charAt(i) !== "-") {
          throw new Error("Illegal attachments");
        }
        const n = Number(buf);
        if (!isInteger(n) || n < 0) {
          throw new Error("Illegal attachments");
        } else if (n > this.opts.maxAttachments) {
          throw new Error("too many attachments");
        }
        p.attachments = n;
      }
      if ("/" === str.charAt(i + 1)) {
        const start = i + 1;
        while (++i) {
          const c = str.charAt(i);
          if ("," === c)
            break;
          if (i === str.length)
            break;
        }
        p.nsp = str.substring(start, i);
      } else {
        p.nsp = "/";
      }
      const next = str.charAt(i + 1);
      if ("" !== next && Number(next) == next) {
        const start = i + 1;
        while (++i) {
          const c = str.charAt(i);
          if (null == c || Number(c) != c) {
            --i;
            break;
          }
          if (i === str.length)
            break;
        }
        p.id = Number(str.substring(start, i + 1));
      }
      if (str.charAt(++i)) {
        const payload = this.tryParse(str.substr(i));
        if (_Decoder.isPayloadValid(p.type, payload)) {
          p.data = payload;
        } else {
          throw new Error("invalid payload");
        }
      }
      return p;
    }
    tryParse(str) {
      try {
        return JSON.parse(str, this.opts.reviver);
      } catch (e) {
        return false;
      }
    }
    static isPayloadValid(type, payload) {
      switch (type) {
        case PacketType.CONNECT:
          return isObject(payload);
        case PacketType.DISCONNECT:
          return payload === void 0;
        case PacketType.CONNECT_ERROR:
          return typeof payload === "string" || isObject(payload);
        case PacketType.EVENT:
        case PacketType.BINARY_EVENT:
          return Array.isArray(payload) && (typeof payload[0] === "number" || typeof payload[0] === "string" && RESERVED_EVENTS.indexOf(payload[0]) === -1);
        case PacketType.ACK:
        case PacketType.BINARY_ACK:
          return Array.isArray(payload);
      }
    }
    /**
     * Deallocates a parser's resources
     */
    destroy() {
      if (this.reconstructor) {
        this.reconstructor.finishedReconstruction();
        this.reconstructor = null;
      }
    }
  };
  var BinaryReconstructor = class {
    constructor(packet) {
      this.packet = packet;
      this.buffers = [];
      this.reconPack = packet;
    }
    /**
     * Method to be called when binary data received from connection
     * after a BINARY_EVENT packet.
     *
     * @param {Buffer | ArrayBuffer} binData - the raw binary data received
     * @return {null | Object} returns null if more binary data is expected or
     *   a reconstructed packet object if all buffers have been received.
     */
    takeBinaryData(binData) {
      this.buffers.push(binData);
      if (this.buffers.length === this.reconPack.attachments) {
        const packet = reconstructPacket(this.reconPack, this.buffers);
        this.finishedReconstruction();
        return packet;
      }
      return null;
    }
    /**
     * Cleans up binary packet reconstruction variables.
     */
    finishedReconstruction() {
      this.reconPack = null;
      this.buffers = [];
    }
  };
  function isNamespaceValid(nsp) {
    return typeof nsp === "string";
  }
  var isInteger = Number.isInteger || function(value2) {
    return typeof value2 === "number" && isFinite(value2) && Math.floor(value2) === value2;
  };
  function isAckIdValid(id) {
    return id === void 0 || isInteger(id);
  }
  function isObject(value2) {
    return Object.prototype.toString.call(value2) === "[object Object]";
  }
  function isDataValid(type, payload) {
    switch (type) {
      case PacketType.CONNECT:
        return payload === void 0 || isObject(payload);
      case PacketType.DISCONNECT:
        return payload === void 0;
      case PacketType.EVENT:
        return Array.isArray(payload) && (typeof payload[0] === "number" || typeof payload[0] === "string" && RESERVED_EVENTS.indexOf(payload[0]) === -1);
      case PacketType.ACK:
        return Array.isArray(payload);
      case PacketType.CONNECT_ERROR:
        return typeof payload === "string" || isObject(payload);
      default:
        return false;
    }
  }
  function isPacketValid(packet) {
    return isNamespaceValid(packet.nsp) && isAckIdValid(packet.id) && isDataValid(packet.type, packet.data);
  }

  // node_modules/socket.io-client/build/esm/on.js
  function on(obj, ev, fn) {
    obj.on(ev, fn);
    return function subDestroy() {
      obj.off(ev, fn);
    };
  }

  // node_modules/socket.io-client/build/esm/socket.js
  var RESERVED_EVENTS2 = Object.freeze({
    connect: 1,
    connect_error: 1,
    disconnect: 1,
    disconnecting: 1,
    // EventEmitter reserved events: https://nodejs.org/api/events.html#events_event_newlistener
    newListener: 1,
    removeListener: 1
  });
  var Socket2 = class extends Emitter {
    /**
     * `Socket` constructor.
     */
    constructor(io, nsp, opts) {
      super();
      this.connected = false;
      this.recovered = false;
      this.receiveBuffer = [];
      this.sendBuffer = [];
      this._queue = [];
      this._queueSeq = 0;
      this.ids = 0;
      this.acks = {};
      this.flags = {};
      this.io = io;
      this.nsp = nsp;
      if (opts && opts.auth) {
        this.auth = opts.auth;
      }
      this._opts = Object.assign({}, opts);
      if (this.io._autoConnect)
        this.open();
    }
    /**
     * Whether the socket is currently disconnected
     *
     * @example
     * const socket = io();
     *
     * socket.on("connect", () => {
     *   console.log(socket.disconnected); // false
     * });
     *
     * socket.on("disconnect", () => {
     *   console.log(socket.disconnected); // true
     * });
     */
    get disconnected() {
      return !this.connected;
    }
    /**
     * Subscribe to open, close and packet events
     *
     * @private
     */
    subEvents() {
      if (this.subs)
        return;
      const io = this.io;
      this.subs = [
        on(io, "open", this.onopen.bind(this)),
        on(io, "packet", this.onpacket.bind(this)),
        on(io, "error", this.onerror.bind(this)),
        on(io, "close", this.onclose.bind(this))
      ];
    }
    /**
     * Whether the Socket will try to reconnect when its Manager connects or reconnects.
     *
     * @example
     * const socket = io();
     *
     * console.log(socket.active); // true
     *
     * socket.on("disconnect", (reason) => {
     *   if (reason === "io server disconnect") {
     *     // the disconnection was initiated by the server, you need to manually reconnect
     *     console.log(socket.active); // false
     *   }
     *   // else the socket will automatically try to reconnect
     *   console.log(socket.active); // true
     * });
     */
    get active() {
      return !!this.subs;
    }
    /**
     * "Opens" the socket.
     *
     * @example
     * const socket = io({
     *   autoConnect: false
     * });
     *
     * socket.connect();
     */
    connect() {
      if (this.connected)
        return this;
      this.subEvents();
      if (!this.io["_reconnecting"])
        this.io.open();
      if ("open" === this.io._readyState)
        this.onopen();
      return this;
    }
    /**
     * Alias for {@link connect()}.
     */
    open() {
      return this.connect();
    }
    /**
     * Sends a `message` event.
     *
     * This method mimics the WebSocket.send() method.
     *
     * @see https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/send
     *
     * @example
     * socket.send("hello");
     *
     * // this is equivalent to
     * socket.emit("message", "hello");
     *
     * @return self
     */
    send(...args) {
      args.unshift("message");
      this.emit.apply(this, args);
      return this;
    }
    /**
     * Override `emit`.
     * If the event is in `events`, it's emitted normally.
     *
     * @example
     * socket.emit("hello", "world");
     *
     * // all serializable datastructures are supported (no need to call JSON.stringify)
     * socket.emit("hello", 1, "2", { 3: ["4"], 5: Uint8Array.from([6]) });
     *
     * // with an acknowledgement from the server
     * socket.emit("hello", "world", (val) => {
     *   // ...
     * });
     *
     * @return self
     */
    emit(ev, ...args) {
      var _a, _b, _c;
      if (RESERVED_EVENTS2.hasOwnProperty(ev)) {
        throw new Error('"' + ev.toString() + '" is a reserved event name');
      }
      args.unshift(ev);
      if (this._opts.retries && !this.flags.fromQueue && !this.flags.volatile) {
        this._addToQueue(args);
        return this;
      }
      const packet = {
        type: PacketType.EVENT,
        data: args
      };
      packet.options = {};
      packet.options.compress = this.flags.compress !== false;
      if ("function" === typeof args[args.length - 1]) {
        const id = this.ids++;
        const ack = args.pop();
        this._registerAckCallback(id, ack);
        packet.id = id;
      }
      const isTransportWritable = (_b = (_a = this.io.engine) === null || _a === void 0 ? void 0 : _a.transport) === null || _b === void 0 ? void 0 : _b.writable;
      const isConnected = this.connected && !((_c = this.io.engine) === null || _c === void 0 ? void 0 : _c._hasPingExpired());
      const discardPacket = this.flags.volatile && !isTransportWritable;
      if (discardPacket) {
      } else if (isConnected) {
        this.notifyOutgoingListeners(packet);
        this.packet(packet);
      } else {
        this.sendBuffer.push(packet);
      }
      this.flags = {};
      return this;
    }
    /**
     * @private
     */
    _registerAckCallback(id, ack) {
      var _a;
      const timeout = (_a = this.flags.timeout) !== null && _a !== void 0 ? _a : this._opts.ackTimeout;
      if (timeout === void 0) {
        this.acks[id] = ack;
        return;
      }
      const timer = this.io.setTimeoutFn(() => {
        delete this.acks[id];
        for (let i = 0; i < this.sendBuffer.length; i++) {
          if (this.sendBuffer[i].id === id) {
            this.sendBuffer.splice(i, 1);
          }
        }
        ack.call(this, new Error("operation has timed out"));
      }, timeout);
      const fn = (...args) => {
        this.io.clearTimeoutFn(timer);
        ack.apply(this, args);
      };
      fn.withError = true;
      this.acks[id] = fn;
    }
    /**
     * Emits an event and waits for an acknowledgement
     *
     * @example
     * // without timeout
     * const response = await socket.emitWithAck("hello", "world");
     *
     * // with a specific timeout
     * try {
     *   const response = await socket.timeout(1000).emitWithAck("hello", "world");
     * } catch (err) {
     *   // the server did not acknowledge the event in the given delay
     * }
     *
     * @return a Promise that will be fulfilled when the server acknowledges the event
     */
    emitWithAck(ev, ...args) {
      return new Promise((resolve, reject) => {
        const fn = (arg1, arg2) => {
          return arg1 ? reject(arg1) : resolve(arg2);
        };
        fn.withError = true;
        args.push(fn);
        this.emit(ev, ...args);
      });
    }
    /**
     * Add the packet to the queue.
     * @param args
     * @private
     */
    _addToQueue(args) {
      let ack;
      if (typeof args[args.length - 1] === "function") {
        ack = args.pop();
      }
      const packet = {
        id: this._queueSeq++,
        tryCount: 0,
        pending: false,
        args,
        flags: Object.assign({ fromQueue: true }, this.flags)
      };
      args.push((err, ...responseArgs) => {
        if (packet !== this._queue[0]) {
        }
        const hasError = err !== null;
        if (hasError) {
          if (packet.tryCount > this._opts.retries) {
            this._queue.shift();
            if (ack) {
              ack(err);
            }
          }
        } else {
          this._queue.shift();
          if (ack) {
            ack(null, ...responseArgs);
          }
        }
        packet.pending = false;
        return this._drainQueue();
      });
      this._queue.push(packet);
      this._drainQueue();
    }
    /**
     * Send the first packet of the queue, and wait for an acknowledgement from the server.
     * @param force - whether to resend a packet that has not been acknowledged yet
     *
     * @private
     */
    _drainQueue(force = false) {
      if (!this.connected || this._queue.length === 0) {
        return;
      }
      const packet = this._queue[0];
      if (packet.pending && !force) {
        return;
      }
      packet.pending = true;
      packet.tryCount++;
      this.flags = packet.flags;
      this.emit.apply(this, packet.args);
    }
    /**
     * Sends a packet.
     *
     * @param packet
     * @private
     */
    packet(packet) {
      packet.nsp = this.nsp;
      this.io._packet(packet);
    }
    /**
     * Called upon engine `open`.
     *
     * @private
     */
    onopen() {
      if (typeof this.auth == "function") {
        this.auth((data) => {
          this._sendConnectPacket(data);
        });
      } else {
        this._sendConnectPacket(this.auth);
      }
    }
    /**
     * Sends a CONNECT packet to initiate the Socket.IO session.
     *
     * @param data
     * @private
     */
    _sendConnectPacket(data) {
      this.packet({
        type: PacketType.CONNECT,
        data: this._pid ? Object.assign({ pid: this._pid, offset: this._lastOffset }, data) : data
      });
    }
    /**
     * Called upon engine or manager `error`.
     *
     * @param err
     * @private
     */
    onerror(err) {
      if (!this.connected) {
        this.emitReserved("connect_error", err);
      }
    }
    /**
     * Called upon engine `close`.
     *
     * @param reason
     * @param description
     * @private
     */
    onclose(reason, description) {
      this.connected = false;
      delete this.id;
      this.emitReserved("disconnect", reason, description);
      this._clearAcks();
    }
    /**
     * Clears the acknowledgement handlers upon disconnection, since the client will never receive an acknowledgement from
     * the server.
     *
     * @private
     */
    _clearAcks() {
      Object.keys(this.acks).forEach((id) => {
        const isBuffered = this.sendBuffer.some((packet) => String(packet.id) === id);
        if (!isBuffered) {
          const ack = this.acks[id];
          delete this.acks[id];
          if (ack.withError) {
            ack.call(this, new Error("socket has been disconnected"));
          }
        }
      });
    }
    /**
     * Called with socket packet.
     *
     * @param packet
     * @private
     */
    onpacket(packet) {
      const sameNamespace = packet.nsp === this.nsp;
      if (!sameNamespace)
        return;
      switch (packet.type) {
        case PacketType.CONNECT:
          if (packet.data && packet.data.sid) {
            this.onconnect(packet.data.sid, packet.data.pid);
          } else {
            this.emitReserved("connect_error", new Error("It seems you are trying to reach a Socket.IO server in v2.x with a v3.x client, but they are not compatible (more information here: https://socket.io/docs/v3/migrating-from-2-x-to-3-0/)"));
          }
          break;
        case PacketType.EVENT:
        case PacketType.BINARY_EVENT:
          this.onevent(packet);
          break;
        case PacketType.ACK:
        case PacketType.BINARY_ACK:
          this.onack(packet);
          break;
        case PacketType.DISCONNECT:
          this.ondisconnect();
          break;
        case PacketType.CONNECT_ERROR:
          this.destroy();
          const err = new Error(packet.data.message);
          err.data = packet.data.data;
          this.emitReserved("connect_error", err);
          break;
      }
    }
    /**
     * Called upon a server event.
     *
     * @param packet
     * @private
     */
    onevent(packet) {
      const args = packet.data || [];
      if (null != packet.id) {
        args.push(this.ack(packet.id));
      }
      if (this.connected) {
        this.emitEvent(args);
      } else {
        this.receiveBuffer.push(Object.freeze(args));
      }
    }
    emitEvent(args) {
      if (this._anyListeners && this._anyListeners.length) {
        const listeners = this._anyListeners.slice();
        for (const listener of listeners) {
          listener.apply(this, args);
        }
      }
      super.emit.apply(this, args);
      if (this._pid && args.length && typeof args[args.length - 1] === "string") {
        this._lastOffset = args[args.length - 1];
      }
    }
    /**
     * Produces an ack callback to emit with an event.
     *
     * @private
     */
    ack(id) {
      const self2 = this;
      let sent = false;
      return function(...args) {
        if (sent)
          return;
        sent = true;
        self2.packet({
          type: PacketType.ACK,
          id,
          data: args
        });
      };
    }
    /**
     * Called upon a server acknowledgement.
     *
     * @param packet
     * @private
     */
    onack(packet) {
      const ack = this.acks[packet.id];
      if (typeof ack !== "function") {
        return;
      }
      delete this.acks[packet.id];
      if (ack.withError) {
        packet.data.unshift(null);
      }
      ack.apply(this, packet.data);
    }
    /**
     * Called upon server connect.
     *
     * @private
     */
    onconnect(id, pid) {
      this.id = id;
      this.recovered = pid && this._pid === pid;
      this._pid = pid;
      this.connected = true;
      this.emitBuffered();
      this._drainQueue(true);
      this.emitReserved("connect");
    }
    /**
     * Emit buffered events (received and emitted).
     *
     * @private
     */
    emitBuffered() {
      this.receiveBuffer.forEach((args) => this.emitEvent(args));
      this.receiveBuffer = [];
      this.sendBuffer.forEach((packet) => {
        this.notifyOutgoingListeners(packet);
        this.packet(packet);
      });
      this.sendBuffer = [];
    }
    /**
     * Called upon server disconnect.
     *
     * @private
     */
    ondisconnect() {
      this.destroy();
      this.onclose("io server disconnect");
    }
    /**
     * Called upon forced client/server side disconnections,
     * this method ensures the manager stops tracking us and
     * that reconnections don't get triggered for this.
     *
     * @private
     */
    destroy() {
      if (this.subs) {
        this.subs.forEach((subDestroy) => subDestroy());
        this.subs = void 0;
      }
      this.io["_destroy"](this);
    }
    /**
     * Disconnects the socket manually. In that case, the socket will not try to reconnect.
     *
     * If this is the last active Socket instance of the {@link Manager}, the low-level connection will be closed.
     *
     * @example
     * const socket = io();
     *
     * socket.on("disconnect", (reason) => {
     *   // console.log(reason); prints "io client disconnect"
     * });
     *
     * socket.disconnect();
     *
     * @return self
     */
    disconnect() {
      if (this.connected) {
        this.packet({ type: PacketType.DISCONNECT });
      }
      this.destroy();
      if (this.connected) {
        this.onclose("io client disconnect");
      }
      return this;
    }
    /**
     * Alias for {@link disconnect()}.
     *
     * @return self
     */
    close() {
      return this.disconnect();
    }
    /**
     * Sets the compress flag.
     *
     * @example
     * socket.compress(false).emit("hello");
     *
     * @param compress - if `true`, compresses the sending data
     * @return self
     */
    compress(compress) {
      this.flags.compress = compress;
      return this;
    }
    /**
     * Sets a modifier for a subsequent event emission that the event message will be dropped when this socket is not
     * ready to send messages.
     *
     * @example
     * socket.volatile.emit("hello"); // the server may or may not receive it
     *
     * @returns self
     */
    get volatile() {
      this.flags.volatile = true;
      return this;
    }
    /**
     * Sets a modifier for a subsequent event emission that the callback will be called with an error when the
     * given number of milliseconds have elapsed without an acknowledgement from the server:
     *
     * @example
     * socket.timeout(5000).emit("my-event", (err) => {
     *   if (err) {
     *     // the server did not acknowledge the event in the given delay
     *   }
     * });
     *
     * @returns self
     */
    timeout(timeout) {
      this.flags.timeout = timeout;
      return this;
    }
    /**
     * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
     * callback.
     *
     * @example
     * socket.onAny((event, ...args) => {
     *   console.log(`got ${event}`);
     * });
     *
     * @param listener
     */
    onAny(listener) {
      this._anyListeners = this._anyListeners || [];
      this._anyListeners.push(listener);
      return this;
    }
    /**
     * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
     * callback. The listener is added to the beginning of the listeners array.
     *
     * @example
     * socket.prependAny((event, ...args) => {
     *   console.log(`got event ${event}`);
     * });
     *
     * @param listener
     */
    prependAny(listener) {
      this._anyListeners = this._anyListeners || [];
      this._anyListeners.unshift(listener);
      return this;
    }
    /**
     * Removes the listener that will be fired when any event is emitted.
     *
     * @example
     * const catchAllListener = (event, ...args) => {
     *   console.log(`got event ${event}`);
     * }
     *
     * socket.onAny(catchAllListener);
     *
     * // remove a specific listener
     * socket.offAny(catchAllListener);
     *
     * // or remove all listeners
     * socket.offAny();
     *
     * @param listener
     */
    offAny(listener) {
      if (!this._anyListeners) {
        return this;
      }
      if (listener) {
        const listeners = this._anyListeners;
        for (let i = 0; i < listeners.length; i++) {
          if (listener === listeners[i]) {
            listeners.splice(i, 1);
            return this;
          }
        }
      } else {
        this._anyListeners = [];
      }
      return this;
    }
    /**
     * Returns an array of listeners that are listening for any event that is specified. This array can be manipulated,
     * e.g. to remove listeners.
     */
    listenersAny() {
      return this._anyListeners || [];
    }
    /**
     * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
     * callback.
     *
     * Note: acknowledgements sent to the server are not included.
     *
     * @example
     * socket.onAnyOutgoing((event, ...args) => {
     *   console.log(`sent event ${event}`);
     * });
     *
     * @param listener
     */
    onAnyOutgoing(listener) {
      this._anyOutgoingListeners = this._anyOutgoingListeners || [];
      this._anyOutgoingListeners.push(listener);
      return this;
    }
    /**
     * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
     * callback. The listener is added to the beginning of the listeners array.
     *
     * Note: acknowledgements sent to the server are not included.
     *
     * @example
     * socket.prependAnyOutgoing((event, ...args) => {
     *   console.log(`sent event ${event}`);
     * });
     *
     * @param listener
     */
    prependAnyOutgoing(listener) {
      this._anyOutgoingListeners = this._anyOutgoingListeners || [];
      this._anyOutgoingListeners.unshift(listener);
      return this;
    }
    /**
     * Removes the listener that will be fired when any event is emitted.
     *
     * @example
     * const catchAllListener = (event, ...args) => {
     *   console.log(`sent event ${event}`);
     * }
     *
     * socket.onAnyOutgoing(catchAllListener);
     *
     * // remove a specific listener
     * socket.offAnyOutgoing(catchAllListener);
     *
     * // or remove all listeners
     * socket.offAnyOutgoing();
     *
     * @param [listener] - the catch-all listener (optional)
     */
    offAnyOutgoing(listener) {
      if (!this._anyOutgoingListeners) {
        return this;
      }
      if (listener) {
        const listeners = this._anyOutgoingListeners;
        for (let i = 0; i < listeners.length; i++) {
          if (listener === listeners[i]) {
            listeners.splice(i, 1);
            return this;
          }
        }
      } else {
        this._anyOutgoingListeners = [];
      }
      return this;
    }
    /**
     * Returns an array of listeners that are listening for any event that is specified. This array can be manipulated,
     * e.g. to remove listeners.
     */
    listenersAnyOutgoing() {
      return this._anyOutgoingListeners || [];
    }
    /**
     * Notify the listeners for each packet sent
     *
     * @param packet
     *
     * @private
     */
    notifyOutgoingListeners(packet) {
      if (this._anyOutgoingListeners && this._anyOutgoingListeners.length) {
        const listeners = this._anyOutgoingListeners.slice();
        for (const listener of listeners) {
          listener.apply(this, packet.data);
        }
      }
    }
  };

  // node_modules/socket.io-client/build/esm/contrib/backo2.js
  function Backoff(opts) {
    opts = opts || {};
    this.ms = opts.min || 100;
    this.max = opts.max || 1e4;
    this.factor = opts.factor || 2;
    this.jitter = opts.jitter > 0 && opts.jitter <= 1 ? opts.jitter : 0;
    this.attempts = 0;
  }
  Backoff.prototype.duration = function() {
    var ms = this.ms * Math.pow(this.factor, this.attempts++);
    if (this.jitter) {
      var rand = Math.random();
      var deviation = Math.floor(rand * this.jitter * ms);
      ms = (Math.floor(rand * 10) & 1) == 0 ? ms - deviation : ms + deviation;
    }
    return Math.min(ms, this.max) | 0;
  };
  Backoff.prototype.reset = function() {
    this.attempts = 0;
  };
  Backoff.prototype.setMin = function(min) {
    this.ms = min;
  };
  Backoff.prototype.setMax = function(max) {
    this.max = max;
  };
  Backoff.prototype.setJitter = function(jitter) {
    this.jitter = jitter;
  };

  // node_modules/socket.io-client/build/esm/manager.js
  var Manager = class extends Emitter {
    constructor(uri, opts) {
      var _a;
      super();
      this.nsps = {};
      this.subs = [];
      if (uri && "object" === typeof uri) {
        opts = uri;
        uri = void 0;
      }
      opts = opts || {};
      opts.path = opts.path || "/socket.io";
      this.opts = opts;
      installTimerFunctions(this, opts);
      this.reconnection(opts.reconnection !== false);
      this.reconnectionAttempts(opts.reconnectionAttempts || Infinity);
      this.reconnectionDelay(opts.reconnectionDelay || 1e3);
      this.reconnectionDelayMax(opts.reconnectionDelayMax || 5e3);
      this.randomizationFactor((_a = opts.randomizationFactor) !== null && _a !== void 0 ? _a : 0.5);
      this.backoff = new Backoff({
        min: this.reconnectionDelay(),
        max: this.reconnectionDelayMax(),
        jitter: this.randomizationFactor()
      });
      this.timeout(null == opts.timeout ? 2e4 : opts.timeout);
      this._readyState = "closed";
      this.uri = uri;
      const _parser = opts.parser || esm_exports;
      this.encoder = new _parser.Encoder();
      this.decoder = new _parser.Decoder();
      this._autoConnect = opts.autoConnect !== false;
      if (this._autoConnect)
        this.open();
    }
    reconnection(v) {
      if (!arguments.length)
        return this._reconnection;
      this._reconnection = !!v;
      if (!v) {
        this.skipReconnect = true;
      }
      return this;
    }
    reconnectionAttempts(v) {
      if (v === void 0)
        return this._reconnectionAttempts;
      this._reconnectionAttempts = v;
      return this;
    }
    reconnectionDelay(v) {
      var _a;
      if (v === void 0)
        return this._reconnectionDelay;
      this._reconnectionDelay = v;
      (_a = this.backoff) === null || _a === void 0 ? void 0 : _a.setMin(v);
      return this;
    }
    randomizationFactor(v) {
      var _a;
      if (v === void 0)
        return this._randomizationFactor;
      this._randomizationFactor = v;
      (_a = this.backoff) === null || _a === void 0 ? void 0 : _a.setJitter(v);
      return this;
    }
    reconnectionDelayMax(v) {
      var _a;
      if (v === void 0)
        return this._reconnectionDelayMax;
      this._reconnectionDelayMax = v;
      (_a = this.backoff) === null || _a === void 0 ? void 0 : _a.setMax(v);
      return this;
    }
    timeout(v) {
      if (!arguments.length)
        return this._timeout;
      this._timeout = v;
      return this;
    }
    /**
     * Starts trying to reconnect if reconnection is enabled and we have not
     * started reconnecting yet
     *
     * @private
     */
    maybeReconnectOnOpen() {
      if (!this._reconnecting && this._reconnection && this.backoff.attempts === 0) {
        this.reconnect();
      }
    }
    /**
     * Sets the current transport `socket`.
     *
     * @param {Function} fn - optional, callback
     * @return self
     * @public
     */
    open(fn) {
      if (~this._readyState.indexOf("open"))
        return this;
      this.engine = new Socket(this.uri, this.opts);
      const socket2 = this.engine;
      const self2 = this;
      this._readyState = "opening";
      this.skipReconnect = false;
      const openSubDestroy = on(socket2, "open", function() {
        self2.onopen();
        fn && fn();
      });
      const onError = (err) => {
        this.cleanup();
        this._readyState = "closed";
        this.emitReserved("error", err);
        if (fn) {
          fn(err);
        } else {
          this.maybeReconnectOnOpen();
        }
      };
      const errorSub = on(socket2, "error", onError);
      if (false !== this._timeout) {
        const timeout = this._timeout;
        const timer = this.setTimeoutFn(() => {
          openSubDestroy();
          onError(new Error("timeout"));
          socket2.close();
        }, timeout);
        if (this.opts.autoUnref) {
          timer.unref();
        }
        this.subs.push(() => {
          this.clearTimeoutFn(timer);
        });
      }
      this.subs.push(openSubDestroy);
      this.subs.push(errorSub);
      return this;
    }
    /**
     * Alias for open()
     *
     * @return self
     * @public
     */
    connect(fn) {
      return this.open(fn);
    }
    /**
     * Called upon transport open.
     *
     * @private
     */
    onopen() {
      this.cleanup();
      this._readyState = "open";
      this.emitReserved("open");
      const socket2 = this.engine;
      this.subs.push(
        on(socket2, "ping", this.onping.bind(this)),
        on(socket2, "data", this.ondata.bind(this)),
        on(socket2, "error", this.onerror.bind(this)),
        on(socket2, "close", this.onclose.bind(this)),
        // @ts-ignore
        on(this.decoder, "decoded", this.ondecoded.bind(this))
      );
    }
    /**
     * Called upon a ping.
     *
     * @private
     */
    onping() {
      this.emitReserved("ping");
    }
    /**
     * Called with data.
     *
     * @private
     */
    ondata(data) {
      try {
        this.decoder.add(data);
      } catch (e) {
        this.onclose("parse error", e);
      }
    }
    /**
     * Called when parser fully decodes a packet.
     *
     * @private
     */
    ondecoded(packet) {
      nextTick(() => {
        this.emitReserved("packet", packet);
      }, this.setTimeoutFn);
    }
    /**
     * Called upon socket error.
     *
     * @private
     */
    onerror(err) {
      this.emitReserved("error", err);
    }
    /**
     * Creates a new socket for the given `nsp`.
     *
     * @return {Socket}
     * @public
     */
    socket(nsp, opts) {
      let socket2 = this.nsps[nsp];
      if (!socket2) {
        socket2 = new Socket2(this, nsp, opts);
        this.nsps[nsp] = socket2;
      } else if (this._autoConnect && !socket2.active) {
        socket2.connect();
      }
      return socket2;
    }
    /**
     * Called upon a socket close.
     *
     * @param socket
     * @private
     */
    _destroy(socket2) {
      const nsps = Object.keys(this.nsps);
      for (const nsp of nsps) {
        const socket3 = this.nsps[nsp];
        if (socket3.active) {
          return;
        }
      }
      this._close();
    }
    /**
     * Writes a packet.
     *
     * @param packet
     * @private
     */
    _packet(packet) {
      const encodedPackets = this.encoder.encode(packet);
      for (let i = 0; i < encodedPackets.length; i++) {
        this.engine.write(encodedPackets[i], packet.options);
      }
    }
    /**
     * Clean up transport subscriptions and packet buffer.
     *
     * @private
     */
    cleanup() {
      this.subs.forEach((subDestroy) => subDestroy());
      this.subs.length = 0;
      this.decoder.destroy();
    }
    /**
     * Close the current socket.
     *
     * @private
     */
    _close() {
      this.skipReconnect = true;
      this._reconnecting = false;
      this.onclose("forced close");
    }
    /**
     * Alias for close()
     *
     * @private
     */
    disconnect() {
      return this._close();
    }
    /**
     * Called when:
     *
     * - the low-level engine is closed
     * - the parser encountered a badly formatted packet
     * - all sockets are disconnected
     *
     * @private
     */
    onclose(reason, description) {
      var _a;
      this.cleanup();
      (_a = this.engine) === null || _a === void 0 ? void 0 : _a.close();
      this.backoff.reset();
      this._readyState = "closed";
      this.emitReserved("close", reason, description);
      if (this._reconnection && !this.skipReconnect) {
        this.reconnect();
      }
    }
    /**
     * Attempt a reconnection.
     *
     * @private
     */
    reconnect() {
      if (this._reconnecting || this.skipReconnect)
        return this;
      const self2 = this;
      if (this.backoff.attempts >= this._reconnectionAttempts) {
        this.backoff.reset();
        this.emitReserved("reconnect_failed");
        this._reconnecting = false;
      } else {
        const delay2 = this.backoff.duration();
        this._reconnecting = true;
        const timer = this.setTimeoutFn(() => {
          if (self2.skipReconnect)
            return;
          this.emitReserved("reconnect_attempt", self2.backoff.attempts);
          if (self2.skipReconnect)
            return;
          self2.open((err) => {
            if (err) {
              self2._reconnecting = false;
              self2.reconnect();
              this.emitReserved("reconnect_error", err);
            } else {
              self2.onreconnect();
            }
          });
        }, delay2);
        if (this.opts.autoUnref) {
          timer.unref();
        }
        this.subs.push(() => {
          this.clearTimeoutFn(timer);
        });
      }
    }
    /**
     * Called upon successful reconnect.
     *
     * @private
     */
    onreconnect() {
      const attempt = this.backoff.attempts;
      this._reconnecting = false;
      this.backoff.reset();
      this.emitReserved("reconnect", attempt);
    }
  };

  // node_modules/socket.io-client/build/esm/index.js
  var cache = {};
  function lookup2(uri, opts) {
    if (typeof uri === "object") {
      opts = uri;
      uri = void 0;
    }
    opts = opts || {};
    const parsed = url(uri, opts.path || "/socket.io");
    const source = parsed.source;
    const id = parsed.id;
    const path = parsed.path;
    const sameNamespace = cache[id] && path in cache[id]["nsps"];
    const newConnection = opts.forceNew || opts["force new connection"] || false === opts.multiplex || sameNamespace;
    let io;
    if (newConnection) {
      io = new Manager(source, opts);
    } else {
      if (!cache[id]) {
        cache[id] = new Manager(source, opts);
      }
      io = cache[id];
    }
    if (parsed.query && !opts.query) {
      opts.query = parsed.queryKey;
    }
    return io.socket(parsed.path, opts);
  }
  Object.assign(lookup2, {
    Manager,
    Socket: Socket2,
    io: lookup2,
    connect: lookup2
  });

  // src/lib/types.ts
  var SETTING_DEFAULTS = {
    serverUrl: "http://localhost:3000",
    agentServerUrl: "",
    lastWorkingAgentUrl: "",
    agentToken: "",
    agentId: "",
    agentName: "Browser Agent",
    agentGroup: "",
    aiKey: "",
    aiBaseUrl: "https://api.anthropic.com",
    aiModel: "claude-sonnet-4-5",
    offlineMode: false,
    offlinePrompt: "\u4F60\u662F HeySure AI\uFF0C\u8FD0\u884C\u5728\u6D4F\u89C8\u5668\u63D2\u4EF6\u7684\u672C\u5730\u5BF9\u8BDD\u7A97\u53E3\u4E2D\u3002\u4F60\u53EF\u4EE5\u76F4\u63A5\u56DE\u7B54\u7528\u6237\uFF0C\u4E5F\u53EF\u4EE5\u8C03\u7528\u672C\u673A\u6D4F\u89C8\u5668 MCP \u5DE5\u5177\u5B8C\u6210\u7F51\u9875\u6D4F\u89C8\u3001\u70B9\u51FB\u3001\u8F93\u5165\u3001\u622A\u56FE\u3001\u63D0\u53D6\u6570\u636E\u3001\u7BA1\u7406\u6807\u7B7E\u9875\u7B49\u4EFB\u52A1\u3002\u9700\u8981\u64CD\u4F5C\u6D4F\u89C8\u5668\u65F6\u4F18\u5148\u4F7F\u7528\u5DE5\u5177\uFF0C\u5E76\u7528\u548C\u7528\u6237\u76F8\u540C\u7684\u8BED\u8A00\u56DE\u590D\u3002",
    mouseFx: true,
    theme: "dark",
    selectedAiConfigId: null
  };

  // src/lib/storage.ts
  async function getSettings() {
    const keys = Object.keys(SETTING_DEFAULTS);
    const stored = await chrome.storage.local.get(keys);
    return { ...SETTING_DEFAULTS, ...stored };
  }
  async function saveSettings(partial) {
    await chrome.storage.local.set(partial);
  }
  var ACT_KEY = "_activity_buffer";
  var MAX_ACT = 100;
  async function pushActivity(entry) {
    const r = await chrome.storage.session.get(ACT_KEY).catch(() => ({}));
    const buf = r[ACT_KEY] || [];
    buf.push(entry);
    if (buf.length > MAX_ACT)
      buf.splice(0, buf.length - MAX_ACT);
    await chrome.storage.session.set({ [ACT_KEY]: buf }).catch(() => {
    });
  }
  async function getActivity() {
    const r = await chrome.storage.session.get(ACT_KEY).catch(() => ({}));
    return r[ACT_KEY] || [];
  }
  var AUTH_KEY = "_auth_state";
  var AUTH_DEFAULT = {
    token: "",
    account: "",
    password: "",
    rememberLogin: false,
    userId: null,
    userName: "",
    avatar: ""
  };
  async function getAuth() {
    const r = await chrome.storage.local.get(AUTH_KEY);
    return { ...AUTH_DEFAULT, ...r[AUTH_KEY] || {} };
  }
  var TOOL_DESC_KEY = "_tool_desc_overrides";
  async function getToolDescOverrides() {
    const r = await chrome.storage.local.get(TOOL_DESC_KEY);
    const v = r[TOOL_DESC_KEY];
    return v && typeof v === "object" ? v : {};
  }
  var TOOL_ENABLED_KEY = "_tool_enabled";
  async function getToolEnabledMap() {
    const r = await chrome.storage.local.get(TOOL_ENABLED_KEY);
    const v = r[TOOL_ENABLED_KEY];
    return v && typeof v === "object" ? v : {};
  }

  // src/lib/tools/definitions.ts
  var SEARCH_ENGINES = {
    google: "https://www.google.com/search?q=",
    bing: "https://www.bing.com/search?q=",
    duckduckgo: "https://duckduckgo.com/?q=",
    baidu: "https://www.baidu.com/s?wd=",
    github: "https://github.com/search?q=",
    youtube: "https://www.youtube.com/results?search_query=",
    wikipedia: "https://en.wikipedia.org/wiki/Special:Search?search=",
    stackoverflow: "https://stackoverflow.com/search?q=",
    npm: "https://www.npmjs.com/search?q=",
    pypi: "https://pypi.org/search/?q=",
    mdn: "https://developer.mozilla.org/en-US/search?q="
  };
  var BROWSER_TOOLS = [
    // ───── 导航与搜索 ─────────────────────────────────────────────────────
    {
      name: "browser_navigate",
      description: "\u5728\u5F53\u524D\u6D4F\u89C8\u5668\u6807\u7B7E\u9875\u6253\u5F00\u6307\u5B9A URL\uFF0C\u9875\u9762\u52A0\u8F7D\u5B8C\u6210\u540E\u8FD4\u56DE\u3002\u7528\u9014\uFF1A\u8DF3\u8F6C\u5230\u76EE\u6807\u7F51\u5740\u5F00\u59CB\u4E00\u6BB5\u6D4F\u89C8\u4EFB\u52A1\u3002\u573A\u666F\uFF1A\u8FDB\u5165\u767B\u5F55\u9875\u3001\u6253\u5F00\u6587\u7AE0\u3001\u8DF3\u8F6C\u5230\u540E\u53F0\u7BA1\u7406\u9875\u7B49\u3002",
      input_schema: {
        type: "object",
        properties: {
          url: { type: "string", description: "\u8981\u6253\u5F00\u7684\u7EDD\u5BF9 URL\uFF08\u9700\u5305\u542B http(s)://\uFF09\u3002" },
          new_tab: { type: "boolean", description: "\u4E3A true \u65F6\u5728\u65B0\u6807\u7B7E\u9875\u6253\u5F00\uFF0C\u800C\u4E0D\u662F\u66FF\u6362\u5F53\u524D\u9875\u3002" }
        },
        required: ["url"]
      }
    },
    {
      name: "browser_search",
      description: "\u7528\u4E3B\u6D41\u641C\u7D22\u5F15\u64CE\u68C0\u7D22\u7F51\u7EDC\u3002\u7528\u9014\uFF1A\u5728\u6D4F\u89C8\u5668\u5185\u53D1\u8D77\u4E00\u6B21\u7AD9\u70B9\u641C\u7D22\u3002\u573A\u666F\uFF1A\u7528 Google/Bing/\u767E\u5EA6\u7B49\u67E5\u8D44\u6599\uFF1B\u6CE8\u610F\u8FD9\u4F1A\u771F\u6B63\u6253\u5F00\u641C\u7D22\u7ED3\u679C\u9875\uFF08\u4E0E\u670D\u52A1\u5668\u7AEF web.search \u7684\u7EAF\u6570\u636E\u68C0\u7D22\u4E0D\u540C\uFF09\u3002",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "\u641C\u7D22\u5173\u952E\u8BCD\u3002" },
          engine: {
            type: "string",
            enum: Object.keys(SEARCH_ENGINES),
            description: "\u641C\u7D22\u5F15\u64CE\uFF0C\u9ED8\u8BA4 google\uFF1B\u53EF\u9009 bing\u3001baidu\u3001duckduckgo\u3001github \u7B49\u3002"
          }
        },
        required: ["query"]
      }
    },
    {
      name: "browser_history",
      description: "\u5728\u5F53\u524D\u6807\u7B7E\u7684\u6D4F\u89C8\u5386\u53F2\u4E2D\u540E\u9000\u6216\u524D\u8FDB\u4E00\u6B65\u3002\u7528\u9014\uFF1A\u5728\u5DF2\u8BBF\u95EE\u8FC7\u7684\u9875\u9762\u95F4\u56DE\u9000/\u524D\u8FDB\u3002\u573A\u666F\uFF1A\u8BEF\u5165\u8BE6\u60C5\u9875\u540E\u9000\u56DE\u5217\u8868\uFF08back\uFF09\u3001\u540E\u9000\u540E\u53C8\u60F3\u56DE\u5230\u521A\u624D\u7684\u9875\u9762\uFF08forward\uFF09\u3002",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["back", "forward"], description: "\u5386\u53F2\u52A8\u4F5C\uFF1Aback \u540E\u9000\u4E00\u6B65\u3001forward \u524D\u8FDB\u4E00\u6B65\u3002" }
        },
        required: ["action"]
      }
    },
    // ───── 页面观察 ───────────────────────────────────────────────────────
    {
      name: "browser_observe",
      description: "\u611F\u77E5\u5F53\u524D\u89C6\u53E3\u91CC\u300C\u7528\u6237\u80FD\u770B\u5230\u4E14\u53EF\u70B9\u51FB\u300D\u7684\u5143\u7D20\uFF1A\u53EA\u8FD4\u56DE\u6700\u9876\u5C42\u3001\u672A\u88AB\u906E\u6321\u7684\u53EF\u4EA4\u4E92\u5143\u7D20\uFF08\u6309\u94AE/\u94FE\u63A5/\u8F93\u5165\u6846/\u4E0B\u62C9/\u83DC\u5355\u9879\u7B49\uFF09\uFF0C\u6BCF\u4E2A\u5E26\u7F16\u53F7 id\u3001\u89D2\u8272 role\u3001\u6587\u672C\u548C\u4E2D\u5FC3\u5750\u6807 center\uFF0C\u5E76\u9ED8\u8BA4\u5728\u9875\u9762\u4E0A\u753B\u51FA\u5BF9\u5E94\u7F16\u53F7\u6807\u8BB0\u3002\u7528\u9014\uFF1A\u4F5C\u4E3A\u70B9\u51FB/\u8F93\u5165\u524D\u7684\u9996\u9009\u89C2\u5BDF\u624B\u6BB5\uFF0C\u914D\u5408 browser_screenshot \u5F62\u6210\u300C\u770B\u56FE\u2014\u6309\u7F16\u53F7\u70B9\u51FB\u300D\u95ED\u73AF\uFF0C\u907F\u514D\u70B9\u5230\u80CC\u666F\u6216\u88AB\u5F39\u7A97\u906E\u6321\u7684\u5143\u7D20\u3002\u573A\u666F\uFF1A\u64CD\u4F5C\u4EFB\u610F\u5143\u7D20\u524D\u5148 observe\uFF0C\u518D\u7528 browser_click {ref:id} \u7CBE\u786E\u70B9\u51FB\uFF1B\u9875\u9762\u53D8\u5316\uFF08\u6EDA\u52A8/\u5F39\u7A97/\u8DEF\u7531\u5207\u6362\uFF09\u540E\u91CD\u65B0 observe \u4EE5\u5237\u65B0\u7F16\u53F7\u3002",
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "\u6700\u591A\u8FD4\u56DE\u7684\u53EF\u4EA4\u4E92\u5143\u7D20\u6570\u3002\u9ED8\u8BA4 120\uFF0C\u6700\u5927 200\u3002" },
          mark: { type: "boolean", description: "\u662F\u5426\u5728\u9875\u9762\u4E0A\u7ED8\u5236\u7F16\u53F7\u6807\u8BB0\uFF0C\u4FBF\u4E8E\u968F\u540E\u622A\u56FE\u67E5\u770B\u3002\u9ED8\u8BA4 true\uFF1B\u4F20 false \u4EC5\u8FD4\u56DE\u5217\u8868\u5E76\u6E05\u9664\u5DF2\u6709\u6807\u8BB0\u3002\u6807\u8BB0\u4EC5\u4E3A\u89C6\u89C9\u53E0\u52A0\uFF0C\u4E0D\u5F71\u54CD get_content/\u622A\u56FE\u4EE5\u5916\u7684\u53D6\u6570\uFF0C\u4E5F\u4E0D\u62E6\u622A\u70B9\u51FB\u3002" }
        }
      }
    },
    {
      name: "browser_screenshot",
      description: "\u5BF9\u5F53\u524D\u6807\u7B7E\u9875\u622A\u56FE\uFF1A\u53EF\u622A\u53EF\u89C6\u533A\u3001\u6574\u9875\u3001\u67D0\u4E2A CSS/\u6587\u672C\u5339\u914D\u7684\u5143\u7D20\uFF0C\u6216\u4E00\u5757\u77E9\u5F62\u533A\u57DF\uFF0C\u9ED8\u8BA4\u8FD4\u56DE\u5B8C\u6574 base64 \u56FE\u7247 dataUrl \u4E14\u4E0D\u4FDD\u5B58\u5230\u670D\u52A1\u5668\uFF08\u622A\u56FE\u88AB\u7981\u7528\u6216\u65E0\u6743\u9650\u65F6\u8FD4\u56DE\u53EF\u8BFB\u7684\u9519\u8BEF\u8BF4\u660E\uFF09\u3002\u7528\u9014\uFF1A\u8BA9 AI\u300C\u770B\u89C1\u300D\u9875\u9762\u3002\u573A\u666F\uFF1A\u6838\u5BF9\u9875\u9762\u72B6\u6001\u3001\u5728\u65E0\u6CD5\u8BFB\u53D6\u6587\u672C\u65F6\u6539\u7528\u89C6\u89C9\u7406\u89E3\uFF1B\u9700\u8981\u7559\u5B58\u8BC1\u636E\u65F6\u4F20 save_to_server:true\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u8981\u622A\u56FE\u7684\u5143\u7D20 CSS selector\u3002" },
          text: { type: "string", description: "\u5F53\u4E0D\u4F20 selector \u65F6\uFF0C\u7528\u53EF\u89C1\u6587\u672C\u5B9A\u4F4D\u8981\u622A\u56FE\u7684\u5143\u7D20\u3002" },
          full_page: { type: "boolean", description: "\u622A\u53D6\u6574\u4E2A\u53EF\u6EDA\u52A8\u9875\u9762\u3002" },
          x: { type: "number", description: "\u533A\u57DF\u5DE6\u4E0A\u89D2 X \u5750\u6807\uFF1B\u9664\u975E coordinate_space \u8BBE\u4E3A page\uFF0C\u5426\u5219\u6309\u89C6\u53E3\u5750\u6807\u3002" },
          y: { type: "number", description: "\u533A\u57DF\u5DE6\u4E0A\u89D2 Y \u5750\u6807\uFF1B\u9664\u975E coordinate_space \u8BBE\u4E3A page\uFF0C\u5426\u5219\u6309\u89C6\u53E3\u5750\u6807\u3002" },
          width: { type: "number", description: "\u533A\u57DF\u5BBD\u5EA6\uFF08CSS \u50CF\u7D20\uFF09\u3002" },
          height: { type: "number", description: "\u533A\u57DF\u9AD8\u5EA6\uFF08CSS \u50CF\u7D20\uFF09\u3002" },
          clip: { type: "object", description: "\u533A\u57DF\u5BF9\u8C61\u5199\u6CD5\uFF1A{x,y,width,height,coordinate_space?}\uFF0C\u4E0E x/y/width/height \u4E8C\u9009\u4E00\u3002" },
          coordinate_space: { type: "string", enum: ["viewport", "page"], description: "x/y/clip \u7684\u5750\u6807\u7CFB\uFF1Aviewport \u89C6\u53E3\u6216 page \u6574\u9875\u3002\u9ED8\u8BA4 viewport\u3002" },
          margin: { type: "number", description: "\u6309 selector/text \u622A\u5143\u7D20\u65F6\uFF0C\u5411\u56DB\u5468\u6269\u5C55\u7684\u989D\u5916 CSS \u50CF\u7D20\u3002" },
          scroll_into_view: { type: "boolean", description: "\u6D4B\u91CF\u524D\u5148\u628A\u76EE\u6807\u5143\u7D20\u6EDA\u52A8\u8FDB\u89C6\u53E3\u3002\u9ED8\u8BA4 true\u3002" },
          format: { type: "string", enum: ["png", "jpeg", "webp"], description: "\u56FE\u7247\u683C\u5F0F\u3002\u9ED8\u8BA4 png\u3002" },
          quality: { type: "number", description: "JPEG/WebP \u8D28\u91CF\uFF0C0-100\u3002" },
          scale: { type: "number", description: "CDP \u622A\u56FE\u7684\u7F29\u653E\u6BD4\u4F8B\u3002\u9ED8\u8BA4 1\u3002" },
          max_area: { type: "number", description: "\u5141\u8BB8\u7684\u6700\u5927\u622A\u56FE\u9762\u79EF\uFF08CSS \u50CF\u7D20\uFF09\u3002\u9ED8\u8BA4 25000000\u3002" },
          retries: { type: "number", description: "\u53EF\u89C6\u533A\u622A\u56FE\u9047\u5230\u6D3B\u52A8\u6807\u7B7E/\u9650\u6D41\u7B49\u4E34\u65F6\u5931\u8D25\u65F6\u7684\u91CD\u8BD5\u6B21\u6570\u3002\u9ED8\u8BA4 1\u3002" },
          timeout_ms: { type: "number", description: "\u5355\u9636\u6BB5\u622A\u56FE\u603B\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09\u3002\u53EF\u89C6\u622A\u56FE\u9ED8\u8BA4 8000\uFF0CCDP \u9ED8\u8BA4 12000\u3002" },
          visible_timeout_ms: { type: "number", description: "chrome.tabs.captureVisibleTab \u7684\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09\u3002\u9ED8\u8BA4 8000\u3002" },
          cdp_timeout_ms: { type: "number", description: "\u6BCF\u6761 Chrome DevTools Protocol \u622A\u56FE\u547D\u4EE4\u7684\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09\u3002\u9ED8\u8BA4 12000\u3002" },
          content_timeout_ms: { type: "number", description: "\u5728\u9875\u9762\u4E2D\u6D4B\u91CF selector/text \u76EE\u6807\u7684\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09\u3002\u9ED8\u8BA4 5000\u3002" },
          max_data_url_chars: { type: "number", description: "\u7ECF Socket.IO \u8FD4\u56DE\u7684 data URL \u6700\u5927\u957F\u5EA6\u3002\u9ED8\u8BA4 8000000\u3002" },
          allow_large_data_url: { type: "boolean", description: "\u5141\u8BB8\u8FD4\u56DE\u8D85\u8FC7 max_data_url_chars \u7684\u622A\u56FE\u3002\u9ED8\u8BA4 false\u3002" },
          save_to_server: { type: "boolean", description: "\u662F\u5426\u628A\u622A\u56FE\u4FDD\u5B58\u5230\u670D\u52A1\u5668\u5E76\u8FD4\u56DE\u670D\u52A1\u5668\u8DEF\u5F84/URL\u3002\u9ED8\u8BA4 false\uFF0C\u4E0D\u4FDD\u5B58\u4E14\u4FDD\u7559\u5B8C\u6574 dataUrl\u3002" },
          upload_to_server: { type: "boolean", description: "save_to_server \u7684\u517C\u5BB9\u522B\u540D\u3002\u9ED8\u8BA4 false\u3002" },
          task_timeout_ms: { type: "number", description: "\u672C\u6B21\u622A\u56FE\u4EFB\u52A1\u5728\u7AEF\u70B9 agent \u4E0A\u7684\u786C\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09\u3002\u9ED8\u8BA4 35000\u3002" },
          fallback_visible: { type: "boolean", description: "\u5143\u7D20/\u533A\u57DF/\u6574\u9875\u622A\u56FE\u65F6\uFF0C\u82E5\u7CBE\u786E CDP \u622A\u56FE\u5931\u8D25\u5219\u56DE\u9000\u4E3A\u53EF\u89C6\u533A\u622A\u56FE\u3002\u9ED8\u8BA4 false\u3002" }
        }
      }
    },
    {
      name: "browser_get_content",
      description: "\u8BFB\u53D6\u5F53\u524D\u9875\u9762\u7684\u53EF\u89C1\u6587\u672C\u3001URL\u3001\u6807\u9898\u3001\u94FE\u63A5\u3001meta \u4FE1\u606F\u548C\u5F52\u4E00\u5316\u6761\u76EE\u3002\u7528\u9014\uFF1A\u4EE5\u6587\u672C\u65B9\u5F0F\u7406\u89E3\u9875\u9762\u5185\u5BB9\u3002\u573A\u666F\uFF1A\u6293\u53D6\u6587\u7AE0\u6B63\u6587\u3001\u8BFB\u53D6\u5217\u8868\u3001\u5728\u4E0D\u622A\u56FE\u65F6\u83B7\u53D6\u9875\u9762\u4FE1\u606F\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u53EA\u53D6\u8BE5 CSS selector \u8303\u56F4\u5185\u7684\u5185\u5BB9\u3002\u9ED8\u8BA4 body\u3002" },
          include_html: { type: "boolean", description: "\u540C\u65F6\u8FD4\u56DE\uFF08\u622A\u65AD\u540E\u7684\uFF09\u539F\u59CB HTML\u3002" },
          max_chars: { type: "number", description: "\u8FD4\u56DE\u53EF\u89C1\u6587\u672C\u7684\u6700\u5927\u5B57\u7B26\u6570\u3002\u9ED8\u8BA4 8000\uFF0C\u6700\u5927 50000\u3002\u9700\u8981\u957F\u6B63\u6587\u65F6\u518D\u8C03\u5927\uFF0C\u907F\u514D\u4FE1\u606F\u8FC7\u8F7D\u3002" }
        }
      }
    },
    {
      name: "browser_dom_snapshot",
      description: "\u8FD4\u56DE\u7ED3\u6784\u5316\u7684 DOM \u6811\u5FEB\u7167\uFF0C\u4F5C\u4E3A\u622A\u56FE\u88AB\u7981\u7528\u6216\u4E0D\u53EF\u7528\u65F6\u7684\u6587\u672C\u66FF\u4EE3\u65B9\u6848\u3002\u7528\u9014\uFF1A\u4EE5\u5C42\u7EA7\u7ED3\u6784\u7406\u89E3\u9875\u9762\u3002\u573A\u666F\uFF1A\u5206\u6790\u590D\u6742\u5E03\u5C40\u3001\u5B9A\u4F4D\u5143\u7D20\u3001\u4E3A\u540E\u7EED\u64CD\u4F5C\u627E selector\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u53EA\u5FEB\u7167\u8BE5 CSS selector \u5B50\u6811\u3002\u9ED8\u8BA4\u6574\u9875\u3002" },
          max_depth: { type: "number", description: "DOM \u6811\u6700\u5927\u904D\u5386\u6DF1\u5EA6\u3002" },
          max_nodes: { type: "number", description: "\u8FD4\u56DE\u7684\u6700\u5927\u8282\u70B9\u6570\u3002" },
          trace: { type: "boolean", description: "\u5931\u8D25\u65F6\u8FD4\u56DE\u7ED3\u6784\u5316\u7684\u9519\u8BEF\u8BCA\u65AD\u4FE1\u606F\u3002" }
        }
      }
    },
    {
      name: "browser_page_info",
      description: "\u83B7\u53D6\u4F60\u5F53\u524D\u5728\u9875\u9762\u4E0A\u7684\u4F4D\u7F6E\u4FE1\u606F\uFF1A\u6EDA\u52A8\u4F4D\u7F6E\uFF08scrollY\u3001\u767E\u5206\u6BD4\u3001\u662F\u5426\u5230\u9876/\u5230\u5E95\uFF09\u3001\u89C6\u53E3\u5C3A\u5BF8\u3001\u6574\u9875\u9AD8\u5EA6\u3001\u5F53\u524D\u5C0F\u8282\u6807\u9898\u3001\u89C6\u53E3\u5185\u6240\u6709\u6807\u9898\u3001\u5143\u7D20\u8BA1\u6570\u3002\u7528\u9014\uFF1A\u81EA\u6211\u5B9A\u4F4D\u3002\u573A\u666F\uFF1A\u6EDA\u52A8\u6216\u4EA4\u4E92\u524D\u540E\u8C03\u7528\uFF0C\u786E\u8BA4\u843D\u70B9\u548C\u9875\u9762\u7ED3\u6784\u3002",
      input_schema: { type: "object", properties: {} }
    },
    {
      name: "browser_find_popups",
      description: "\u68C0\u6D4B\u9875\u9762\u4E0A\u53EF\u89C1\u7684\u5F39\u7A97\u3001\u6A21\u6001\u6846\u3001\u5BF9\u8BDD\u6846\u3001\u62BD\u5C49\u3001\u906E\u7F69\u4EE5\u53CA\u5B83\u4EEC\u53EF\u80FD\u7684\u5173\u95ED\u6309\u94AE\u3002\u7528\u9014\uFF1A\u53D1\u73B0\u6321\u4F4F\u64CD\u4F5C\u7684\u5F39\u5C42\u3002\u573A\u666F\uFF1A\u81EA\u52A8\u5316\u5361\u4F4F\u65F6\u5148\u6392\u67E5\u5F39\u7A97\uFF0C\u518D\u51B3\u5B9A\u5982\u4F55\u5173\u95ED\u3002",
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "\u6700\u591A\u8FD4\u56DE\u7684\u5F39\u7A97\u6570\u3002\u9ED8\u8BA4 10\u3002" }
        }
      }
    },
    // ───── 页面交互 ───────────────────────────────────────────────────────
    {
      name: "browser_click",
      description: "\u70B9\u51FB click \u9875\u9762\u5143\u7D20\uFF0C\u4F1A\u6D3E\u53D1\u5B8C\u6574\u7684\u6307\u9488+\u9F20\u6807\u4E8B\u4EF6\u5E8F\u5217\uFF08pointerdown/mousedown/\u2026/click\uFF09\uFF0C\u517C\u5BB9\u81EA\u5B9A\u4E49\u7EC4\u4EF6\u3002\u5B9A\u4F4D\u4F18\u5148\u7EA7\uFF1Aref\uFF08browser_observe \u7684\u7F16\u53F7\uFF0C\u6700\u7A33\uFF09> selector > \u53EF\u89C1\u6587\u672C > \u5750\u6807\u3002\u975E\u5750\u6807\u70B9\u51FB\u4F1A\u5148\u505A\u906E\u6321\u68C0\u6D4B\uFF1A\u82E5\u76EE\u6807\u88AB\u5F39\u7A97/\u906E\u7F69/\u5E7F\u544A\u76D6\u4F4F\uFF0C\u8FD4\u56DE occluded \u8BCA\u65AD\u800C\u4E0D\u662F\u8BEF\u70B9\u80CC\u666F\u5143\u7D20\uFF08\u9700\u7A7F\u900F\u70B9\u51FB\u53EF\u4F20 force:true\uFF09\u3002\u7528\u9014\uFF1A\u89E6\u53D1\u6309\u94AE\u3001\u94FE\u63A5\u3001\u52FE\u9009\u6846\u7B49\u4EA4\u4E92\u3002\u573A\u666F\uFF1A\u5148 browser_observe \u518D\u7528 ref \u70B9\u300C\u767B\u5F55\u300D\u300C\u4E0B\u4E00\u6B65\u300D\u3001\u5C55\u5F00\u83DC\u5355\u3001\u6253\u5F00\u6761\u76EE\u3002",
      input_schema: {
        type: "object",
        properties: {
          ref: { type: "number", description: "browser_observe \u8FD4\u56DE\u7684\u5143\u7D20\u7F16\u53F7 id\u3002\u6700\u7A33\u7684\u5B9A\u4F4D\u65B9\u5F0F\uFF0C\u4F18\u5148\u4F7F\u7528\u3002" },
          selector: { type: "string", description: "\u76EE\u6807\u5143\u7D20\u7684 CSS selector\u3002" },
          text: { type: "string", description: "\u8981\u70B9\u51FB\u5143\u7D20\u7684\u53EF\u89C1\u6587\u672C\u3002" },
          x: { type: "number", description: "X \u5750\u6807\uFF08\u50CF\u7D20\uFF0C\u89C6\u53E3\u5750\u6807\uFF09\u3002\u4F1A\u70B9\u51FB\u8BE5\u70B9\u6700\u9876\u5C42\u7684\u5143\u7D20\u3002" },
          y: { type: "number", description: "Y \u5750\u6807\uFF08\u50CF\u7D20\uFF0C\u89C6\u53E3\u5750\u6807\uFF09\u3002" },
          force: { type: "boolean", description: "\u4E3A true \u65F6\u5373\u4F7F\u76EE\u6807\u88AB\u906E\u6321\u4E5F\u5F3A\u5236\u70B9\u51FB\u3002\u9ED8\u8BA4 false\uFF1A\u88AB\u906E\u6321\u65F6\u8FD4\u56DE occluded \u8BCA\u65AD\uFF0C\u63D0\u793A\u5148\u5173\u95ED\u906E\u6321\u5C42\u3002" }
        }
      }
    },
    {
      name: "browser_double_click",
      description: "\u53CC\u51FB double-click \u5143\u7D20\uFF0C\u53EF\u7528 CSS selector\u3001\u53EF\u89C1\u6587\u672C\u6216\u5750\u6807\u5B9A\u4F4D\uFF08\u5982\u9009\u4E2D\u4E00\u4E2A\u8BCD\u6216\u6253\u5F00\u67D0\u9879\uFF09\u3002\u7528\u9014\uFF1A\u9700\u8981\u53CC\u51FB\u624D\u751F\u6548\u7684\u4EA4\u4E92\u3002\u573A\u666F\uFF1A\u53CC\u51FB\u9009\u8BCD\u3001\u53CC\u51FB\u6253\u5F00\u6587\u4EF6\u9879\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u76EE\u6807\u5143\u7D20\u7684 CSS selector\u3002" },
          text: { type: "string", description: "\u5143\u7D20\u7684\u53EF\u89C1\u6587\u672C\u3002" },
          x: { type: "number", description: "X \u5750\u6807\uFF08\u50CF\u7D20\uFF09\u3002" },
          y: { type: "number", description: "Y \u5750\u6807\uFF08\u50CF\u7D20\uFF09\u3002" }
        }
      }
    },
    {
      name: "browser_right_click",
      description: "\u5728\u5143\u7D20\u4E0A\u53F3\u952E right-click\uFF08\u6253\u5F00\u4E0A\u4E0B\u6587\u83DC\u5355\uFF09\uFF0C\u53EF\u7528 CSS selector\u3001\u53EF\u89C1\u6587\u672C\u6216\u5750\u6807\u5B9A\u4F4D\u3002\u7528\u9014\uFF1A\u89E6\u53D1\u53F3\u952E\u83DC\u5355\u3002\u573A\u666F\uFF1A\u6253\u5F00\u300C\u5728\u65B0\u6807\u7B7E\u6253\u5F00\u300D\u300C\u68C0\u67E5\u300D\u7B49\u4E0A\u4E0B\u6587\u64CD\u4F5C\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u76EE\u6807\u5143\u7D20\u7684 CSS selector\u3002" },
          text: { type: "string", description: "\u5143\u7D20\u7684\u53EF\u89C1\u6587\u672C\u3002" },
          x: { type: "number", description: "X \u5750\u6807\uFF08\u50CF\u7D20\uFF09\u3002" },
          y: { type: "number", description: "Y \u5750\u6807\uFF08\u50CF\u7D20\uFF09\u3002" }
        }
      }
    },
    {
      name: "browser_type",
      description: "\u5411\u8F93\u5165\u6846 input \u6216\u6587\u672C\u57DF textarea \u8F93\u5165\u6587\u672C\u3002\u7528\u9014\uFF1A\u586B\u5199\u5355\u4E2A\u5B57\u6BB5\u3002\u573A\u666F\uFF1A\u8F93\u5165\u7528\u6237\u540D\u3001\u641C\u7D22\u8BCD\u3001\u8868\u5355\u5355\u9879\uFF08\u591A\u9879\u8BF7\u7528 browser_fill_form\uFF09\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u76EE\u6807\u8F93\u5165\u6846\u7684 CSS selector\u3002" },
          text: { type: "string", description: "\u8981\u8F93\u5165\u7684\u6587\u672C\u3002" },
          clear_first: { type: "boolean", description: "\u8F93\u5165\u524D\u5148\u6E05\u7A7A\u5B57\u6BB5\u3002\u9ED8\u8BA4 true\u3002" },
          submit: { type: "boolean", description: "\u8F93\u5165\u540E\u6309\u56DE\u8F66\u63D0\u4EA4\u3002" }
        },
        required: ["text"]
      }
    },
    {
      name: "browser_press_key",
      description: "\u5728\u7126\u70B9\u5143\u7D20\u6216\u6307\u5B9A selector \u4E0A\u6309\u4E0B\u67D0\u4E2A\u952E\uFF08\u53EF\u5E26\u4FEE\u9970\u952E\uFF09\u3002\u7528\u9014\uFF1A\u952E\u76D8\u4EA4\u4E92\u3002\u573A\u666F\uFF1A\u6309 Enter \u63D0\u4EA4\u3001Escape \u5173\u95ED\u3001Tab \u5207\u6362\u3001\u65B9\u5411\u952E\u3001Ctrl+A \u7B49\u5FEB\u6377\u952E\u3002",
      input_schema: {
        type: "object",
        properties: {
          key: { type: "string", description: '\u952E\u540D\uFF0C\u5982 "Enter"\u3001"Escape"\u3001"Tab"\u3001"ArrowDown"\u3001"a"\u3002' },
          selector: { type: "string", description: "\u53EF\u9009\uFF1A\u6309\u952E\u524D\u5148\u805A\u7126\u7684 CSS selector\u3002" },
          ctrl: { type: "boolean", description: "\u6309\u4F4F Ctrl\u3002" },
          shift: { type: "boolean", description: "\u6309\u4F4F Shift\u3002" },
          alt: { type: "boolean", description: "\u6309\u4F4F Alt\u3002" },
          meta: { type: "boolean", description: "\u6309\u4F4F Meta/Cmd\u3002" }
        },
        required: ["key"]
      }
    },
    {
      name: "browser_hover",
      description: "\u628A\u9F20\u6807\u60AC\u505C hover \u5230\u67D0\u4E2A\u5143\u7D20\u4E0A\uFF0C\u4EE5\u663E\u793A tooltip \u6216\u4E0B\u62C9\u83DC\u5355\u3002\u7528\u9014\uFF1A\u89E6\u53D1\u60AC\u505C\u624D\u51FA\u73B0\u7684\u5185\u5BB9\u3002\u573A\u666F\uFF1A\u5C55\u5F00\u60AC\u505C\u83DC\u5355\u3001\u663E\u793A\u63D0\u793A\u6C14\u6CE1\u540E\u518D\u64CD\u4F5C\u3002",
      input_schema: {
        type: "object",
        properties: { selector: { type: "string", description: "\u8981\u60AC\u505C\u5143\u7D20\u7684 CSS selector\u3002" } },
        required: ["selector"]
      }
    },
    {
      name: "browser_scroll",
      description: "\u6EDA\u52A8\u5F53\u524D\u9875\u9762\uFF0C\u8FD4\u56DE\u6EDA\u52A8\u540E\u7684\u4F4D\u7F6E\uFF08scrollY\u3001\u767E\u5206\u6BD4\u3001\u662F\u5426\u5230\u9876/\u5230\u5E95\uFF09\u3001\u5B9E\u9645\u79FB\u52A8\u7684\u50CF\u7D20\u6570\uFF0C\u4EE5\u53CA\u5F53\u524D\u8FDB\u5165\u89C6\u91CE\u7684\u5C0F\u8282/\u6807\u9898\u2014\u2014\u8BA9\u4F60\u77E5\u9053\u6EDA\u5230\u4E86\u54EA\u3001\u53D8\u5316\u4E86\u4EC0\u4E48\u3002\u7528\u9014\uFF1A\u6D4F\u89C8\u957F\u9875\u9762\u3002\u573A\u666F\uFF1A\u9010\u5C4F\u9605\u8BFB\u3001\u52A0\u8F7D\u61D2\u52A0\u8F7D\u5185\u5BB9\u3001\u6EDA\u5230\u9875\u5C3E\u3002",
      input_schema: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["up", "down", "top", "bottom"], description: "\u6EDA\u52A8\u65B9\u5411\uFF1Aup \u4E0A\u3001down \u4E0B\u3001top \u5230\u9876\u3001bottom \u5230\u5E95\u3002" },
          amount: { type: "number", description: "\u6EDA\u52A8\u50CF\u7D20\u6570\u3002\u9ED8\u8BA4 400\u3002" },
          selector: { type: "string", description: "\u53EF\u9009\uFF1A\u628A\u8BE5\u5143\u7D20\u6EDA\u52A8\u8FDB\u89C6\u53E3\uFF0C\u66FF\u4EE3\u6309 amount \u6EDA\u52A8\u3002" }
        },
        required: ["direction"]
      }
    },
    {
      name: "browser_wait",
      description: "\u7B49\u5F85\u67D0\u4E2A CSS selector \u51FA\u73B0\uFF0C\u6216\u56FA\u5B9A\u7B49\u5F85\u4E00\u6BB5\u65F6\u95F4\u3002\u7528\u9014\uFF1A\u7B49\u5F85\u9875\u9762/\u5143\u7D20\u5C31\u7EEA\u540E\u518D\u64CD\u4F5C\u3002\u573A\u666F\uFF1A\u7B49\u5F02\u6B65\u52A0\u8F7D\u7684\u6309\u94AE\u51FA\u73B0\u3001\u7B49\u52A8\u753B\u7ED3\u675F\u3001\u7ED9\u9875\u9762\u7559\u51FA\u6E32\u67D3\u65F6\u95F4\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u7B49\u5F85\u51FA\u73B0\u7684 CSS \u5143\u7D20\u3002" },
          ms: { type: "number", description: "\u56FA\u5B9A\u7B49\u5F85\u7684\u6BEB\u79D2\u6570\u3002" }
        }
      }
    },
    {
      name: "browser_drag",
      description: "\u4ECE\u6E90\u5143\u7D20/\u70B9\u62D6\u62FD drag \u5230\u76EE\u6807\u5143\u7D20/\u70B9\u5E76\u653E\u4E0B\uFF0C\u89E6\u53D1 HTML5\u3001pointer \u548C mouse \u4E8B\u4EF6\uFF0C\u5E76\u8FD4\u56DE\u6E90\u662F\u5426\u660E\u663E\u79FB\u52A8\u7684\u8BCA\u65AD\u4FE1\u606F\u3002\u7528\u9014\uFF1A\u62D6\u653E\u4EA4\u4E92\u3002\u573A\u666F\uFF1A\u62D6\u52A8\u6392\u5E8F\u3001\u628A\u5143\u7D20\u62D6\u5165\u6295\u653E\u533A\u3001\u6ED1\u5757\u64CD\u4F5C\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u6E90\u5143\u7D20 CSS selector\u3002" },
          text: { type: "string", description: "\u6E90\u5143\u7D20\u53EF\u89C1\u6587\u672C\u3002" },
          x: { type: "number", description: "\u6E90\u70B9 X \u5750\u6807\uFF08\u50CF\u7D20\uFF09\u3002" },
          y: { type: "number", description: "\u6E90\u70B9 Y \u5750\u6807\uFF08\u50CF\u7D20\uFF09\u3002" },
          to_selector: { type: "string", description: "\u76EE\u6807\u5143\u7D20 CSS selector\u3002" },
          to_text: { type: "string", description: "\u76EE\u6807\u5143\u7D20\u53EF\u89C1\u6587\u672C\u3002" },
          to_x: { type: "number", description: "\u76EE\u6807\u70B9 X \u5750\u6807\uFF08\u50CF\u7D20\uFF09\u3002" },
          to_y: { type: "number", description: "\u76EE\u6807\u70B9 Y \u5750\u6807\uFF08\u50CF\u7D20\uFF09\u3002" }
        }
      }
    },
    {
      name: "browser_fill_form",
      description: "\u4E00\u6B21\u6027\u586B\u5199\u591A\u4E2A\u8868\u5355\u5B57\u6BB5\uFF0C\u53EF\u6309 selector\u3001name\u3001label\u3001placeholder \u6216\u5BF9\u8C61\u6620\u5C04\u5B9A\u4F4D\u63A7\u4EF6\u3002\u7528\u9014\uFF1A\u6279\u91CF\u586B\u8868\u3002\u573A\u666F\uFF1A\u767B\u5F55/\u6CE8\u518C/\u7ED3\u7B97\u7B49\u9700\u8981\u586B\u591A\u4E2A\u5B57\u6BB5\u5E76\u63D0\u4EA4\u7684\u8868\u5355\u3002",
      input_schema: {
        type: "object",
        properties: {
          fields: {
            type: "array",
            description: '\u5B57\u6BB5\u5217\u8868\u3002\u793A\u4F8B\uFF1A[{selector:"input[name=email]", value:"me@example.com"}, {label:"Password", value:"secret"}, {selector:"#remember", action:"check"}]\uFF1B\u8FD0\u884C\u65F6\u4E5F\u63A5\u53D7\u5BF9\u8C61\u6620\u5C04\u5199\u6CD5\u3002',
            items: {
              type: "object",
              properties: {
                selector: { type: "string", description: "\u8F93\u5165\u6846/\u4E0B\u62C9/\u6587\u672C\u57DF\u7684 CSS selector\u3002" },
                name: { type: "string", description: "\u8868\u5355\u63A7\u4EF6\u7684 name \u6216 id\uFF08\u515C\u5E95\u5B9A\u4F4D\uFF09\u3002" },
                label: { type: "string", description: "\u5B57\u6BB5\u9644\u8FD1\u7684\u53EF\u89C1 label \u6587\u672C\u3002" },
                placeholder: { type: "string", description: "\u7528\u4E8E\u5339\u914D\u7684 placeholder \u6587\u672C\u3002" },
                value: { type: ["string", "number", "boolean"], description: "\u8981\u8BBE\u7F6E\u7684\u503C\u3002" },
                action: { type: "string", enum: ["set", "type", "select", "check", "uncheck", "click"], description: "\u5982\u4F55\u5E94\u7528\u503C\uFF1Aset \u8BBE\u503C\u3001type \u6A21\u62DF\u8F93\u5165\u3001select \u9009\u62E9\u3001check/uncheck \u52FE\u9009\u3001click \u70B9\u51FB\u3002\u9ED8\u8BA4 set\u3002" }
              }
            }
          },
          submit_selector: { type: "string", description: "\u586B\u5B8C\u540E\u8981\u70B9\u51FB\u7684\u63D0\u4EA4\u6309\u94AE CSS selector\u3002" }
        },
        required: ["fields"]
      }
    },
    {
      name: "browser_select",
      description: "\u5728\u539F\u751F <select> \u4E0B\u62C9\u6216\u5E38\u89C1\u81EA\u5B9A\u4E49\u4E0B\u62C9/\u5217\u8868\u6846\u4E2D\u9009\u62E9\u67D0\u9879\uFF1A\u901A\u8FC7\u70B9\u51FB\u63A7\u4EF6\u5E76\u6309\u9009\u9879\u6587\u672C/\u503C\u5339\u914D\u3002\u7528\u9014\uFF1A\u5904\u7406\u4E0B\u62C9\u9009\u62E9\u3002\u573A\u666F\uFF1A\u9009\u62E9\u56FD\u5BB6\u3001\u57CE\u5E02\u3001\u6570\u91CF\u7B49\u4E0B\u62C9\u9879\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u4E0B\u62C9/\u81EA\u5B9A\u4E49\u4E0B\u62C9\u63A7\u4EF6\u7684 CSS selector\u3002" },
          value: { type: "string", description: "\u8981\u9009\u62E9\u7684\u9009\u9879\u503C\u6216\u53EF\u89C1\u6587\u672C\u3002" },
          text: { type: "string", description: "value \u7684\u522B\u540D\u3002" },
          option_text: { type: "string", description: "value \u7684\u522B\u540D\u3002" }
        },
        required: ["selector"]
      }
    },
    {
      name: "browser_close_popup",
      description: "\u5173\u95ED\u53EF\u89C1\u7684\u5F39\u7A97/\u6A21\u6001\u6846/\u5BF9\u8BDD\u6846\uFF1A\u4F18\u5148\u70B9\u68C0\u6D4B\u5230\u7684\u5173\u95ED\u6309\u94AE\uFF0C\u518D\u56DE\u9000\u5230 Escape/\u70B9\u906E\u7F69\u3002\u9700\u8981\u5148\u67E5\u770B\u5019\u9009\u65F6\u8BF7\u5148\u8C03\u7528 browser_find_popups\u3002\u7528\u9014\uFF1A\u6E05\u9664\u906E\u6321\u3002\u573A\u666F\uFF1A\u5173\u95ED cookie \u540C\u610F\u6761\u3001\u8BA2\u9605\u5F39\u7A97\u3001\u767B\u5F55\u5F15\u5BFC\u5C42\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u53EF\u9009\uFF1A\u8981\u5173\u95ED\u5F39\u7A97\u7684 CSS selector\u3002" },
          text: { type: "string", description: "\u53EF\u9009\uFF1A\u5F39\u7A97\u5185\u5305\u542B\u7684\u6587\u672C\uFF0C\u7528\u4E8E\u5B9A\u4F4D\u5B83\u3002" },
          index: { type: "number", description: "browser_find_popups \u8FD4\u56DE\u7684\u5F39\u7A97\u5E8F\u53F7\u3002\u9ED8\u8BA4 0\u3002" },
          strategy: { type: "string", enum: ["auto", "close_button", "escape", "backdrop"], description: "\u5173\u95ED\u7B56\u7565\uFF1Aauto \u81EA\u52A8\u3001close_button \u5173\u95ED\u6309\u94AE\u3001escape \u6309 Esc\u3001backdrop \u70B9\u906E\u7F69\u3002\u9ED8\u8BA4 auto\u3002" },
          force_remove: { type: "boolean", description: "\u4E3A true \u65F6\u4F5C\u4E3A\u6700\u540E\u624B\u6BB5\u76F4\u63A5\u79FB\u9664\u5F39\u7A97 DOM \u8282\u70B9\u3002" }
        }
      }
    },
    // ───── 数据与脚本 ─────────────────────────────────────────────────────
    {
      name: "browser_evaluate",
      description: "\u5728\u9875\u9762\u4E0A\u4E0B\u6587\u4E2D\u6267\u884C\u4EFB\u610F JavaScript \u5E76\u8FD4\u56DE\u7ED3\u679C\uFF1B\u53EF\u7528\u65F6\u8D70 Chrome DevTools Protocol\uFF0C\u56E0\u6B64\u5728 CSP \u53D7\u9650\u9875\u9762\u4E0A\u4E5F\u80FD\u8FD0\u884C\u3002\u7528\u9014\uFF1A\u9AD8\u7EA7\u53D6\u6570/\u64CD\u4F5C\u7684\u515C\u5E95\u624B\u6BB5\u3002\u573A\u666F\uFF1A\u5185\u7F6E\u5DE5\u5177\u65E0\u6CD5\u6EE1\u8DB3\u65F6\u8BFB\u53D6\u590D\u6742\u6570\u636E\u6216\u89E6\u53D1\u7279\u6B8A\u884C\u4E3A\uFF08\u8BF7\u8C28\u614E\u4F7F\u7528\uFF09\u3002",
      input_schema: {
        type: "object",
        properties: {
          code: { type: "string", description: "\u8981\u6267\u884C\u7684 JavaScript \u8868\u8FBE\u5F0F\u6216\u8BED\u53E5\u3002" },
          function: { type: "string", description: "code \u7684\u522B\u540D\uFF0C\u4FDD\u7559\u517C\u5BB9\u3002" },
          fn: { type: "string", description: "code \u7684\u522B\u540D\u3002" },
          expression: { type: "string", description: "code \u7684\u522B\u540D\u3002" },
          trace: { type: "boolean", description: "\u5931\u8D25\u65F6\u8FD4\u56DE\u7ED3\u6784\u5316\u7684 {error, code, suggestion, trace}\u3002" }
        }
      }
    },
    {
      name: "browser_extract",
      description: "\u4ECE\u5339\u914D selector \u7684\u5143\u7D20\u4E2D\u63D0\u53D6\u7ED3\u6784\u5316\u6570\u636E\uFF0C\u8FD4\u56DE\u5E26 tag\u3001selector\u3001\u6587\u672C\u3001\u5C5E\u6027\u53CA\u5E38\u7528\u5C5E\u6027\u522B\u540D\u7684\u5F52\u4E00\u5316\u6761\u76EE\u3002\u7528\u9014\uFF1A\u6279\u91CF\u6293\u53D6\u5217\u8868/\u8868\u683C\u3002\u573A\u666F\uFF1A\u6293\u53D6\u641C\u7D22\u7ED3\u679C\u3001\u5546\u54C1\u5217\u8868\u3001\u8868\u683C\u884C\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u8981\u67E5\u8BE2\u7684 CSS selector\u3002" },
          attributes: { type: "array", items: { type: "string" }, description: "\u6BCF\u4E2A\u5143\u7D20\u9700\u8981\u91C7\u96C6\u7684\u5C5E\u6027\u540D\u5217\u8868\u3002" },
          limit: { type: "number", description: "\u6700\u591A\u63D0\u53D6\u7684\u5143\u7D20\u6570\u3002\u9ED8\u8BA4 50\u3002" }
        },
        required: ["selector"]
      }
    },
    {
      name: "browser_clipboard_write",
      description: "\u628A\u6587\u672C\u5199\u5165\u7CFB\u7EDF\u526A\u8D34\u677F\u3002\u7528\u9014\uFF1A\u590D\u5236\u5185\u5BB9\u4F9B\u5176\u4ED6\u7A0B\u5E8F\u7C98\u8D34\u3002\u573A\u666F\uFF1A\u590D\u5236\u63D0\u53D6\u5230\u7684\u7ED3\u679C\u3001\u590D\u5236\u751F\u6210\u7684\u94FE\u63A5\u3002",
      input_schema: {
        type: "object",
        properties: { text: { type: "string", description: "\u8981\u590D\u5236\u5230\u526A\u8D34\u677F\u7684\u6587\u672C\u3002" } },
        required: ["text"]
      }
    },
    {
      name: "browser_file_upload",
      description: "\u7528\u5185\u5B58\u4E2D\u7684\u6587\u4EF6\u5185\u5BB9\u586B\u5145 <input type=file>\u3002\u6CE8\u610F\uFF1A\u6269\u5C55\u65E0\u6CD5\u8BFB\u53D6\u672C\u673A\u6587\u4EF6\u7CFB\u7EDF\u8DEF\u5F84\uFF0C\u5FC5\u987B\u76F4\u63A5\u63D0\u4F9B\u5185\u5BB9\u3002\u7528\u9014\uFF1A\u4E0A\u4F20\u6587\u4EF6\u3002\u573A\u666F\uFF1A\u628A\u4E00\u6BB5\u6587\u672C/base64 \u5185\u5BB9\u4F5C\u4E3A\u6587\u4EF6\u4E0A\u4F20\u5230\u7F51\u9875\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u6587\u4EF6\u8F93\u5165\u6846\u7684 CSS selector\u3002\u9ED8\u8BA4 input[type=file]\u3002" },
          files: {
            type: "array",
            description: '\u8981\u5408\u6210\u7684\u6587\u4EF6\uFF0C\u4F8B\u5982 [{name:"a.txt", content:"hello", type:"text/plain"}]\uFF0C\u6216\u8BBE\u7F6E encoding:"base64"\u3002',
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "\u6587\u4EF6\u540D\u3002" },
                content: { type: "string", description: "\u6587\u4EF6\u5185\u5BB9\uFF08\u6309 encoding \u89E3\u91CA\uFF09\u3002" },
                type: { type: "string", description: "MIME \u7C7B\u578B\uFF0C\u5982 text/plain\u3002" },
                encoding: { type: "string", enum: ["text", "base64"], description: "content \u7684\u7F16\u7801\uFF1Atext \u7EAF\u6587\u672C\u6216 base64\u3002" }
              },
              required: ["name", "content"]
            }
          }
        },
        required: ["files"]
      }
    },
    {
      name: "browser_download",
      description: "\u901A\u8FC7 chrome.downloads \u4ECE\u67D0\u4E2A URL \u53D1\u8D77\u6D4F\u89C8\u5668\u4E0B\u8F7D\u3002\u7528\u9014\uFF1A\u4FDD\u5B58\u6587\u4EF6\u5230\u672C\u5730\u4E0B\u8F7D\u76EE\u5F55\u3002\u573A\u666F\uFF1A\u4E0B\u8F7D\u5BFC\u51FA\u6587\u4EF6\u3001\u56FE\u7247\u3001\u9644\u4EF6\u3002",
      input_schema: {
        type: "object",
        properties: {
          url: { type: "string", description: "\u8981\u4E0B\u8F7D\u7684 URL\u3002" },
          filename: { type: "string", description: "\u53EF\u9009\uFF1A\u4E0B\u8F7D\u76EE\u5F55\u4E0B\u7684\u76F8\u5BF9\u6587\u4EF6\u540D\u3002" },
          save_as: { type: "boolean", description: "\u663E\u793A\u300C\u53E6\u5B58\u4E3A\u300D\u5BF9\u8BDD\u6846\u3002" }
        },
        required: ["url"]
      }
    },
    // ───── 浏览器状态（资源 + action）────────────────────────────────────
    {
      name: "browser_tab",
      description: "\u7BA1\u7406\u6D4F\u89C8\u5668\u6807\u7B7E\u9875\uFF1A\u5217\u51FA\u3001\u65B0\u5F00\u6216\u5173\u95ED\u3002\u7528\u9014\uFF1A\u5728\u591A\u6807\u7B7E\u95F4\u7EC4\u7EC7\u5DE5\u4F5C\u3002\u573A\u666F\uFF1A\u67E5\u770B\u6709\u54EA\u4E9B\u6807\u7B7E\uFF08list\uFF09\u3001\u5E76\u884C\u6253\u5F00\u7F51\u5740\uFF08open\uFF09\u3001\u5B8C\u6210\u540E\u5173\u95ED\u6807\u7B7E\uFF08close\uFF09\u3002",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "open", "close"], description: "\u52A8\u4F5C\uFF1Alist \u5217\u51FA\u6240\u6709\u6807\u7B7E\u3001open \u7528 url \u65B0\u5F00\u6807\u7B7E\u3001close \u5173\u95ED tab_id\uFF08\u4E0D\u4F20\u5219\u5F53\u524D\u6807\u7B7E\uFF09\u3002" },
          url: { type: "string", description: "action=open \u65F6\u8981\u6253\u5F00\u7684 URL\u3002" },
          tab_id: { type: "number", description: "action=close \u65F6\u8981\u5173\u95ED\u7684\u6807\u7B7E ID\uFF1B\u4E0D\u4F20\u5219\u5173\u95ED\u5F53\u524D\u6D3B\u52A8\u6807\u7B7E\u3002" }
        },
        required: ["action"]
      }
    },
    {
      name: "browser_cookie",
      description: "\u7BA1\u7406\u5F53\u524D\u6807\u7B7E\u9875 URL \u6216\u6307\u5B9A URL/\u57DF\u540D\u7684 cookie\uFF1A\u5217\u51FA\u3001\u8BFB\u53D6\u3001\u5199\u5165\u3001\u5220\u9664\u3002\u7528\u9014\uFF1A\u67E5\u770B\u6216\u64CD\u4F5C\u4F1A\u8BDD\u72B6\u6001\u3002\u573A\u666F\uFF1A\u68C0\u67E5\u767B\u5F55\u6001\uFF08list/get\uFF09\u3001\u6CE8\u5165\u767B\u5F55/\u504F\u597D cookie\uFF08set\uFF0C\u5199\u5165\uFF09\u3001\u9000\u51FA\u767B\u5F55\uFF08delete\uFF0C\u5199\u5165\uFF09\u3002",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "get", "set", "delete"], description: "\u52A8\u4F5C\uFF1Alist \u5217\u51FA\u3001get \u6309 name \u53D6\u5355\u4E2A\u3001set \u5199\u5165\u3001delete \u5220\u9664\u3002" },
          url: { type: "string", description: "cookie \u6240\u5C5E URL\u3002\u9ED8\u8BA4\u5F53\u524D\u6807\u7B7E\u9875 URL\u3002" },
          domain: { type: "string", description: "action=list \u65F6\u53EF\u6309\u57DF\u540D\u8FC7\u6EE4\u3002" },
          name: { type: "string", description: "cookie \u540D\u79F0\uFF08get/set/delete \u5FC5\u586B\uFF09\u3002" },
          value: { type: "string", description: "action=set \u65F6\u7684 cookie \u503C\u3002" },
          path: { type: "string", description: "action=set \u65F6\u7684 cookie \u8DEF\u5F84\u3002" },
          secure: { type: "boolean", description: "action=set \u65F6\u662F\u5426\u4EC5 HTTPS \u4F20\u8F93\u3002" },
          http_only: { type: "boolean", description: "action=set \u65F6\u662F\u5426\u6807\u8BB0 HttpOnly\u3002" },
          expiration_date: { type: "number", description: "action=set \u65F6\u7684\u8FC7\u671F\u65F6\u95F4\uFF08Unix \u79D2\uFF09\u3002" }
        },
        required: ["action"]
      }
    },
    {
      name: "browser_storage",
      description: "\u8BFB\u5199\u5F53\u524D\u9875\u9762\u7684 localStorage / sessionStorage\uFF1A\u8BFB\u53D6\u3001\u5199\u5165\u3001\u5220\u9664\u3001\u5217\u51FA key\u3002\u7528\u9014\uFF1A\u67E5\u770B\u6216\u64CD\u4F5C\u524D\u7AEF\u5B58\u50A8\u72B6\u6001\u3002\u573A\u666F\uFF1A\u8BFB\u53D6 token/\u504F\u597D\uFF08get/list\uFF09\u3001\u6CE8\u5165\u6807\u8BB0\u4F4D\uFF08set\uFF0C\u5199\u5165\uFF09\u3001\u6E05\u9664\u7F13\u5B58\u9879\uFF08remove\uFF0C\u5199\u5165\uFF09\u3002",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["get", "set", "remove", "list"], description: "\u52A8\u4F5C\uFF1Aget \u8BFB\u53D6 key\u3001set \u5199\u5165 key\u3001remove \u5220\u9664 key\u3001list \u5217\u51FA key\u3002" },
          type: { type: "string", enum: ["local", "session"], description: "\u5B58\u50A8\u7C7B\u578B\uFF1Alocal \u6216 session\u3002\u9ED8\u8BA4 local\u3002" },
          key: { type: "string", description: "\u5B58\u50A8\u952E\u540D\uFF08get/set/remove \u5FC5\u586B\uFF09\u3002" },
          value: { type: "string", description: "action=set \u65F6\u8981\u5B58\u50A8\u7684\u503C\u3002" },
          prefix: { type: "string", description: "action=list \u65F6\u6309\u952E\u540D\u524D\u7F00\u8FC7\u6EE4\u3002" },
          include_values: { type: "boolean", description: "action=list \u65F6\u5728\u7ED3\u679C\u4E2D\u5305\u542B value\u3002" },
          limit: { type: "number", description: "action=list \u65F6\u6700\u591A\u8FD4\u56DE\u7684 key/\u6761\u76EE\u6570\u3002\u9ED8\u8BA4 100\u3002" }
        },
        required: ["action"]
      }
    },
    {
      name: "browser_session",
      description: "\u7BA1\u7406\u8F7B\u91CF\u6D4F\u89C8\u5668\u4E0A\u4E0B\u6587\u5FEB\u7167\uFF08\u5F53\u524D URL/\u6807\u9898 + \u8BE5\u9875 localStorage/sessionStorage\uFF09\uFF1A\u4FDD\u5B58\u3001\u5217\u51FA\u3001\u6062\u590D\u3001\u5220\u9664\u3002\u7528\u9014\uFF1A\u7559\u5B58\u5E76\u56DE\u5230\u6B64\u524D\u7684\u4F1A\u8BDD\u73B0\u573A\u3002\u573A\u666F\uFF1A\u4FDD\u5B58\u767B\u5F55\u6001\u7A0D\u540E\u6062\u590D\uFF08save/restore\uFF09\u3001\u67E5\u770B\u53EF\u6062\u590D\u4F1A\u8BDD\uFF08list\uFF09\u3001\u6E05\u7406\u8FC7\u671F\u5FEB\u7167\uFF08delete\uFF09\u3002",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["save", "list", "restore", "delete"], description: "\u52A8\u4F5C\uFF1Asave \u4FDD\u5B58\u5F53\u524D\u73B0\u573A\u3001list \u5217\u51FA\u5FEB\u7167\u3001restore \u6062\u590D\u5FEB\u7167\u3001delete \u5220\u9664\u5FEB\u7167\u3002" },
          id: { type: "string", description: "\u4F1A\u8BDD id\uFF08restore/delete \u7528\uFF0Csave \u53EF\u9009\uFF09\u3002" },
          name: { type: "string", description: "\u4FBF\u4E8E\u8BC6\u522B\u7684\u4F1A\u8BDD\u540D\u79F0\uFF08restore/delete \u4E5F\u53EF\u6309 name \u5B9A\u4F4D\uFF09\u3002" },
          new_tab: { type: "boolean", description: "action=restore \u65F6\u5728\u65B0\u6807\u7B7E\u9875\u4E2D\u6062\u590D\u3002" }
        },
        required: ["action"]
      }
    }
  ];
  var BROWSER_CAPABILITIES = BROWSER_TOOLS.map((t) => t.name);
  function isToolEnabledByDefault(_name) {
    return true;
  }

  // src/lib/tools/browser.ts
  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id)
      throw new Error("No active tab found");
    return tab;
  }
  function sendToContent(tabId, msg) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, msg, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(err);
          return;
        }
        resolve(response);
      });
    });
  }
  function isNoReceiverError(err) {
    const m = err?.message || "";
    return m.includes("Could not establish connection") || m.includes("Receiving end does not exist");
  }
  function contentScriptFiles() {
    try {
      const manifest = chrome.runtime.getManifest();
      const files = [];
      for (const cs of manifest.content_scripts || []) {
        for (const js of cs.js || [])
          files.push(js);
      }
      if (files.length)
        return files;
    } catch {
    }
    return ["dist/content.js"];
  }
  async function injectContentScript(tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: contentScriptFiles()
      });
      return true;
    } catch {
      return false;
    }
  }
  function unwrapContentResult(res) {
    if (res?.error) {
      const detail = typeof res.error === "object" ? res.error : { message: String(res.error), code: "CONTENT_ACTION_FAILED" };
      const err = new Error(detail.message || "Content action failed");
      err.code = detail.code || "CONTENT_ACTION_FAILED";
      err.suggestion = detail.suggestion;
      err.trace = res.trace;
      throw err;
    }
    return res;
  }
  async function contentMsg(tabId, msg) {
    try {
      return unwrapContentResult(await sendToContent(tabId, msg));
    } catch (err) {
      if (!isNoReceiverError(err))
        throw err;
      const injected = await injectContentScript(tabId);
      if (injected) {
        try {
          return unwrapContentResult(await sendToContent(tabId, msg));
        } catch (retryErr) {
          if (!isNoReceiverError(retryErr))
            throw retryErr;
        }
      }
      const e = new Error("Content script unavailable on this page (try a normal web page, not chrome://).");
      e.code = "CONTENT_SCRIPT_UNAVAILABLE";
      e.suggestion = "Navigate to a normal http/https page and retry.";
      throw e;
    }
  }
  function normalizeToolError(err, name, args) {
    return {
      message: err?.message || String(err),
      code: err?.code || "TOOL_FAILED",
      suggestion: err?.suggestion || suggestionForTool(name),
      trace: args?.trace ? {
        tool: name,
        args,
        cause: err?.trace || null,
        stack: err?.stack || "",
        timestamp: Date.now()
      } : void 0
    };
  }
  function suggestionForTool(name) {
    if (name.includes("click") || name.includes("select") || name.includes("drag"))
      return "Use browser_page_info, browser_dom_snapshot, or browser_find_text to verify the target selector/text, then retry.";
    if (name.includes("screenshot"))
      return "Confirm the tool is enabled by policy and the extension has permission for the current tab.";
    if (name.includes("cookie"))
      return "Confirm the cookies permission is enabled and the URL/domain is valid.";
    return "Check tool parameters and current page state, then retry with trace:true for details.";
  }
  async function waitForTabLoad(tabId, timeoutMs = 15e3) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error("Page load timed out"));
      }, timeoutMs);
      function listener(id, info) {
        if (id === tabId && info.status === "complete") {
          clearTimeout(t);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      }
      chrome.tabs.onUpdated.addListener(listener);
    });
  }
  async function toolNavigate(args) {
    if (!args.url)
      throw new Error("url is required");
    let url2;
    try {
      url2 = new URL(args.url);
    } catch {
      url2 = new URL("https://" + args.url);
    }
    if (args.new_tab) {
      const tab2 = await chrome.tabs.create({ url: url2.href });
      await waitForTabLoad(tab2.id);
      return { success: true, url: url2.href, tabId: tab2.id, new_tab: true };
    }
    const tab = await getActiveTab();
    await chrome.tabs.update(tab.id, { url: url2.href });
    await waitForTabLoad(tab.id);
    return { success: true, url: url2.href, tabId: tab.id };
  }
  function unsupportedScreenshotReason(url2) {
    const raw = String(url2 || "");
    if (/^(chrome|edge|brave|vivaldi|opera|chrome-extension):\/\//i.test(raw)) {
      return "\u6D4F\u89C8\u5668\u5185\u90E8\u9875\u9762\u6216\u6269\u5C55\u9875\u9762\u4E0D\u5141\u8BB8\u6269\u5C55\u622A\u56FE\u3002\u8BF7\u5207\u6362\u5230\u666E\u901A http/https \u9875\u9762\u540E\u91CD\u8BD5\u3002";
    }
    if (/^https:\/\/chromewebstore\.google\.com\//i.test(raw)) {
      return "Chrome \u7F51\u4E0A\u5E94\u7528\u5E97\u9875\u9762\u4E0D\u5141\u8BB8\u6269\u5C55\u622A\u56FE\u3002";
    }
    return "";
  }
  function isRetryableCaptureError(message) {
    return /quota|too many|rate|active|visible|tab|capture|pending|loading/i.test(message);
  }
  async function delay(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
  async function withTimeout(promise, ms, label) {
    let timer = null;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        })
      ]);
    } finally {
      if (timer)
        clearTimeout(timer);
    }
  }
  function boundedTimeout(value2, fallback, min = 1e3, max = 3e4) {
    const n = Number(value2);
    if (!Number.isFinite(n))
      return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }
  function screenshotFormat(args) {
    const format = String(args.format || "png").toLowerCase();
    return ["png", "jpeg", "webp"].includes(format) ? format : "png";
  }
  function screenshotQuality(args) {
    const quality = Number(args.quality);
    if (!Number.isFinite(quality))
      return void 0;
    return Math.min(100, Math.max(0, Math.round(quality)));
  }
  function maxDataUrlChars(args) {
    const n = Number(args.max_data_url_chars);
    if (Number.isFinite(n) && n > 0)
      return Math.min(2e7, Math.max(1e5, Math.round(n)));
    return 8e6;
  }
  function wantsServerSave(args) {
    return args?.save_to_server === true || args?.upload_to_server === true;
  }
  async function ensureScreenshotPayloadSize(dataUrl, args, retryCompressed) {
    const maxChars = maxDataUrlChars(args);
    if (dataUrl.length <= maxChars || args.allow_large_data_url === true) {
      return { dataUrl, warning: "" };
    }
    if (retryCompressed && screenshotFormat(args) !== "jpeg") {
      const compressed = await retryCompressed();
      if (compressed.length <= maxChars || args.allow_large_data_url === true) {
        return {
          dataUrl: compressed,
          warning: `Original screenshot payload was ${dataUrl.length} chars; returned compressed JPEG payload ${compressed.length} chars.`
        };
      }
      throw new Error(`Screenshot payload is too large after JPEG compression: ${compressed.length} chars > max_data_url_chars ${maxChars}`);
    }
    throw new Error(`Screenshot payload is too large: ${dataUrl.length} chars > max_data_url_chars ${maxChars}`);
  }
  function clipArea(clip) {
    return Math.max(0, clip.width) * Math.max(0, clip.height);
  }
  function assertValidClip(clip, maxArea) {
    if (!Number.isFinite(clip.x) || !Number.isFinite(clip.y) || !Number.isFinite(clip.width) || !Number.isFinite(clip.height)) {
      throw new Error("clip/x/y/width/height must be finite numbers");
    }
    if (clip.width <= 0 || clip.height <= 0)
      throw new Error("clip width and height must be greater than 0");
    if (clipArea(clip) > maxArea) {
      throw new Error(`Screenshot area is too large: ${Math.round(clipArea(clip))} CSS pixels > max_area ${maxArea}`);
    }
  }
  async function captureVisibleTab(windowId, args, retries = 1) {
    let lastErr;
    const timeoutMs = boundedTimeout(args.visible_timeout_ms ?? args.timeout_ms, 8e3);
    for (let i = 0; i <= retries; i++) {
      try {
        return await withTimeout(
          chrome.tabs.captureVisibleTab(windowId, {
            format: screenshotFormat(args) === "jpeg" ? "jpeg" : "png",
            quality: screenshotQuality(args)
          }),
          timeoutMs,
          "chrome.tabs.captureVisibleTab"
        );
      } catch (err) {
        lastErr = err;
        const message = err?.message || String(err);
        if (i >= retries || !isRetryableCaptureError(message))
          break;
        await delay(300);
      }
    }
    throw lastErr;
  }
  async function pageClipFromArgs(tab, args) {
    const maxArea = Math.max(1, Number(args.max_area || 25e6));
    const scale = Number(args.scale || 1);
    const contentTimeoutMs = boundedTimeout(args.content_timeout_ms ?? args.timeout_ms, 5e3);
    const cdpTimeoutMs = boundedTimeout(args.cdp_timeout_ms ?? args.timeout_ms, 12e3);
    if (args.selector || args.text) {
      const target = await withTimeout(
        contentMsg(tab.id, {
          action: "screenshot_target_info",
          selector: args.selector,
          text: args.text,
          margin: args.margin ?? args.padding,
          scroll_into_view: args.scroll_into_view,
          block: args.block,
          inline: args.inline
        }),
        contentTimeoutMs,
        "screenshot target measurement"
      );
      const rect = target?.rect?.page;
      const clip2 = {
        x: Number(rect?.x),
        y: Number(rect?.y),
        width: Number(rect?.width),
        height: Number(rect?.height),
        scale
      };
      assertValidClip(clip2, maxArea);
      return clip2;
    }
    const rawClip = args.clip && typeof args.clip === "object" ? args.clip : args;
    const hasRegion = rawClip.x !== void 0 && rawClip.y !== void 0 && rawClip.width !== void 0 && rawClip.height !== void 0;
    if (!hasRegion)
      return null;
    const coordinateSpace = String(args.coordinate_space || rawClip.coordinate_space || "viewport");
    let x = Number(rawClip.x);
    let y = Number(rawClip.y);
    if (coordinateSpace !== "page") {
      const metrics = await withTimeout(
        chrome.debugger.sendCommand({ tabId: tab.id }, "Page.getLayoutMetrics"),
        cdpTimeoutMs,
        "CDP Page.getLayoutMetrics"
      );
      const viewport = metrics?.cssLayoutViewport || metrics?.layoutViewport;
      x += Number(viewport?.pageX || 0);
      y += Number(viewport?.pageY || 0);
    }
    const clip = {
      x: Math.max(0, x),
      y: Math.max(0, y),
      width: Number(rawClip.width),
      height: Number(rawClip.height),
      scale
    };
    assertValidClip(clip, maxArea);
    return clip;
  }
  async function captureWithDebugger(tab, args = {}) {
    const target = { tabId: tab.id };
    let attached = false;
    const timeoutMs = boundedTimeout(args.cdp_timeout_ms ?? args.timeout_ms, 12e3);
    try {
      await withTimeout(chrome.debugger.attach(target, "1.3"), timeoutMs, "CDP attach");
      attached = true;
      await withTimeout(chrome.debugger.sendCommand(target, "Page.enable"), timeoutMs, "CDP Page.enable");
      const format = screenshotFormat(args);
      const params = { format, fromSurface: args.from_surface !== false };
      const quality = screenshotQuality(args);
      if (format !== "png" && quality !== void 0)
        params.quality = quality;
      const maxArea = Math.max(1, Number(args.max_area || 25e6));
      const clip = await pageClipFromArgs(tab, args);
      if (clip) {
        params.captureBeyondViewport = true;
        params.clip = clip;
      } else if (args.full_page) {
        const metrics = await withTimeout(
          chrome.debugger.sendCommand(target, "Page.getLayoutMetrics"),
          timeoutMs,
          "CDP Page.getLayoutMetrics"
        );
        const size = metrics?.cssContentSize || metrics?.contentSize;
        if (size?.width && size?.height) {
          const fullClip = {
            x: 0,
            y: 0,
            width: Math.ceil(size.width),
            height: Math.ceil(size.height),
            scale: Number(args.scale || 1)
          };
          assertValidClip(fullClip, maxArea);
          params.captureBeyondViewport = true;
          params.clip = fullClip;
        }
      }
      const result = await withTimeout(
        chrome.debugger.sendCommand(target, "Page.captureScreenshot", params),
        timeoutMs,
        "CDP Page.captureScreenshot"
      );
      if (!result?.data)
        throw new Error("CDP Page.captureScreenshot returned no image data");
      return `data:image/${format === "jpeg" ? "jpeg" : format};base64,${result.data}`;
    } finally {
      if (attached) {
        try {
          await chrome.debugger.detach(target);
        } catch {
        }
      }
    }
  }
  async function toolScreenshot(args = {}) {
    const tab = await getActiveTab();
    const unsupported = unsupportedScreenshotReason(tab.url);
    if (unsupported) {
      return {
        success: false,
        disabled: true,
        unsupported: true,
        error: unsupported,
        tabId: tab.id,
        url: tab.url,
        hint: unsupported
      };
    }
    const wantsDebuggerCapture = !!(args.full_page || args.selector || args.text || args.clip || args.x !== void 0 && args.y !== void 0 && args.width !== void 0 && args.height !== void 0);
    const attempts = [];
    if (wantsDebuggerCapture) {
      try {
        const dataUrl = await captureWithDebugger(tab, args);
        const optimized = await ensureScreenshotPayloadSize(dataUrl, args, () => captureWithDebugger(tab, {
          ...args,
          format: "jpeg",
          quality: args.quality ?? 70
        }));
        return {
          success: true,
          dataUrl: optimized.dataUrl,
          save_to_server: wantsServerSave(args),
          tabId: tab.id,
          url: tab.url,
          method: args.full_page ? "debugger.Page.captureScreenshot.fullPage" : args.selector || args.text ? "debugger.Page.captureScreenshot.element" : "debugger.Page.captureScreenshot.clip",
          warning: optimized.warning || void 0
        };
      } catch (err) {
        attempts.push(`debugger.Page.captureScreenshot: ${err?.message || String(err)}`);
      }
      if (args.fallback_visible !== true) {
        const message2 = attempts.join("; ");
        return {
          success: false,
          disabled: /disabled|permission|not allowed|cannot|restricted|debugger/i.test(message2),
          error: message2,
          tabId: tab.id,
          url: tab.url,
          hint: "\u7CBE\u786E\u622A\u56FE\u5931\u8D25\u3002\u8BF7\u68C0\u67E5 selector/text/clip \u53C2\u6570\uFF1B\u82E5\u8981\u5931\u8D25\u65F6\u9000\u56DE\u53EF\u89C6\u533A\u57DF\u622A\u56FE\uFF0C\u8BF7\u4F20 fallback_visible:true\u3002"
        };
      }
    }
    try {
      const dataUrl = await captureVisibleTab(tab.windowId, args, Number(args.retries ?? 1));
      const optimized = await ensureScreenshotPayloadSize(dataUrl, args, () => captureVisibleTab(tab.windowId, {
        ...args,
        format: "jpeg",
        quality: args.quality ?? 70,
        retries: 0
      }, 0));
      return {
        success: true,
        dataUrl: optimized.dataUrl,
        save_to_server: wantsServerSave(args),
        tabId: tab.id,
        url: tab.url,
        method: "captureVisibleTab",
        warning: [attempts.length ? attempts.join("; ") : "", optimized.warning].filter(Boolean).join("; ") || void 0
      };
    } catch (err) {
      attempts.push(`captureVisibleTab: ${err?.message || String(err)}`);
    }
    if (!wantsDebuggerCapture) {
      try {
        const dataUrl = await captureWithDebugger(tab, args);
        const optimized = await ensureScreenshotPayloadSize(dataUrl, args, () => captureWithDebugger(tab, {
          ...args,
          format: "jpeg",
          quality: args.quality ?? 70
        }));
        return {
          success: true,
          dataUrl: optimized.dataUrl,
          save_to_server: wantsServerSave(args),
          tabId: tab.id,
          url: tab.url,
          method: "debugger.Page.captureScreenshot",
          warning: [attempts.join("; "), optimized.warning].filter(Boolean).join("; ")
        };
      } catch (err) {
        attempts.push(`debugger.Page.captureScreenshot: ${err?.message || String(err)}`);
      }
    }
    const message = attempts.join("; ");
    return {
      success: false,
      disabled: /disabled|permission|not allowed|cannot|restricted|debugger/i.test(message),
      error: message,
      tabId: tab.id,
      url: tab.url,
      hint: "\u622A\u56FE\u4E0D\u53EF\u7528\u3002\u8BF7\u786E\u8BA4\u6269\u5C55\u62E5\u6709\u5F53\u524D\u9875\u9762\u6743\u9650\uFF1B\u82E5\u9875\u9762\u662F\u6D4F\u89C8\u5668\u5185\u90E8\u9875\u3001\u6269\u5C55\u9875\u3001Chrome \u7F51\u4E0A\u5E94\u7528\u5E97\u6216\u53D7 DRM \u4FDD\u62A4\u5185\u5BB9\uFF0CChrome \u4F1A\u963B\u6B62\u622A\u56FE\u3002"
    };
  }
  async function toolSearch(args) {
    const query = String(args.query || "");
    if (!query)
      throw new Error("query is required");
    const engine = String(args.engine || "google").toLowerCase();
    const base = SEARCH_ENGINES[engine] || SEARCH_ENGINES.google;
    const url2 = base + encodeURIComponent(query);
    const tab = await getActiveTab();
    await chrome.tabs.update(tab.id, { url: url2 });
    await waitForTabLoad(tab.id);
    return { success: true, query, engine, url: url2 };
  }
  async function toolTabList() {
    const tabs = await chrome.tabs.query({});
    return {
      success: true,
      count: tabs.length,
      tabs: tabs.map((t) => ({ id: t.id, url: t.url, title: t.title, active: t.active, windowId: t.windowId }))
    };
  }
  async function toolTabOpen(args) {
    const tab = await chrome.tabs.create({ url: args.url || "about:blank" });
    return { success: true, tabId: tab.id, url: tab.url };
  }
  async function toolTabClose(args) {
    const tabId = args.tab_id ? Number(args.tab_id) : (await getActiveTab()).id;
    await chrome.tabs.remove(tabId);
    return { success: true, tabId };
  }
  async function toolHistoryBack() {
    const tab = await getActiveTab();
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => history.back() });
    return { success: true };
  }
  async function toolHistoryForward() {
    const tab = await getActiveTab();
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => history.forward() });
    return { success: true };
  }
  async function toolClipboardWrite(args) {
    const text = String(args.text ?? "");
    const tab = await getActiveTab();
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (t) => navigator.clipboard.writeText(t),
      args: [text]
    });
    return { success: true, length: text.length };
  }
  async function toolClick(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, {
      action: "click",
      ref: args.ref ?? args.mark ?? args.id,
      selector: args.selector,
      text: args.text,
      x: args.x,
      y: args.y,
      force: !!args.force
    });
  }
  async function toolObserve(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "observe", limit: args.limit, mark: args.mark });
  }
  async function toolType(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "type", selector: args.selector, text: args.text, clearFirst: args.clear_first !== false, submit: !!args.submit });
  }
  async function toolGetContent(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "get_content", selector: args.selector, includeHtml: !!args.include_html, max_chars: args.max_chars });
  }
  async function toolScroll(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "scroll", direction: args.direction, amount: args.amount || 400, selector: args.selector });
  }
  async function toolWait(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "wait", selector: args.selector, ms: args.ms });
  }
  function remoteObjectValue(obj) {
    if (!obj)
      return void 0;
    if ("value" in obj)
      return obj.value;
    if ("unserializableValue" in obj)
      return obj.unserializableValue;
    return obj.description ?? `[${obj.type || "unknown"}]`;
  }
  function exceptionMessage(details) {
    const exception = details?.exception;
    return exception?.description || exception?.value || details?.text || "JavaScript evaluation failed";
  }
  async function debuggerEvaluate(tabId, code) {
    const target = { tabId };
    let attached = false;
    async function evaluateExpression(expression) {
      const result = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
        replMode: true
      });
      if (result?.exceptionDetails)
        throw new Error(exceptionMessage(result.exceptionDetails));
      return result?.result;
    }
    try {
      await chrome.debugger.attach(target, "1.3");
      attached = true;
      let result;
      try {
        result = await evaluateExpression(code);
      } catch (err) {
        if (!/Illegal return statement|Unexpected token|await is only valid/i.test(err.message || ""))
          throw err;
        result = await evaluateExpression(`(async () => {
${code}
})()`);
      }
      return {
        success: true,
        result: remoteObjectValue(result),
        type: result?.type,
        subtype: result?.subtype,
        executionContext: "debugger"
      };
    } finally {
      if (attached) {
        try {
          await chrome.debugger.detach(target);
        } catch {
        }
      }
    }
  }
  async function toolEvaluate(args) {
    const tab = await getActiveTab();
    const rawCode = args.code ?? args.function ?? args.fn ?? args.expression;
    const code = typeof rawCode === "function" ? String(rawCode) : String(rawCode || "");
    if (!code)
      throw new Error("code is required");
    try {
      return await debuggerEvaluate(tab.id, code);
    } catch (debuggerErr) {
      try {
        const fallback = await contentMsg(tab.id, { action: "evaluate", code });
        return {
          ...fallback,
          executionContext: "content_script",
          warning: `CDP Runtime.evaluate failed: ${debuggerErr.message || String(debuggerErr)}`
        };
      } catch (contentErr) {
        throw new Error(`browser_evaluate failed. CDP Runtime.evaluate: ${debuggerErr.message || String(debuggerErr)}; content script fallback: ${contentErr.message || String(contentErr)}`);
      }
    }
  }
  async function toolExtract(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "extract", selector: args.selector, attributes: args.attributes, limit: args.limit || 50 });
  }
  async function toolDomSnapshot(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "dom_snapshot", selector: args.selector, max_depth: args.max_depth, max_nodes: args.max_nodes, trace: !!args.trace });
  }
  async function toolIframeList() {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "iframe_list" });
  }
  async function toolPerformance() {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "performance" });
  }
  async function toolNetworkLog(args) {
    const tab = await getActiveTab();
    const result = await contentMsg(tab.id, { action: "performance" });
    return {
      ...result,
      source: "performance_resource_timing",
      warning: "This is a passive resource-timing view, not active network interception. Full request/response interception requires a debugger/webRequest pipeline.",
      limit: args.limit || 20,
      requests: (result.resources?.slowest || []).slice(0, args.limit || 20)
    };
  }
  async function toolFindText(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "find_text", text: args.text, exact: !!args.exact });
  }
  async function toolFindPopups(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "find_popups", limit: args.limit || 10 });
  }
  async function toolClosePopup(args) {
    const tab = await getActiveTab();
    const result = await contentMsg(tab.id, {
      action: "close_popup",
      selector: args.selector,
      text: args.text,
      index: args.index,
      strategy: args.strategy || "auto",
      force_remove: !!args.force_remove
    });
    if (result?.success === false)
      throw new Error(result.reason || "Popup close failed");
    return result;
  }
  async function toolFillForm(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, {
      action: "fill_form",
      fields: args.fields || args.form_fields || args.values,
      submitSelector: args.submit_selector || args.submitSelector
    });
  }
  async function toolSelect(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "select", selector: args.selector, value: args.value ?? args.text ?? args.option_text });
  }
  async function toolStorageGet(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "storage_get", key: args.key, storageType: args.type || "local" });
  }
  async function toolStorageSet(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "storage_set", key: args.key, value: args.value, storageType: args.type || "local" });
  }
  async function toolStorageRemove(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "storage_remove", key: args.key, storageType: args.type || "local" });
  }
  async function toolStorageList(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "storage_list", prefix: args.prefix, include_values: !!args.include_values, limit: args.limit, storageType: args.type || "local" });
  }
  async function toolFileUpload(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "file_upload", selector: args.selector, files: args.files });
  }
  async function toolDownload(args) {
    if (!args.url)
      throw new Error("url is required");
    const id = await chrome.downloads.download({
      url: String(args.url),
      filename: args.filename ? String(args.filename) : void 0,
      saveAs: !!args.save_as
    });
    return { success: true, downloadId: id, url: args.url, filename: args.filename || "" };
  }
  async function toolCookieList(args) {
    const tab = await getActiveTab();
    const url2 = String(args.url || tab.url || "");
    const cookies = await chrome.cookies.getAll(args.domain ? { domain: String(args.domain) } : { url: url2 });
    return { success: true, url: url2, domain: args.domain || "", count: cookies.length, cookies };
  }
  async function toolCookieGet(args) {
    const tab = await getActiveTab();
    const url2 = String(args.url || tab.url || "");
    if (!args.name)
      throw new Error("name is required");
    const cookie = await chrome.cookies.get({ url: url2, name: String(args.name) });
    return { success: true, url: url2, name: args.name, found: !!cookie, cookie };
  }
  async function toolCookieSet(args) {
    const tab = await getActiveTab();
    const url2 = String(args.url || tab.url || "");
    if (!args.name)
      throw new Error("name is required");
    const cookie = await chrome.cookies.set({
      url: url2,
      name: String(args.name),
      value: String(args.value ?? ""),
      domain: args.domain ? String(args.domain) : void 0,
      path: args.path ? String(args.path) : void 0,
      secure: args.secure === void 0 ? void 0 : !!args.secure,
      httpOnly: args.http_only === void 0 ? void 0 : !!args.http_only,
      expirationDate: args.expiration_date ? Number(args.expiration_date) : void 0
    });
    return { success: true, cookie };
  }
  async function toolCookieDelete(args) {
    const tab = await getActiveTab();
    const url2 = String(args.url || tab.url || "");
    if (!args.name)
      throw new Error("name is required");
    const details = await chrome.cookies.remove({ url: url2, name: String(args.name) });
    return { success: true, removed: !!details, details };
  }
  var SESSION_KEY = "_browser_sessions";
  async function readSessions() {
    const r = await chrome.storage.local.get(SESSION_KEY);
    return Array.isArray(r[SESSION_KEY]) ? r[SESSION_KEY] : [];
  }
  async function writeSessions(sessions) {
    await chrome.storage.local.set({ [SESSION_KEY]: sessions });
  }
  async function toolSessionSave(args) {
    const tab = await getActiveTab();
    const id = String(args.id || `session_${Date.now()}`);
    const name = String(args.name || id);
    let local = null;
    let session = null;
    try {
      local = await contentMsg(tab.id, { action: "storage_list", include_values: true, storageType: "local", limit: 500 });
    } catch {
    }
    try {
      session = await contentMsg(tab.id, { action: "storage_list", include_values: true, storageType: "session", limit: 500 });
    } catch {
    }
    const snapshot = { id, name, url: tab.url, title: tab.title, createdAt: Date.now(), storage: { local, session } };
    const sessions = (await readSessions()).filter((s) => s.id !== id);
    sessions.push(snapshot);
    await writeSessions(sessions);
    return { success: true, session: snapshot };
  }
  async function toolSessionList() {
    const sessions = await readSessions();
    return { success: true, count: sessions.length, sessions: sessions.map((s) => ({ id: s.id, name: s.name, url: s.url, title: s.title, createdAt: s.createdAt })) };
  }
  async function toolSessionRestore(args) {
    const sessions = await readSessions();
    const target = sessions.find((s) => s.id === args.id || s.name === args.name);
    if (!target)
      throw new Error("session not found");
    await toolNavigate({ url: target.url, new_tab: !!args.new_tab });
    const tab = await getActiveTab();
    for (const item of target.storage?.local?.items || []) {
      await contentMsg(tab.id, { action: "storage_set", key: item.key, value: item.value, storageType: "local" }).catch(() => {
      });
    }
    for (const item of target.storage?.session?.items || []) {
      await contentMsg(tab.id, { action: "storage_set", key: item.key, value: item.value, storageType: "session" }).catch(() => {
      });
    }
    return { success: true, restored: { id: target.id, name: target.name, url: target.url } };
  }
  async function toolSessionDelete(args) {
    const sessions = await readSessions();
    const kept = sessions.filter((s) => s.id !== args.id && s.name !== args.name);
    await writeSessions(kept);
    return { success: true, deleted: sessions.length - kept.length };
  }
  async function toolProfileInfo() {
    const r = await chrome.storage.local.get("_logical_profile");
    return {
      success: true,
      profile: r._logical_profile || "default",
      scope: "extension-logical-profile",
      warning: "Chrome extensions cannot switch the browser user profile. This is a logical profile marker for extension-side state only."
    };
  }
  async function toolProfileSet(args) {
    const profile = String(args.name || args.profile || "default");
    await chrome.storage.local.set({ _logical_profile: profile });
    return { success: true, profile, scope: "extension-logical-profile" };
  }
  async function toolHover(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "hover", selector: args.selector });
  }
  async function toolPageInfo() {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "page_info" });
  }
  async function toolRightClick(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "right_click", selector: args.selector, text: args.text, x: args.x, y: args.y });
  }
  async function toolDoubleClick(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "double_click", selector: args.selector, text: args.text, x: args.x, y: args.y });
  }
  async function toolDrag(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, {
      action: "drag",
      selector: args.selector,
      text: args.text,
      x: args.x,
      y: args.y,
      toSelector: args.to_selector,
      toText: args.to_text,
      toX: args.to_x,
      toY: args.to_y
    });
  }
  async function toolPressKey(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, {
      action: "press_key",
      key: args.key,
      selector: args.selector,
      ctrl: !!args.ctrl,
      shift: !!args.shift,
      alt: !!args.alt,
      meta: !!args.meta
    });
  }
  function badAction(tool, action, allowed) {
    const got = action === void 0 || action === "" ? "(\u7A7A)" : String(action);
    throw new Error(`${tool}: \u672A\u77E5 action\u300C${got}\u300D\uFF0C\u53EF\u9009 ${allowed.join(" / ")}`);
  }
  function toolTab(args) {
    switch (args?.action) {
      case "list":
        return toolTabList();
      case "open":
        return toolTabOpen(args);
      case "close":
        return toolTabClose(args);
      default:
        return badAction("browser_tab", args?.action, ["list", "open", "close"]);
    }
  }
  function toolHistory(args) {
    switch (args?.action) {
      case "back":
        return toolHistoryBack();
      case "forward":
        return toolHistoryForward();
      default:
        return badAction("browser_history", args?.action, ["back", "forward"]);
    }
  }
  function toolCookie(args) {
    switch (args?.action) {
      case "list":
        return toolCookieList(args);
      case "get":
        return toolCookieGet(args);
      case "set":
        return toolCookieSet(args);
      case "delete":
        return toolCookieDelete(args);
      default:
        return badAction("browser_cookie", args?.action, ["list", "get", "set", "delete"]);
    }
  }
  function toolStorage(args) {
    switch (args?.action) {
      case "get":
        return toolStorageGet(args);
      case "set":
        return toolStorageSet(args);
      case "remove":
        return toolStorageRemove(args);
      case "list":
        return toolStorageList(args);
      default:
        return badAction("browser_storage", args?.action, ["get", "set", "remove", "list"]);
    }
  }
  function toolSession(args) {
    switch (args?.action) {
      case "save":
        return toolSessionSave(args);
      case "list":
        return toolSessionList();
      case "restore":
        return toolSessionRestore(args);
      case "delete":
        return toolSessionDelete(args);
      default:
        return badAction("browser_session", args?.action, ["save", "list", "restore", "delete"]);
    }
  }
  function toolProfile(args) {
    switch (args?.action) {
      case "info":
        return toolProfileInfo();
      case "set":
        return toolProfileSet(args);
      default:
        return badAction("browser_profile", args?.action, ["info", "set"]);
    }
  }
  var HANDLERS = {
    // Navigation & search
    browser_navigate: toolNavigate,
    browser_search: toolSearch,
    browser_history: toolHistory,
    // Page observation
    browser_observe: toolObserve,
    browser_screenshot: toolScreenshot,
    browser_get_content: toolGetContent,
    browser_dom_snapshot: toolDomSnapshot,
    browser_page_info: () => toolPageInfo(),
    browser_find_text: toolFindText,
    browser_find_popups: toolFindPopups,
    browser_performance: () => toolPerformance(),
    browser_network_log: toolNetworkLog,
    browser_iframe_list: () => toolIframeList(),
    // Interaction
    browser_click: toolClick,
    browser_double_click: toolDoubleClick,
    browser_right_click: toolRightClick,
    browser_type: toolType,
    browser_press_key: toolPressKey,
    browser_hover: toolHover,
    browser_scroll: toolScroll,
    browser_wait: toolWait,
    browser_drag: toolDrag,
    browser_fill_form: toolFillForm,
    browser_select: toolSelect,
    browser_close_popup: toolClosePopup,
    // Data & scripting
    browser_evaluate: toolEvaluate,
    browser_extract: toolExtract,
    browser_clipboard_write: toolClipboardWrite,
    browser_file_upload: toolFileUpload,
    browser_download: toolDownload,
    // Browser state (merged action tools)
    browser_tab: toolTab,
    browser_cookie: toolCookie,
    browser_storage: toolStorage,
    browser_session: toolSession,
    browser_profile: toolProfile
  };
  var LEGACY_ALIASES = {
    browser_tab_list: { tool: "browser_tab", action: "list" },
    browser_tab_open: { tool: "browser_tab", action: "open" },
    browser_tab_close: { tool: "browser_tab", action: "close" },
    browser_history_back: { tool: "browser_history", action: "back" },
    browser_history_forward: { tool: "browser_history", action: "forward" },
    browser_cookie_list: { tool: "browser_cookie", action: "list" },
    browser_cookie_get: { tool: "browser_cookie", action: "get" },
    browser_cookie_set: { tool: "browser_cookie", action: "set" },
    browser_cookie_delete: { tool: "browser_cookie", action: "delete" },
    browser_storage_get: { tool: "browser_storage", action: "get" },
    browser_storage_set: { tool: "browser_storage", action: "set" },
    browser_storage_remove: { tool: "browser_storage", action: "remove" },
    browser_storage_list: { tool: "browser_storage", action: "list" },
    browser_session_save: { tool: "browser_session", action: "save" },
    browser_session_list: { tool: "browser_session", action: "list" },
    browser_session_restore: { tool: "browser_session", action: "restore" },
    browser_session_delete: { tool: "browser_session", action: "delete" },
    browser_profile_info: { tool: "browser_profile", action: "info" },
    browser_profile_set: { tool: "browser_profile", action: "set" }
  };
  async function executeBrowserOnly(name, args) {
    try {
      const alias = LEGACY_ALIASES[name];
      if (alias) {
        return await HANDLERS[alias.tool]({ ...args || {}, action: alias.action });
      }
      const handler = HANDLERS[name];
      if (!handler)
        throw new Error(`Unknown browser tool: ${name}`);
      return await handler(args || {});
    } catch (err) {
      if (args?.trace || args?.return_error) {
        return { success: false, error: normalizeToolError(err, name, args) };
      }
      throw err;
    }
  }

  // src/lib/tools/router.ts
  async function executeBrowserTool(name, args) {
    return executeBrowserOnly(name, args);
  }

  // src/lib/ai.ts
  function dataUrlParts(dataUrl) {
    const m = String(dataUrl || "").match(/^data:([^;,]+);base64,(.+)$/);
    if (!m)
      return null;
    return { mediaType: m[1] || "image/png", data: m[2] || "" };
  }
  function anthropicMessages(messages) {
    return messages;
  }
  function stringifyToolContent(content) {
    if (typeof content === "string")
      return content;
    if (Array.isArray(content)) {
      return content.filter((item) => item?.type !== "image").map((item) => item?.type === "text" ? String(item.text || "") : JSON.stringify(item)).filter(Boolean).join("\n");
    }
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }
  function openAiMessages(messages) {
    const out = [];
    for (const msg of messages) {
      if (msg.role === "assistant" && Array.isArray(msg.content) && msg.content.some((b) => b?.type === "tool_use")) {
        const toolCalls = msg.content.filter((b) => b?.type === "tool_use").map((tu) => ({
          id: tu.id,
          type: "function",
          function: {
            name: tu.name,
            arguments: JSON.stringify(tu.input || {})
          }
        }));
        out.push({ role: "assistant", content: null, tool_calls: toolCalls });
        continue;
      }
      if (msg.role === "user" && Array.isArray(msg.content) && msg.content.some((b) => b?.type === "tool_result")) {
        const imageMessages = [];
        for (const tr of msg.content) {
          if (tr?.type !== "tool_result")
            continue;
          const content = tr.content;
          out.push({
            role: "tool",
            tool_call_id: tr.tool_use_id || "call_0",
            content: stringifyToolContent(content)
          });
          const blocks = Array.isArray(content) ? content : [];
          const image = blocks.find((b) => b?.type === "image");
          if (image?.source?.type === "base64" && image.source.data) {
            const mediaType = image.source.media_type || "image/png";
            const dataUrl = `data:${mediaType};base64,${image.source.data}`;
            const text = blocks.find((b) => b?.type === "text")?.text || "Screenshot captured by browser_screenshot.";
            imageMessages.push({
              role: "user",
              content: [
                { type: "text", text },
                { type: "image_url", image_url: { url: dataUrl } }
              ]
            });
          }
        }
        out.push(...imageMessages);
        continue;
      }
      if (msg.role === "user" && Array.isArray(msg.content)) {
        const parts2 = [];
        for (const item of msg.content) {
          if (item?.type === "text")
            parts2.push({ type: "text", text: String(item.text || "") });
          else if (item?.type === "image" && item.source?.type === "base64") {
            const dataUrl = `data:${item.source.media_type || "image/png"};base64,${item.source.data || ""}`;
            parts2.push({ type: "image_url", image_url: { url: dataUrl } });
          } else if (item?.type === "image_url") {
            parts2.push(item);
          }
        }
        out.push({ role: msg.role, content: parts2.length ? parts2 : stringifyToolContent(msg.content) });
        continue;
      }
      out.push({ role: msg.role, content: typeof msg.content === "string" ? msg.content : stringifyToolContent(msg.content) });
    }
    return out;
  }
  function screenshotToolContent(result) {
    const parsed = dataUrlParts(result?.dataUrl || "");
    if (!parsed)
      return typeof result === "string" ? result : JSON.stringify(result);
    return [
      { type: "image", source: { type: "base64", media_type: parsed.mediaType, data: parsed.data } },
      { type: "text", text: `Screenshot of: ${result.url || "current page"}
Method: ${result.method || "browser_screenshot"}` }
    ];
  }
  async function callAI(baseUrl, apiKey, model, messages, tools, systemPrompt) {
    if (!apiKey)
      throw new Error("AI Key is not configured");
    const isAnthropic = baseUrl.includes("anthropic.com");
    const endpoint = isAnthropic ? `${baseUrl.replace(/\/$/, "")}/v1/messages` : `${baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
    const headers = { "Content-Type": "application/json" };
    if (isAnthropic) {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
      headers["anthropic-dangerous-direct-browser-access"] = "true";
    } else {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    let body;
    if (isAnthropic) {
      body = { model, max_tokens: 4096, messages: anthropicMessages(messages) };
      if (tools?.length)
        body.tools = tools;
      if (systemPrompt)
        body.system = systemPrompt;
    } else {
      const oaMessages = systemPrompt ? [{ role: "system", content: systemPrompt }, ...openAiMessages(messages)] : openAiMessages(messages);
      body = { model, max_tokens: 4096, messages: oaMessages };
      if (tools?.length) {
        body.tools = tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.input_schema }
        }));
      }
    }
    const res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok)
      throw new Error(data?.error?.message || `AI API error ${res.status}`);
    if (isAnthropic) {
      const textBlock = data.content?.find((b) => b.type === "text");
      const toolUseBlocks = (data.content || []).filter((b) => b.type === "tool_use");
      return {
        text: textBlock?.text,
        toolUses: toolUseBlocks.length ? toolUseBlocks : void 0,
        stopReason: data.stop_reason
      };
    } else {
      const choice = data.choices?.[0];
      if (choice?.message?.tool_calls?.length) {
        const toolUses = choice.message.tool_calls.map((tc) => ({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: (() => {
            try {
              return JSON.parse(tc.function.arguments || "{}");
            } catch {
              return {};
            }
          })()
        }));
        return { toolUses, stopReason: choice.finish_reason };
      }
      return { text: choice?.message?.content || "", stopReason: choice?.finish_reason };
    }
  }

  // src/lib/tools/executor.ts
  function inferTool(instruction) {
    const t = instruction.toLowerCase();
    if (/截图|screenshot/.test(t))
      return "browser_screenshot";
    if (/观察|可点击|可交互|元素列表|observe/.test(t))
      return "browser_observe";
    if (/弹窗|关闭弹窗|popup|modal|dialog/.test(t))
      return "browser_close_popup";
    if (/搜索|search|查找|找/.test(t))
      return "browser_search";
    if (/点击|click/.test(t))
      return "browser_click";
    if (/输入|type|填写/.test(t))
      return "browser_type";
    if (/导航|打开|访问|navigate|open|go to|前往/.test(t))
      return "browser_navigate";
    if (/滚动|scroll/.test(t))
      return "browser_scroll";
    if (/提取|extract|抓取/.test(t))
      return "browser_extract";
    if (/标签|tab/.test(t))
      return "browser_tab";
    if (/内容|content|页面文本/.test(t))
      return "browser_get_content";
    return "browser_get_content";
  }
  var SYSTEM_PROMPT = `You are HeySure AI, a browser automation assistant running as a Chrome extension.
You act like a human looking at the page: you only see and interact with what is visible on top \u2014 not hidden or background DOM.

Core interaction loop (prefer this for any click/type):
1. Navigate to the relevant URL or search for it
2. Call browser_observe to list the top-most, un-occluded interactive elements. Each gets a numbered id and a drawn mark; call browser_screenshot to see those marks if you need the visual.
3. Act by id: browser_click {ref:id}, then browser_type for inputs. Using ref is far more reliable than guessing selectors or coordinates.
4. Re-run browser_observe after anything changes the page (scroll, navigation, opening a menu/popup) to refresh the ids.

Handling obstacles:
- If browser_click returns occluded:true, a popup/overlay/ad is covering the target. Use browser_find_popups + browser_close_popup to clear it, then observe again. Only use force:true to click through deliberately.
- If it returns not_visible:true, the element isn't on screen \u2014 scroll or expand its container first, then observe again.

Always:
- Read browser_get_content for page text; after scrolling, read the returned position (scrollY, percent, atTop/atBottom, section) so you know where you landed.
- Be methodical and verify each step.
- Respond in the same language as the user's message.
- Summarize what you accomplished at the end.`;
  async function executeTask(task, settings) {
    const toolName = task.tool || inferTool(task.instruction || "");
    const args = task.args || {};
    if (toolName && toolName !== "ai_agent" && !toolName.startsWith("ai.")) {
      if (!task.tool && task.instruction && Object.keys(args).length === 0) {
        if (toolName === "browser_search")
          args.query = task.instruction;
        else if (toolName === "browser_navigate")
          args.url = task.instruction;
        else if (toolName === "browser_tab")
          args.action = "list";
      }
      try {
        const result = await executeBrowserTool(toolName, args);
        return { success: true, tool: toolName, result, summary: `${toolName} completed` };
      } catch (err) {
        return { success: false, tool: toolName, result: null, summary: err.message };
      }
    }
    if (!settings.aiKey) {
      return { success: false, tool: "ai_agent", result: null, summary: "AI Key not configured" };
    }
    const messages = [{
      role: "user",
      content: task.instruction || JSON.stringify(task.args) || "Complete the task"
    }];
    const toolsUsed = [];
    let iterations = 0;
    const MAX_ITER = 12;
    try {
      while (iterations < MAX_ITER) {
        const resp = await callAI(settings.aiBaseUrl, settings.aiKey, settings.aiModel, messages, BROWSER_TOOLS, SYSTEM_PROMPT);
        if (!resp.toolUses?.length) {
          return {
            success: true,
            tool: "ai_agent",
            result: { text: resp.text, toolsUsed },
            summary: resp.text?.slice(0, 200) || "Done"
          };
        }
        messages.push({ role: "assistant", content: resp.toolUses });
        const toolResults = [];
        for (const tu of resp.toolUses) {
          toolsUsed.push(tu.name);
          try {
            const toolResult = await executeBrowserTool(tu.name, tu.input);
            let content = typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult);
            if (tu.name === "browser_screenshot" && toolResult?.dataUrl) {
              content = screenshotToolContent(toolResult);
            }
            toolResults.push({ type: "tool_result", tool_use_id: tu.id, content });
          } catch (err) {
            toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: `Error: ${err.message}`, is_error: true });
          }
        }
        messages.push({ role: "user", content: toolResults });
        iterations++;
      }
      return { success: false, tool: "ai_agent", result: { toolsUsed }, summary: "Max iterations reached" };
    } catch (err) {
      return { success: false, tool: "ai_agent", result: null, summary: err.message };
    }
  }

  // src/lib/tools/overrides.ts
  async function resolveToolEnabledMap() {
    const explicit = await getToolEnabledMap();
    const out = {};
    for (const tool of BROWSER_TOOLS) {
      out[tool.name] = tool.name in explicit ? !!explicit[tool.name] : isToolEnabledByDefault(tool.name);
    }
    return out;
  }
  async function effectiveToolDefs() {
    const overrides = await getToolDescOverrides();
    const enabled = await resolveToolEnabledMap();
    return BROWSER_TOOLS.filter((tool) => enabled[tool.name]).map((tool) => {
      const o = overrides[tool.name];
      if (!o)
        return tool;
      const desc = (o.description || "").trim();
      const props = tool.input_schema?.properties || {};
      let nextProps = props;
      if (o.parameters && Object.keys(o.parameters).length) {
        nextProps = {};
        for (const [k, v] of Object.entries(props)) {
          const pd = (o.parameters[k] || "").trim();
          nextProps[k] = pd ? { ...v, description: pd } : v;
        }
      }
      return {
        ...tool,
        description: desc || tool.description,
        input_schema: { ...tool.input_schema, properties: nextProps }
      };
    });
  }

  // src/background.ts
  var socket = null;
  var currentStatus = "disconnected";
  var taskOutcomes = /* @__PURE__ */ new Map();
  var popupPorts = /* @__PURE__ */ new Set();
  var offlineChatControllers = /* @__PURE__ */ new Map();
  var _machineId = null;
  var currentAgentId = null;
  var connecting = false;
  var activeSocketUrl = null;
  var authRejected = false;
  async function withTaskTimeout(promise, ms, label) {
    let timer = null;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        })
      ]);
    } finally {
      if (timer)
        clearTimeout(timer);
    }
  }
  function taskTimeoutMs(task) {
    const fromArgs = Number(task.args?.task_timeout_ms || task.args?.timeout_seconds && Number(task.args.timeout_seconds) * 1e3);
    if (Number.isFinite(fromArgs) && fromArgs > 0)
      return Math.min(11e4, Math.max(5e3, Math.round(fromArgs)));
    if (task.tool === "browser_screenshot")
      return 35e3;
    return 9e4;
  }
  function mkEntry(type, status, message, data) {
    return { id: Math.random().toString(36).slice(2), type, status, message, data, timestamp: Date.now() };
  }
  function log(type, status, message, data) {
    const entry = mkEntry(type, status, message, data);
    void pushActivity(entry);
    broadcast({ type: "activity:log", entry });
  }
  function refreshPopupStatus() {
    broadcast({ type: "agent:status", status: currentStatus, aiConfigId: boundAiConfigId });
  }
  var boundAiConfigId = null;
  function setStatus(status, reason) {
    currentStatus = status;
    if (status !== "registered" && status !== "connected")
      boundAiConfigId = null;
    broadcast({ type: "agent:status", status, reason, aiConfigId: boundAiConfigId });
    const colors = {
      disconnected: "#787878",
      connecting: "#f59e0b",
      connected: "#6366f1",
      registered: "#22c55e",
      error: "#ef4444"
    };
    chrome.action.setBadgeBackgroundColor({ color: colors[status] });
    chrome.action.setBadgeText({ text: status === "registered" ? "\u25CF" : status === "error" ? "!" : "" });
    chrome.action.setTitle({ title: `HeySure Agent \u2014 ${status}` });
  }
  function postToPopup(port, msg) {
    try {
      port.postMessage(msg);
      return true;
    } catch {
      popupPorts.delete(port);
      return false;
    }
  }
  function broadcast(msg) {
    popupPorts.forEach((port) => {
      postToPopup(port, msg);
    });
  }
  async function getMachineId() {
    if (_machineId)
      return _machineId;
    const r = await chrome.storage.local.get("_mid");
    if (r._mid) {
      _machineId = r._mid;
      return _machineId;
    }
    const id = "br-" + Math.random().toString(36).slice(2, 10);
    await chrome.storage.local.set({ _mid: id });
    _machineId = id;
    return id;
  }
  function buildAgentCandidates(serverUrl, override, cached) {
    const list = [];
    const push = (raw) => {
      const trimmed = String(raw || "").trim();
      if (!trimmed)
        return;
      try {
        const u = new URL(trimmed);
        const href = u.href.replace(/\/+$/, "");
        if (!list.includes(href))
          list.push(href);
      } catch {
      }
    };
    if (override.trim()) {
      push(override);
      return list;
    }
    push(cached);
    push(serverUrl);
    try {
      const base = new URL(serverUrl);
      for (const port of ["3002", "3001"]) {
        const alt = new URL(base.href);
        alt.port = port;
        push(alt.href);
      }
    } catch {
    }
    return list;
  }
  function parseAiConfigId(raw) {
    const n = typeof raw === "number" ? raw : raw != null && String(raw).trim() !== "" ? Number(raw) : null;
    return Number.isFinite(n) ? n : null;
  }
  function probeRegister(url2, timeoutMs) {
    return new Promise((resolve) => {
      const probe = lookup2(url2, {
        transports: ["websocket"],
        reconnection: false,
        timeout: timeoutMs,
        forceNew: true,
        autoConnect: true
      });
      let settled = false;
      const settle = (outcome) => {
        if (settled)
          return;
        settled = true;
        clearTimeout(timer);
        if (outcome.kind === "registered") {
          resolve(outcome);
        } else {
          try {
            probe.removeAllListeners();
            probe.disconnect();
          } catch {
          }
          resolve(outcome);
        }
      };
      const timer = setTimeout(() => settle({ kind: "failed", reason: "\u6CE8\u518C\u8D85\u65F6\uFF08\u65E0\u54CD\u5E94\uFF09" }), timeoutMs);
      probe.on("connect", () => {
        void emitRegisterOn(probe);
      });
      probe.on("connect_error", (err) => settle({ kind: "failed", reason: err?.message || "connect_error" }));
      probe.on("disconnect", (reason) => settle({ kind: "failed", reason: `disconnected: ${reason}` }));
      probe.on("agent:registered", (data) => settle({ kind: "registered", socket: probe, aiConfigId: parseAiConfigId(data?.aiConfigId) }));
      probe.on("agent:register_rejected", (data) => settle({ kind: "rejected", reason: data?.reason || "\u6CE8\u518C\u88AB\u670D\u52A1\u5668\u62D2\u7EDD" }));
    });
  }
  async function emitRegisterOn(s) {
    const settings = await getSettings();
    const auth = await getAuth();
    if (settings.offlineMode)
      return;
    const id = settings.agentId || await getMachineId();
    currentAgentId = id;
    const toolDefs = await effectiveToolDefs();
    s.emit("agent:register", {
      id,
      aiConfigId: null,
      name: settings.agentName || "Browser Agent",
      group: settings.agentGroup || "",
      platform: `browser-extension (${navigator?.userAgent?.split(" ").pop() || "chrome"})`,
      os: { platform: "browser", arch: "unknown", release: "1.0", hostname: id },
      capabilities: toolDefs.map((t) => t.name),
      // Full self-described tool schemas (with the user's local description edits
      // merged in). The server stores these and surfaces them in mcp.list_tools /
      // describe_tool instead of hardcoding browser tool schemas, so a tool added
      // here — or a description edited in the popup — needs no server change.
      toolDefs,
      version: "1.0.0",
      token: auth.token || settings.agentToken || "",
      userId: auth.userId ?? null,
      workspaceRoot: "",
      lifecycle: "registered",
      isWindowsDesktop: false,
      isBrowserExtension: true
    });
  }
  async function connect() {
    const settings = await getSettings();
    if (socket?.connected || connecting)
      return;
    if (settings.offlineMode) {
      log("system", "info", "\u79BB\u7EBF\u6A21\u5F0F\u5DF2\u5F00\u542F\uFF0C\u8DF3\u8FC7\u670D\u52A1\u5668\u8FDE\u63A5");
      return;
    }
    const auth = await getAuth();
    if (!auth.token) {
      setStatus("disconnected");
      log("system", "warn", "\u672A\u767B\u5F55\uFF0C\u5DF2\u963B\u6B62\u8FDE\u63A5\u670D\u52A1\u5668\uFF08\u8BF7\u5148\u767B\u5F55\u8D26\u53F7\uFF09");
      return;
    }
    try {
      new URL(settings.serverUrl);
    } catch {
      log("system", "error", "\u670D\u52A1\u5668 URL \u683C\u5F0F\u65E0\u6548");
      return;
    }
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
      activeSocketUrl = null;
    }
    const candidates = buildAgentCandidates(
      settings.serverUrl,
      settings.agentServerUrl || "",
      settings.lastWorkingAgentUrl || ""
    );
    if (!candidates.length) {
      log("system", "error", "\u6CA1\u6709\u53EF\u7528\u7684 Agent \u670D\u52A1\u5668\u5730\u5740");
      return;
    }
    authRejected = false;
    connecting = true;
    setStatus("connecting");
    try {
      let winner = null;
      let winnerUrl = "";
      let winnerAiConfigId = null;
      let rejected = null;
      const failures = [];
      for (const candidate of candidates) {
        log("system", "info", `\u63A2\u6D4B Agent \u670D\u52A1\u5668: ${candidate}`);
        const outcome = await probeRegister(candidate, 6e3);
        if (outcome.kind === "registered" && outcome.socket) {
          winner = outcome.socket;
          winnerUrl = candidate;
          winnerAiConfigId = outcome.aiConfigId ?? null;
          break;
        }
        if (outcome.kind === "rejected") {
          rejected = outcome.reason || "\u6CE8\u518C\u88AB\u670D\u52A1\u5668\u62D2\u7EDD";
          break;
        }
        failures.push({ url: candidate, reason: outcome.reason || "\u672A\u77E5\u5931\u8D25" });
      }
      if (rejected) {
        setStatus("error", rejected);
        log("system", "error", `\u6CE8\u518C\u88AB\u62D2\u7EDD: ${rejected}`);
        return;
      }
      if (!winner) {
        setStatus("error", "\u65E0\u6CD5\u8FDE\u63A5\u5230 Agent \u670D\u52A1\u5668");
        log(
          "system",
          "error",
          `\u65E0\u6CD5\u8FDE\u63A5\u5230 Agent \u670D\u52A1\u5668\uFF0C\u5C1D\u8BD5\u8FC7\uFF1A
${failures.map((f) => `\xB7 ${f.url} \u2014 ${f.reason}`).join("\n")}
\u8BF7\u68C0\u67E5\u670D\u52A1\u5668\u662F\u5426\u542F\u52A8\uFF1B\u5982\u670D\u52A1\u7AEF\u62C6\u5206\u90E8\u7F72\uFF0C\u8BF7\u5728\u8BBE\u7F6E\u4E2D\u586B\u5199 Agent \u670D\u52A1\u5668 URL\uFF08\u5982 http://your-host:3002\uFF09\u3002`,
          failures
        );
        return;
      }
      winner.removeAllListeners();
      socket = winner;
      activeSocketUrl = winnerUrl;
      boundAiConfigId = winnerAiConfigId;
      setStatus("registered");
      log("system", "success", `\u5DF2\u8FDE\u63A5\u5E76\u6CE8\u518C\u5230 ${winnerUrl}`);
      if (settings.lastWorkingAgentUrl !== winnerUrl) {
        await saveSettings({ lastWorkingAgentUrl: winnerUrl });
      }
      attachOperationalListeners(socket, settings.agentName || "Browser Agent");
    } finally {
      connecting = false;
    }
  }
  function attachOperationalListeners(s, agentName) {
    s.io.reconnection(true);
    s.io.reconnectionDelay(2e3);
    s.io.reconnectionAttempts(Infinity);
    s.on("connect", async () => {
      setStatus("connected");
      log("system", "info", "\u5DF2\u8FDE\u63A5\u5230\u670D\u52A1\u5668");
      await register();
    });
    s.on("disconnect", (reason) => {
      setStatus("disconnected", reason);
      log("system", "warn", `\u8FDE\u63A5\u65AD\u5F00: ${reason}`);
    });
    s.on("connect_error", (err) => {
      setStatus("error", err.message);
      log("system", "error", `\u8FDE\u63A5\u5931\u8D25: ${err.message}`);
    });
    s.on("agent:registered", (data) => {
      const raw = data?.aiConfigId;
      const parsed = typeof raw === "number" ? raw : raw != null && String(raw).trim() !== "" ? Number(raw) : null;
      boundAiConfigId = Number.isFinite(parsed) ? parsed : null;
      setStatus("registered");
      log("system", "success", `\u5DF2\u6CE8\u518C: ${data?.name || agentName}${boundAiConfigId == null ? "\uFF08\u672A\u5206\u914D AI\uFF09" : ""}`);
    });
    s.on("agent:list", (rows) => {
      if (!currentAgentId || !Array.isArray(rows))
        return;
      const mine = rows.find((row) => String(row?.id || "") === currentAgentId);
      if (!mine)
        return;
      const raw = mine?.aiConfigId ?? mine?.ai_config_id;
      const parsed = typeof raw === "number" ? raw : raw != null && String(raw).trim() !== "" ? Number(raw) : null;
      const nextAiConfigId = Number.isFinite(parsed) ? parsed : null;
      if (nextAiConfigId !== boundAiConfigId) {
        boundAiConfigId = nextAiConfigId;
        refreshPopupStatus();
        log("system", "info", `AI \u7ED1\u5B9A\u5DF2\u66F4\u65B0: ${boundAiConfigId == null ? "\u672A\u5206\u914D" : `#${boundAiConfigId}`}`);
      }
    });
    s.on("agent:register_rejected", (data) => {
      const reason = data?.reason || "\u6CE8\u518C\u88AB\u670D\u52A1\u5668\u62D2\u7EDD";
      authRejected = true;
      try {
        s.io.reconnection(false);
      } catch {
      }
      disconnect();
      setStatus("error", reason);
      log("system", "error", `\u6CE8\u518C\u88AB\u62D2\u7EDD\uFF0C\u5DF2\u505C\u6B62\u81EA\u52A8\u91CD\u8FDE\uFF08\u8BF7\u91CD\u65B0\u767B\u5F55\u540E\u518D\u8FDE\u63A5\uFF09: ${reason}`);
    });
    s.on("task:dispatch", (task) => {
      void handleTask(task);
    });
  }
  async function register() {
    const settings = await getSettings();
    if (settings.offlineMode) {
      log("system", "info", "\u79BB\u7EBF\u6A21\u5F0F\u5DF2\u5F00\u542F\uFF0C\u8DF3\u8FC7\u6CE8\u518C");
      return;
    }
    if (!socket)
      return;
    log("system", "info", "\u6CE8\u518C agent\uFF08AI \u7531\u670D\u52A1\u5668\u4F5C\u574A\u5206\u914D\uFF09");
    await emitRegisterOn(socket);
  }
  function disconnect() {
    socket?.disconnect();
    socket = null;
    activeSocketUrl = null;
    setStatus("disconnected");
  }
  async function restoreAndConnectOnStartup() {
    const s = await getSettings();
    const auth = await getAuth();
    if (!s.offlineMode && auth.token)
      await connect();
  }
  async function handleTask(task) {
    const taskId = task.taskId;
    if (!taskId)
      return;
    const cached = taskOutcomes.get(taskId);
    if (cached) {
      if (cached.kind === "result")
        socket?.emit("task:result", cached.payload);
      else if (cached.kind === "error")
        socket?.emit("task:error", { taskId, error: cached.error });
      return;
    }
    taskOutcomes.set(taskId, { kind: "running" });
    const tool = task.tool || "(infer)";
    log("task", "running", `[\u5DE5\u5177] ${tool}`, task.args);
    broadcast({ type: "task:start", data: { taskId, tool, args: task.args, timestamp: Date.now() } });
    socket?.emit("task:progress", { taskId, progress: 0, message: `\u6267\u884C ${tool}...` });
    try {
      const settings = await getSettings();
      const timeoutMs = taskTimeoutMs(task);
      const outcome = await withTaskTimeout(executeTask(task, settings), timeoutMs, `Endpoint task ${tool}`);
      const payload = {
        taskId,
        userId: task.userId,
        aiConfigId: task.aiConfigId,
        sessionId: task.sessionId,
        tool: outcome.tool,
        success: outcome.success,
        result: outcome.result,
        summary: outcome.summary
      };
      taskOutcomes.set(taskId, { kind: "result", payload });
      socket?.emit("task:result", payload);
      log("task", outcome.success ? "success" : "error", `${outcome.success ? "\u5B8C\u6210" : "\u5931\u8D25"}: ${outcome.tool}`, outcome.result);
      broadcast({ type: "task:result", data: { taskId, tool: outcome.tool, result: outcome.result, success: outcome.success, timestamp: Date.now() } });
    } catch (err) {
      const errMsg = err?.message || String(err);
      taskOutcomes.set(taskId, { kind: "error", error: errMsg });
      socket?.emit("task:error", { taskId, userId: task.userId, error: errMsg });
      log("task", "error", `\u5F02\u5E38: ${tool} \u2014 ${errMsg}`);
      broadcast({ type: "task:result", data: { taskId, tool, result: null, success: false, timestamp: Date.now() } });
    }
  }
  async function testConnection() {
    const settings = await getSettings();
    if (!settings.serverUrl)
      return { success: false, error: "\u672A\u914D\u7F6E\u670D\u52A1\u5668 URL" };
    let url2;
    try {
      url2 = new URL(settings.serverUrl);
    } catch {
      return { success: false, error: "URL \u683C\u5F0F\u65E0\u6548" };
    }
    const base = url2.href.replace(/\/$/, "");
    let httpResult = null;
    try {
      const start = Date.now();
      const res = await fetch(`${base}/`, { signal: AbortSignal.timeout(5e3) }).catch(() => fetch(base, { signal: AbortSignal.timeout(5e3) }));
      httpResult = { success: true, status: res.status, ms: Date.now() - start };
    } catch (err) {
      httpResult = { success: false, error: err.message };
    }
    const candidates = buildAgentCandidates(
      settings.serverUrl,
      settings.agentServerUrl || "",
      settings.lastWorkingAgentUrl || ""
    );
    const auth = await getAuth();
    const agentProbes = [];
    let agentOkUrl = "";
    if (auth.token) {
      for (const candidate of candidates) {
        const outcome = await probeRegister(candidate, 5e3);
        if (outcome.kind === "registered") {
          agentProbes.push({ url: candidate, ok: true });
          agentOkUrl = candidate;
          try {
            outcome.socket?.removeAllListeners();
            outcome.socket?.disconnect();
          } catch {
          }
          break;
        }
        agentProbes.push({ url: candidate, ok: false, reason: outcome.reason });
        if (outcome.kind === "rejected")
          break;
      }
    }
    return {
      success: httpResult.success,
      http: httpResult,
      agentProbes,
      agentOkUrl,
      needsLogin: !auth.token
    };
  }
  var CHAT_SYSTEM = `You are HeySure AI, a browser automation assistant running as a Chrome extension.
You can navigate pages, click, double-click, right-click, type, drag, press keys, scroll, take
screenshots, search the web, detect and close popups/modals/dialogs, extract data, and more.

Use browser_page_info to know where you are on the page (scroll position, current section,
visible headings); after scrolling, read the returned position so you know where you landed and
what changed.

If a popup/modal/dialog blocks the page, call browser_find_popups to inspect detected dialogs and
browser_close_popup to close the matching one before continuing.

When asked to complete tasks, use the available tools systematically and summarize what you did.
Respond in the same language as the user. For factual questions, search the web if needed.`;
  async function runChat(messages) {
    const settings = await getSettings();
    if (!settings.aiKey)
      throw new Error("\u672A\u914D\u7F6E AI Key");
    const toolsUsed = [];
    const toolEvents = [];
    let iter = 0;
    const MAX = 12;
    const chatTools = await effectiveToolDefs();
    while (iter < MAX) {
      const resp = await callAI(settings.aiBaseUrl, settings.aiKey, settings.aiModel, messages, chatTools, CHAT_SYSTEM);
      if (!resp.toolUses?.length) {
        return { text: resp.text || "\u5B8C\u6210", toolsUsed, toolEvents };
      }
      messages.push({ role: "assistant", content: resp.toolUses });
      const toolResults = [];
      for (const tu of resp.toolUses) {
        toolsUsed.push(tu.name);
        log("task", "running", `[AI\u5DE5\u5177] ${tu.name}`, tu.input);
        try {
          const result = await executeBrowserTool(tu.name, tu.input);
          let content = typeof result === "string" ? result : JSON.stringify(result);
          if (tu.name === "browser_screenshot" && result?.dataUrl) {
            content = screenshotToolContent(result);
            toolEvents.push({
              key: `${tu.id || tu.name}:${toolEvents.length}`,
              label: "\u6D4F\u89C8\u5668\u622A\u56FE",
              detail: [result.url, result.method].filter(Boolean).join("\n"),
              imageUrl: result.dataUrl
            });
          }
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content });
          log("task", "success", `\u5B8C\u6210: ${tu.name}`);
        } catch (err) {
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: `Error: ${err.message}`, is_error: true });
          log("task", "error", `\u5931\u8D25: ${tu.name} \u2014 ${err.message}`);
        }
      }
      messages.push({ role: "user", content: toolResults });
      iter++;
    }
    return { text: "\u5DF2\u8FBE\u5230\u6700\u5927\u8FED\u4EE3\u6B21\u6570", toolsUsed, toolEvents };
  }
  function estimateTokensFromMessages(messages, text = "") {
    const raw = messages.map((m) => typeof m.content === "string" ? m.content : JSON.stringify(m.content)).join("\n") + text;
    const total = Math.max(1, Math.ceil(raw.length / 4));
    return { inputTokens: total, outputTokens: Math.max(1, Math.ceil(String(text || "").length / 4)), totalTokens: total, estimated: true };
  }
  function summarizeToolResult(result, success) {
    if (!success)
      return typeof result === "string" ? result : "\u6267\u884C\u5931\u8D25";
    if (result?.summary)
      return String(result.summary);
    if (result?.success === false && result?.error)
      return String(result.error);
    if (typeof result === "string")
      return result.slice(0, 160);
    return "\u6267\u884C\u5B8C\u6210";
  }
  function resultForModel(tool, result) {
    if (tool === "browser_screenshot" && result?.dataUrl)
      return screenshotToolContent(result);
    return typeof result === "string" ? result : JSON.stringify(result);
  }
  async function runOfflineChat(port, requestId, messages, prompt, allowedTools) {
    const settings = await getSettings();
    if (!settings.aiKey)
      throw new Error("\u672A\u914D\u7F6E AI Key");
    if (!settings.aiBaseUrl)
      throw new Error("\u672A\u914D\u7F6E Base URL");
    if (!settings.aiModel)
      throw new Error("\u672A\u914D\u7F6E\u6A21\u578B");
    const controller = { canceled: false };
    offlineChatControllers.set(requestId, controller);
    const allowed = new Set((allowedTools || []).map((t) => String(t || "").trim()).filter(Boolean));
    const allTools = await effectiveToolDefs();
    const chatTools = Array.isArray(allowedTools) ? allTools.filter((t) => allowed.has(t.name)) : allTools;
    const systemPrompt = String(prompt || settings.offlinePrompt || "").trim();
    const toolsUsed = [];
    const toolEvents = [];
    const workingMessages = messages.map((m) => ({ ...m }));
    const MAX = 12;
    try {
      for (let iter = 0; iter < MAX; iter++) {
        if (controller.canceled)
          throw new DOMException("\u5DF2\u505C\u6B62", "AbortError");
        const resp = await callAI(settings.aiBaseUrl, settings.aiKey, settings.aiModel, workingMessages, chatTools, systemPrompt);
        if (controller.canceled)
          throw new DOMException("\u5DF2\u505C\u6B62", "AbortError");
        if (!resp.toolUses?.length) {
          const text = resp.text || "\u5B8C\u6210";
          return { text, toolsUsed, toolEvents, usage: estimateTokensFromMessages(workingMessages, text) };
        }
        workingMessages.push({ role: "assistant", content: resp.toolUses });
        const toolResults = [];
        for (const tu of resp.toolUses) {
          if (controller.canceled)
            throw new DOMException("\u5DF2\u505C\u6B62", "AbortError");
          const args = tu.input || {};
          toolsUsed.push(tu.name);
          postToPopup(port, { type: "offline-chat:progress", requestId, event: { type: "tool_start", tool: tu.name, arguments: args } });
          log("task", "running", `[\u672C\u5730\u5BF9\u8BDD\u5DE5\u5177] ${tu.name}`, args);
          try {
            const result = await withTaskTimeout(
              executeBrowserTool(tu.name, args),
              taskTimeoutMs({ taskId: requestId, tool: tu.name, args }),
              `offline-chat ${tu.name}`
            );
            if (controller.canceled)
              throw new DOMException("\u5DF2\u505C\u6B62", "AbortError");
            const event = {
              tool: tu.name,
              arguments: args,
              success: true,
              result,
              summary: summarizeToolResult(result, true)
            };
            toolEvents.push(event);
            postToPopup(port, { type: "offline-chat:progress", requestId, event: { type: "tool_result", event } });
            toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: resultForModel(tu.name, result) });
            log("task", "success", `\u672C\u5730\u5BF9\u8BDD\u5B8C\u6210: ${tu.name}`);
          } catch (err) {
            const message = err?.message || String(err);
            const event = {
              tool: tu.name,
              arguments: args,
              success: false,
              result: null,
              summary: message
            };
            toolEvents.push(event);
            postToPopup(port, { type: "offline-chat:progress", requestId, event: { type: "tool_result", event } });
            toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: `Error: ${message}`, is_error: true });
            log("task", "error", `\u672C\u5730\u5BF9\u8BDD\u5931\u8D25: ${tu.name} \u2014 ${message}`);
          }
        }
        workingMessages.push({ role: "user", content: toolResults });
      }
      return { text: "\u5DF2\u8FBE\u5230\u6700\u5927\u8FED\u4EE3\u6B21\u6570", toolsUsed, toolEvents, usage: estimateTokensFromMessages(workingMessages, "\u5DF2\u8FBE\u5230\u6700\u5927\u8FED\u4EE3\u6B21\u6570") };
    } finally {
      offlineChatControllers.delete(requestId);
    }
  }
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "popup" && port.name !== "offline-chat")
      return;
    popupPorts.add(port);
    postToPopup(port, { type: "agent:status", status: currentStatus, aiConfigId: boundAiConfigId });
    getActivity().then((entries) => {
      entries.forEach((e) => postToPopup(port, { type: "activity:log", entry: e }));
    });
    port.onDisconnect.addListener(() => popupPorts.delete(port));
    port.onMessage.addListener(async (msg) => {
      switch (msg.type) {
        case "agent:connect": {
          await connect();
          break;
        }
        case "agent:disconnect": {
          disconnect();
          break;
        }
        case "auth:logout": {
          authRejected = false;
          disconnect();
          await saveSettings({ selectedAiConfigId: null, lastWorkingAgentUrl: "" });
          break;
        }
        case "settings:get": {
          const settings = await getSettings();
          postToPopup(port, { type: "settings:data", settings });
          break;
        }
        case "settings:save": {
          const prev = await getSettings();
          const payload = { ...msg.payload };
          const serverUrlChanged = payload.serverUrl !== void 0 && payload.serverUrl !== prev.serverUrl;
          const agentUrlChanged = payload.agentServerUrl !== void 0 && payload.agentServerUrl !== prev.agentServerUrl;
          if ((serverUrlChanged || agentUrlChanged) && payload.lastWorkingAgentUrl === void 0) {
            payload.lastWorkingAgentUrl = "";
          }
          await saveSettings(payload);
          if (payload.offlineMode === true && socket?.connected) {
            disconnect();
          }
          if ((serverUrlChanged || agentUrlChanged) && socket) {
            const wasConnected = !!socket;
            disconnect();
            if (wasConnected && !payload.offlineMode) {
              void connect();
            }
          }
          break;
        }
        case "chat:send": {
          const requestId = msg.requestId;
          try {
            const result = await runChat(msg.messages);
            postToPopup(port, { type: "chat:response", text: result.text, toolsUsed: result.toolsUsed, toolEvents: result.toolEvents, requestId });
          } catch (err) {
            postToPopup(port, { type: "chat:error", error: err.message, requestId });
          }
          break;
        }
        case "connection:test": {
          const result = await testConnection();
          postToPopup(port, { type: "connection:result", result });
          break;
        }
        case "mcp:test": {
          log("task", "running", `\u6D4B\u8BD5: ${msg.tool}`, msg.args);
          try {
            const result = await withTaskTimeout(
              executeBrowserTool(msg.tool, msg.args || {}),
              taskTimeoutMs({ taskId: "mcp-test", tool: msg.tool, args: msg.args }),
              `mcp.test ${msg.tool}`
            );
            log("task", "success", `\u6D4B\u8BD5\u5B8C\u6210: ${msg.tool}`);
            postToPopup(port, { type: "mcp:test:result", requestId: msg.requestId, ok: true, result });
          } catch (err) {
            log("task", "error", `\u6D4B\u8BD5\u5931\u8D25: ${msg.tool} \u2014 ${err?.message || err}`);
            postToPopup(port, { type: "mcp:test:result", requestId: msg.requestId, ok: false, error: err?.message || String(err) });
          }
          break;
        }
        case "offline-chat:get-config": {
          const settings = await getSettings();
          postToPopup(port, { type: "offline-chat:config", requestId: msg.requestId, settings, hasAiKey: !!settings.aiKey?.trim() });
          break;
        }
        case "offline-chat:save-prompt": {
          await saveSettings({ offlinePrompt: String(msg.prompt || "").trim() });
          postToPopup(port, { type: "offline-chat:prompt-saved", requestId: msg.requestId, ok: true });
          break;
        }
        case "offline-chat:list-tools": {
          const tools = await effectiveToolDefs();
          postToPopup(port, { type: "offline-chat:tools", requestId: msg.requestId, tools });
          break;
        }
        case "offline-chat:send": {
          void (async () => {
            try {
              const result = await runOfflineChat(port, msg.requestId, msg.messages, msg.prompt, msg.allowedTools);
              postToPopup(port, { type: "offline-chat:response", requestId: msg.requestId, ...result });
            } catch (err) {
              const canceled = err?.name === "AbortError" || /已停止|aborted|canceled|cancelled/i.test(String(err?.message || err));
              postToPopup(port, { type: "offline-chat:error", requestId: msg.requestId, error: canceled ? "\u5DF2\u505C\u6B62" : err?.message || String(err) });
            }
          })();
          break;
        }
        case "offline-chat:cancel": {
          const controller = offlineChatControllers.get(msg.requestId);
          if (controller)
            controller.canceled = true;
          postToPopup(port, { type: "offline-chat:canceled", requestId: msg.requestId, ok: !!controller });
          break;
        }
      }
    });
  });
  chrome.alarms.create("keepalive", { periodInMinutes: 0.4 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "keepalive" && socket && !socket.connected && currentStatus !== "connecting" && !authRejected) {
      socket.connect();
    }
  });
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({ id: "hs-ask", title: "HeySure AI: \u8BE2\u95EE\u9009\u4E2D\u5185\u5BB9", contexts: ["selection"] });
      chrome.contextMenus.create({ id: "hs-screenshot", title: "HeySure AI: \u622A\u56FE\u5206\u6790\u6B64\u9875", contexts: ["page"] });
    });
  });
  chrome.contextMenus.onClicked.addListener(async (info) => {
    if (info.menuItemId === "hs-ask" && info.selectionText) {
      await chrome.storage.session.set({ _pendingChat: info.selectionText });
    } else if (info.menuItemId === "hs-screenshot") {
      await chrome.storage.session.set({ _pendingChat: "\u8BF7\u622A\u56FE\u5E76\u5206\u6790\u5F53\u524D\u9875\u9762" });
    }
  });
  chrome.runtime.onStartup.addListener(async () => {
    await restoreAndConnectOnStartup();
  });
  void restoreAndConnectOnStartup();
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local")
      return;
    const authChange = changes._auth_state;
    if (!authChange)
      return;
    const oldToken = String(authChange.oldValue?.token || "");
    const newToken = String(authChange.newValue?.token || "");
    if (oldToken === newToken)
      return;
    authRejected = false;
    if (newToken) {
      if (socket)
        disconnect();
      void connect();
    } else {
      disconnect();
    }
  });
})();
