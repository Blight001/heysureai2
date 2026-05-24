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
      const delay = this._pingInterval + this._pingTimeout;
      this._pingTimeoutTime = Date.now() + delay;
      this._pingTimeoutTimer = this.setTimeoutFn(() => {
        this._onClose("ping timeout");
      }, delay);
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
        const delay = this.backoff.duration();
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
        }, delay);
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
    agentToken: "",
    agentId: "",
    agentName: "Browser Agent",
    agentGroup: "",
    aiKey: "",
    aiBaseUrl: "https://api.anthropic.com",
    aiModel: "claude-sonnet-4-5",
    autoConnect: false,
    offlineMode: false,
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
  var AUTH_DEFAULT = { token: "", account: "", userId: null, userName: "" };
  async function getAuth() {
    const r = await chrome.storage.local.get(AUTH_KEY);
    return { ...AUTH_DEFAULT, ...r[AUTH_KEY] || {} };
  }
  var CARDS_KEY = "_memory_cards";
  async function getCards() {
    const r = await chrome.storage.local.get(CARDS_KEY);
    const list = r[CARDS_KEY];
    return Array.isArray(list) ? list : [];
  }
  async function setCards(cards) {
    await chrome.storage.local.set({ [CARDS_KEY]: cards });
  }
  async function getCard(id) {
    return (await getCards()).find((c) => c.id === id);
  }

  // src/lib/client.ts
  var trimUrl = (u) => String(u || "").replace(/\/+$/, "");
  var authHeaders = (token, withJson = false) => {
    const h = { Authorization: `Bearer ${token}` };
    if (withJson)
      h["Content-Type"] = "application/json";
    return h;
  };
  async function parseError(res, fallback) {
    try {
      const data = await res.json();
      return String(data?.detail || data?.error || fallback);
    } catch {
      return `${fallback} (HTTP ${res.status})`;
    }
  }
  async function requestJson(url2, init, fallback) {
    const res = await fetch(url2, { ...init, signal: init.signal ?? AbortSignal.timeout(2e4) });
    if (!res.ok)
      throw new Error(await parseError(res, fallback));
    return await res.json();
  }
  async function listConfigs(serverUrl, token) {
    const rows = await requestJson(`${trimUrl(serverUrl)}/api/ai/configs`, { headers: authHeaders(token) }, "AI \u6210\u5458\u5217\u8868\u52A0\u8F7D\u5931\u8D25");
    return Array.isArray(rows) ? rows : [];
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
    {
      name: "browser_navigate",
      description: "Navigate the active browser tab to a URL. Returns when the page has loaded.",
      input_schema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Absolute URL to navigate to" },
          new_tab: { type: "boolean", description: "Open in a new tab instead of current" }
        },
        required: ["url"]
      }
    },
    {
      name: "browser_screenshot",
      description: "Capture a screenshot of the current tab. Returns a base64 PNG data URL.",
      input_schema: { type: "object", properties: {} }
    },
    {
      name: "browser_click",
      description: "Click an element on the page by CSS selector, visible text, or coordinates.",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector" },
          text: { type: "string", description: "Visible text of the element to click" },
          x: { type: "number", description: "X coordinate (px)" },
          y: { type: "number", description: "Y coordinate (px)" }
        }
      }
    },
    {
      name: "browser_type",
      description: "Type text into an input field or textarea.",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector of the input" },
          text: { type: "string", description: "Text to type" },
          clear_first: { type: "boolean", description: "Clear the field before typing (default true)" },
          submit: { type: "boolean", description: "Press Enter after typing" }
        },
        required: ["text"]
      }
    },
    {
      name: "browser_get_content",
      description: "Get the visible text content, URL, title, and meta info of the current page.",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "Limit content to this CSS selector (default: body)" },
          include_html: { type: "boolean", description: "Also return raw HTML (truncated)" }
        }
      }
    },
    {
      name: "browser_search",
      description: "Search the web using a popular search engine.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          engine: {
            type: "string",
            enum: Object.keys(SEARCH_ENGINES),
            description: "Search engine (default: google)"
          }
        },
        required: ["query"]
      }
    },
    {
      name: "browser_scroll",
      description: "Scroll the current page. Returns the resulting scroll position (scrollY, percent, atTop/atBottom), how many pixels actually moved, and which section/headings are now in view \u2014 so you know where you landed and what changed.",
      input_schema: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["up", "down", "top", "bottom"], description: "Scroll direction" },
          amount: { type: "number", description: "Pixels to scroll (default 400)" },
          selector: { type: "string", description: "Optional: scroll this element into view instead of by amount" }
        },
        required: ["direction"]
      }
    },
    {
      name: "browser_wait",
      description: "Wait for a CSS selector to appear or for a fixed duration.",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "Wait for this CSS element to appear" },
          ms: { type: "number", description: "Wait for this many milliseconds" }
        }
      }
    },
    {
      name: "browser_evaluate",
      description: "Execute arbitrary JavaScript in the page context and return the result.",
      input_schema: {
        type: "object",
        properties: {
          code: { type: "string", description: "JavaScript expression or statements to execute" }
        },
        required: ["code"]
      }
    },
    {
      name: "browser_extract",
      description: "Extract structured data (text, href, src, etc.) from elements matching a selector.",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector to query" },
          attributes: { type: "array", items: { type: "string" }, description: "Attributes to collect per element" },
          limit: { type: "number", description: "Max number of elements (default 50)" }
        },
        required: ["selector"]
      }
    },
    {
      name: "browser_find_text",
      description: "Find all elements that contain specific text on the page.",
      input_schema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text to search for" },
          exact: { type: "boolean", description: "Exact match only" }
        },
        required: ["text"]
      }
    },
    {
      name: "browser_find_popups",
      description: "Detect visible popups, modals, dialogs, drawers, overlays, and their likely close buttons on the current page.",
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Maximum popups to return (default 10)" }
        }
      }
    },
    {
      name: "browser_close_popup",
      description: "Close a visible popup/modal/dialog. Uses detected close buttons first, then Escape/backdrop fallback. Call browser_find_popups first when you need to inspect candidates.",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "Optional CSS selector of the popup to close" },
          text: { type: "string", description: "Optional text contained by the popup to identify it" },
          index: { type: "number", description: "Popup index from browser_find_popups (default 0)" },
          strategy: { type: "string", enum: ["auto", "close_button", "escape", "backdrop"], description: "Close strategy (default auto)" },
          force_remove: { type: "boolean", description: "If true, remove the popup DOM node as a last resort" }
        }
      }
    },
    {
      name: "browser_fill_form",
      description: "Fill multiple form fields in one call.",
      input_schema: {
        type: "object",
        properties: {
          fields: {
            type: "array",
            description: "List of {selector, value} pairs to fill",
            items: {
              type: "object",
              properties: { selector: { type: "string" }, value: { type: "string" } },
              required: ["selector", "value"]
            }
          },
          submit_selector: { type: "string", description: "CSS selector of submit button to click after filling" }
        },
        required: ["fields"]
      }
    },
    {
      name: "browser_select",
      description: "Select an option in a <select> dropdown.",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector of the <select> element" },
          value: { type: "string", description: "Option value or visible text to select" }
        },
        required: ["selector", "value"]
      }
    },
    {
      name: "browser_tab_list",
      description: "List all open browser tabs.",
      input_schema: { type: "object", properties: {} }
    },
    {
      name: "browser_tab_open",
      description: "Open a new tab with the given URL.",
      input_schema: {
        type: "object",
        properties: { url: { type: "string", description: "URL for the new tab" } },
        required: ["url"]
      }
    },
    {
      name: "browser_tab_close",
      description: "Close a tab by its ID, or the active tab if no ID given.",
      input_schema: {
        type: "object",
        properties: { tab_id: { type: "number", description: "Tab ID to close" } }
      }
    },
    {
      name: "browser_history_back",
      description: "Navigate the current tab back in history.",
      input_schema: { type: "object", properties: {} }
    },
    {
      name: "browser_history_forward",
      description: "Navigate the current tab forward in history.",
      input_schema: { type: "object", properties: {} }
    },
    {
      name: "browser_clipboard_write",
      description: "Write text to the system clipboard.",
      input_schema: {
        type: "object",
        properties: { text: { type: "string", description: "Text to copy" } },
        required: ["text"]
      }
    },
    {
      name: "browser_storage_get",
      description: "Read a key from the page's localStorage or sessionStorage.",
      input_schema: {
        type: "object",
        properties: {
          key: { type: "string", description: "Storage key" },
          type: { type: "string", enum: ["local", "session"], description: "Storage type (default: local)" }
        },
        required: ["key"]
      }
    },
    {
      name: "browser_hover",
      description: "Hover the mouse over an element to reveal tooltips or dropdowns.",
      input_schema: {
        type: "object",
        properties: { selector: { type: "string", description: "CSS selector of element to hover" } },
        required: ["selector"]
      }
    },
    {
      name: "browser_page_info",
      description: "Get where you currently are on the page: scroll position (scrollY, percent, atTop/atBottom), viewport size, full page height, the current section heading, all headings now visible in the viewport, and element counts. Call this to orient yourself before/after scrolling or interacting.",
      input_schema: { type: "object", properties: {} }
    },
    {
      name: "browser_right_click",
      description: "Right-click (open the context menu) on an element by CSS selector, visible text, or coordinates.",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector" },
          text: { type: "string", description: "Visible text of the element" },
          x: { type: "number", description: "X coordinate (px)" },
          y: { type: "number", description: "Y coordinate (px)" }
        }
      }
    },
    {
      name: "browser_double_click",
      description: "Double-click an element by CSS selector, visible text, or coordinates (e.g. to select a word or open an item).",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector" },
          text: { type: "string", description: "Visible text of the element" },
          x: { type: "number", description: "X coordinate (px)" },
          y: { type: "number", description: "Y coordinate (px)" }
        }
      }
    },
    {
      name: "browser_drag",
      description: "Drag from a source element/point and drop onto a target element/point. Fires both HTML5 drag-and-drop and pointer events, so it works with most draggable UIs (sliders, sortable lists, file drop zones).",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "Source CSS selector" },
          text: { type: "string", description: "Source visible text" },
          x: { type: "number", description: "Source X coordinate (px)" },
          y: { type: "number", description: "Source Y coordinate (px)" },
          to_selector: { type: "string", description: "Target CSS selector" },
          to_text: { type: "string", description: "Target visible text" },
          to_x: { type: "number", description: "Target X coordinate (px)" },
          to_y: { type: "number", description: "Target Y coordinate (px)" }
        }
      }
    },
    {
      name: "browser_press_key",
      description: "Press a keyboard key (optionally with modifiers) on the focused element or a given selector. Useful for Enter, Escape, Tab, Arrow keys, or shortcuts like Ctrl+A.",
      input_schema: {
        type: "object",
        properties: {
          key: { type: "string", description: 'Key name, e.g. "Enter", "Escape", "Tab", "ArrowDown", "a"' },
          selector: { type: "string", description: "Optional CSS selector to focus before pressing" },
          ctrl: { type: "boolean", description: "Hold Ctrl" },
          shift: { type: "boolean", description: "Hold Shift" },
          alt: { type: "boolean", description: "Hold Alt" },
          meta: { type: "boolean", description: "Hold Meta/Cmd" }
        },
        required: ["key"]
      }
    },
    {
      name: "card_list",
      description: "List saved memory cards (automation workflows). Returns each card id, name, description and step count.",
      input_schema: { type: "object", properties: {} }
    },
    {
      name: "card_get",
      description: "Get the full steps of a saved card by id or name. Use this to inspect a card before running or fixing it.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Card id" },
          name: { type: "string", description: "Card name (used if id omitted)" }
        }
      }
    },
    {
      name: "card_save",
      description: "Save a sequence of browser steps as a reusable memory card. Each step is { tool, args, note } where note (\u5907\u6CE8) explains the step in plain language. If a card with the same name exists, mode controls behavior: replace (default), merge (append steps), or new (force a new card).",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Card name" },
          description: { type: "string", description: "What this workflow does" },
          mode: { type: "string", enum: ["replace", "merge", "new"], description: "On name conflict (default replace)" },
          steps: {
            type: "array",
            description: "Ordered steps to perform",
            items: {
              type: "object",
              properties: {
                tool: { type: "string", description: "A browser_* tool name, e.g. browser_navigate" },
                args: { type: "object", description: "Arguments for that tool" },
                note: { type: "string", description: "\u5907\u6CE8\uFF1Aplain-language description of this step" }
              },
              required: ["tool"]
            }
          }
        },
        required: ["name", "steps"]
      }
    },
    {
      name: "card_update_step",
      description: "Fix one step of an existing card by index \u2014 change its tool, args, or note. Use this to repair a card after card_run reports a failed step.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Card id" },
          name: { type: "string", description: "Card name (used if id omitted)" },
          index: { type: "number", description: "0-based index of the step to update" },
          tool: { type: "string", description: "New tool name (optional)" },
          args: { type: "object", description: "New arguments (optional)" },
          note: { type: "string", description: "New \u5907\u6CE8 (optional)" }
        },
        required: ["index"]
      }
    },
    {
      name: "card_run",
      description: "Run a saved card by id or name. Executes its steps in order and returns a per-step result list; on failure it returns failedStep with the index, note and error so you can diagnose and fix it (with card_update_step) then re-run.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Card id" },
          name: { type: "string", description: "Card name (used if id omitted)" }
        }
      }
    },
    {
      name: "card_delete",
      description: "Delete a saved card by id or name.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Card id" },
          name: { type: "string", description: "Card name (used if id omitted)" }
        }
      }
    }
  ];
  var BROWSER_CAPABILITIES = BROWSER_TOOLS.map((t) => t.name);

  // src/lib/tools/browser.ts
  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id)
      throw new Error("No active tab found");
    return tab;
  }
  async function contentMsg(tabId, msg) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, msg);
      if (res?.error)
        throw new Error(res.error);
      return res;
    } catch (err) {
      if (err.message?.includes("Could not establish connection")) {
        throw new Error("Content script unavailable on this page (try a normal web page, not chrome://).");
      }
      throw err;
    }
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
  async function toolScreenshot() {
    const tab = await getActiveTab();
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    return { success: true, dataUrl, tabId: tab.id, url: tab.url };
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
    return contentMsg(tab.id, { action: "click", selector: args.selector, text: args.text, x: args.x, y: args.y });
  }
  async function toolType(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "type", selector: args.selector, text: args.text, clearFirst: args.clear_first !== false, submit: !!args.submit });
  }
  async function toolGetContent(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "get_content", selector: args.selector, includeHtml: !!args.include_html });
  }
  async function toolScroll(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "scroll", direction: args.direction, amount: args.amount || 400 });
  }
  async function toolWait(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "wait", selector: args.selector, ms: args.ms });
  }
  async function toolEvaluate(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "evaluate", code: args.code });
  }
  async function toolExtract(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "extract", selector: args.selector, attributes: args.attributes, limit: args.limit || 50 });
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
    return contentMsg(tab.id, { action: "fill_form", fields: args.fields, submitSelector: args.submit_selector });
  }
  async function toolSelect(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "select", selector: args.selector, value: args.value });
  }
  async function toolStorageGet(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "storage_get", key: args.key, storageType: args.type || "local" });
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
  async function executeBrowserOnly(name, args) {
    switch (name) {
      case "browser_navigate":
        return toolNavigate(args);
      case "browser_screenshot":
        return toolScreenshot();
      case "browser_click":
        return toolClick(args);
      case "browser_type":
        return toolType(args);
      case "browser_get_content":
        return toolGetContent(args);
      case "browser_search":
        return toolSearch(args);
      case "browser_scroll":
        return toolScroll(args);
      case "browser_wait":
        return toolWait(args);
      case "browser_evaluate":
        return toolEvaluate(args);
      case "browser_extract":
        return toolExtract(args);
      case "browser_find_text":
        return toolFindText(args);
      case "browser_find_popups":
        return toolFindPopups(args);
      case "browser_close_popup":
        return toolClosePopup(args);
      case "browser_fill_form":
        return toolFillForm(args);
      case "browser_select":
        return toolSelect(args);
      case "browser_tab_list":
        return toolTabList();
      case "browser_tab_open":
        return toolTabOpen(args);
      case "browser_tab_close":
        return toolTabClose(args);
      case "browser_history_back":
        return toolHistoryBack();
      case "browser_history_forward":
        return toolHistoryForward();
      case "browser_clipboard_write":
        return toolClipboardWrite(args);
      case "browser_storage_get":
        return toolStorageGet(args);
      case "browser_hover":
        return toolHover(args);
      case "browser_page_info":
        return toolPageInfo();
      case "browser_right_click":
        return toolRightClick(args);
      case "browser_double_click":
        return toolDoubleClick(args);
      case "browser_drag":
        return toolDrag(args);
      case "browser_press_key":
        return toolPressKey(args);
      default:
        throw new Error(`Unknown browser tool: ${name}`);
    }
  }

  // src/lib/cards.ts
  var newId = () => "card_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  function deriveNote(tool, args) {
    const labels = {
      browser_navigate: "\u8DF3\u8F6C\u9875\u9762",
      browser_wait: "\u7B49\u5F85",
      browser_click: "\u70B9\u51FB",
      browser_double_click: "\u53CC\u51FB",
      browser_right_click: "\u53F3\u952E",
      browser_type: "\u8F93\u5165\u5185\u5BB9",
      browser_scroll: "\u6EDA\u52A8",
      browser_select: "\u9009\u62E9",
      browser_press_key: "\u6309\u952E",
      browser_drag: "\u62D6\u62FD",
      browser_hover: "\u60AC\u505C",
      browser_fill_form: "\u586B\u5199\u8868\u5355",
      browser_search: "\u641C\u7D22",
      browser_screenshot: "\u622A\u56FE",
      browser_extract: "\u63D0\u53D6\u6570\u636E",
      browser_get_content: "\u8BFB\u53D6\u5185\u5BB9",
      browser_page_info: "\u67E5\u770B\u9875\u9762\u4F4D\u7F6E",
      browser_find_popups: "\u67E5\u627E\u5F39\u7A97",
      browser_close_popup: "\u5173\u95ED\u5F39\u7A97"
    };
    const base = labels[tool] || tool.replace(/^browser_/, "");
    const hint = args?.url || args?.text || args?.selector || args?.query || (args?.direction ? `${args.direction}${args?.amount ? " " + args.amount : ""}` : "") || (args?.key ? `\u6309\u952E ${args.key}` : "") || (args?.ms ? `${args.ms}ms` : "");
    return hint ? `${base}\uFF1A${String(hint).slice(0, 60)}` : base;
  }

  // src/lib/tools/cards.ts
  var cardProgress = null;
  function setCardProgress(fn) {
    cardProgress = fn;
  }
  async function runCardSteps(card, opts = {}) {
    const total = card.steps.length;
    const results = [];
    for (let i = 0; i < total; i++) {
      if (opts.shouldStop?.())
        return { success: false, stopped: true, results };
      const step = card.steps[i];
      if (/^card[_.]/i.test(step.tool)) {
        const r = { index: i, note: step.note, tool: step.tool, status: "error", error: "\u5361\u7247\u6B65\u9AA4\u4E0D\u5141\u8BB8\u8C03\u7528\u5361\u7247\u5DE5\u5177\uFF08\u907F\u514D\u9012\u5F52\uFF09" };
        results.push(r);
        cardProgress?.(card.id, i, total, step.note, step.tool, "error", r.error);
        return { success: false, results, failedStep: r };
      }
      cardProgress?.(card.id, i, total, step.note, step.tool, "running");
      try {
        const result = await executeBrowserOnly(step.tool, step.args || {});
        let preview = "";
        try {
          preview = (typeof result === "string" ? result : JSON.stringify(result)).slice(0, 180);
        } catch {
        }
        results.push({ index: i, note: step.note, tool: step.tool, status: "success", preview });
        cardProgress?.(card.id, i, total, step.note, step.tool, "success");
      } catch (err) {
        const msg = err?.message || String(err);
        const r = { index: i, note: step.note, tool: step.tool, status: "error", error: msg };
        results.push(r);
        cardProgress?.(card.id, i, total, step.note, step.tool, "error", msg);
        return { success: false, results, failedStep: r };
      }
    }
    return { success: true, results };
  }
  function byIdOrName(cards, args) {
    if (args?.id)
      return cards.find((c) => c.id === String(args.id));
    if (args?.name)
      return cards.find((c) => c.name === String(args.name));
    return void 0;
  }
  function normalizeSteps(rawSteps) {
    const out = [];
    for (const rs of Array.isArray(rawSteps) ? rawSteps : []) {
      if (!rs || typeof rs !== "object")
        continue;
      const tool = String(rs.tool || rs.name || "").trim();
      if (!tool)
        continue;
      let a = rs.args ?? rs.arguments ?? rs.input ?? {};
      if (typeof a === "string") {
        try {
          a = JSON.parse(a);
        } catch {
          a = {};
        }
      }
      if (!a || typeof a !== "object")
        a = {};
      const note = String(rs.note ?? rs.remark ?? "").trim() || deriveNote(tool, a);
      out.push({ tool, args: a, note });
    }
    return out;
  }
  async function toolCardList() {
    const cards = await getCards();
    return { success: true, count: cards.length, cards: cards.map((c) => ({ id: c.id, name: c.name, description: c.description, steps: c.steps.length })) };
  }
  async function toolCardGet(args) {
    const card = byIdOrName(await getCards(), args);
    if (!card)
      throw new Error("\u5361\u7247\u4E0D\u5B58\u5728");
    return { success: true, card: { id: card.id, name: card.name, description: card.description, steps: card.steps } };
  }
  async function toolCardSave(args) {
    const name = String(args.name || "").trim();
    if (!name)
      throw new Error("name \u5FC5\u586B");
    const steps = normalizeSteps(args.steps);
    if (!steps.length)
      throw new Error("steps \u4E0D\u80FD\u4E3A\u7A7A");
    const mode = ["replace", "merge", "new"].includes(args.mode) ? args.mode : "replace";
    const cards = await getCards();
    const now = Date.now();
    const existing = cards.find((c) => c.name === name);
    if (existing && mode !== "new") {
      existing.steps = mode === "merge" ? [...existing.steps, ...steps] : steps;
      if (args.description !== void 0)
        existing.description = String(args.description || "");
      existing.updatedAt = now;
      await setCards(cards);
      return { success: true, action: mode, id: existing.id, name, steps: existing.steps.length };
    }
    const card = { id: newId(), name, description: String(args.description || ""), steps, createdAt: now, updatedAt: now };
    cards.push(card);
    await setCards(cards);
    return { success: true, action: "created", id: card.id, name, steps: steps.length };
  }
  async function toolCardUpdateStep(args) {
    const cards = await getCards();
    const card = byIdOrName(cards, args);
    if (!card)
      throw new Error("\u5361\u7247\u4E0D\u5B58\u5728");
    const idx = Number(args.index);
    if (!(idx >= 0 && idx < card.steps.length))
      throw new Error(`index \u8D8A\u754C\uFF08\u5361\u7247\u6709 ${card.steps.length} \u6B65\uFF09`);
    const step = card.steps[idx];
    if (args.tool !== void 0)
      step.tool = String(args.tool);
    if (args.note !== void 0)
      step.note = String(args.note);
    if (args.args !== void 0) {
      let a = args.args;
      if (typeof a === "string") {
        try {
          a = JSON.parse(a);
        } catch {
        }
      }
      if (a && typeof a === "object")
        step.args = a;
    }
    card.updatedAt = Date.now();
    await setCards(cards);
    return { success: true, id: card.id, index: idx, step };
  }
  async function toolCardDelete(args) {
    const cards = await getCards();
    const card = byIdOrName(cards, args);
    if (!card)
      throw new Error("\u5361\u7247\u4E0D\u5B58\u5728");
    await setCards(cards.filter((c) => c.id !== card.id));
    return { success: true, id: card.id, name: card.name };
  }
  async function toolCardRun(args) {
    const card = byIdOrName(await getCards(), args);
    if (!card)
      throw new Error("\u5361\u7247\u4E0D\u5B58\u5728");
    const res = await runCardSteps(card);
    return {
      success: res.success,
      cardId: card.id,
      name: card.name,
      total: card.steps.length,
      completed: res.results.filter((r) => r.status === "success").length,
      failedStep: res.failedStep,
      results: res.results
    };
  }
  async function executeCardTool(name, args) {
    switch (name) {
      case "card_list":
        return toolCardList();
      case "card_get":
        return toolCardGet(args);
      case "card_save":
        return toolCardSave(args);
      case "card_update_step":
        return toolCardUpdateStep(args);
      case "card_run":
        return toolCardRun(args);
      case "card_delete":
        return toolCardDelete(args);
      default:
        throw new Error(`Unknown card tool: ${name}`);
    }
  }

  // src/lib/tools/router.ts
  async function executeBrowserTool(name, args) {
    if (name.startsWith("card_"))
      return executeCardTool(name, args);
    return executeBrowserOnly(name, args);
  }

  // src/lib/ai.ts
  async function callAI(baseUrl, apiKey, model, messages, tools, systemPrompt) {
    if (!apiKey)
      throw new Error("AI Key is not configured");
    const isAnthropic = baseUrl.includes("anthropic.com");
    const endpoint = isAnthropic ? `${baseUrl.replace(/\/$/, "")}/v1/messages` : `${baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
    const headers = { "Content-Type": "application/json" };
    if (isAnthropic) {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    let body;
    if (isAnthropic) {
      body = { model, max_tokens: 4096, messages };
      if (tools?.length)
        body.tools = tools;
      if (systemPrompt)
        body.system = systemPrompt;
    } else {
      const openAiMessages = systemPrompt ? [{ role: "system", content: systemPrompt }, ...messages] : messages;
      body = { model, max_tokens: 4096, messages: openAiMessages };
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
      return "browser_tab_list";
    if (/内容|content|页面文本/.test(t))
      return "browser_get_content";
    return "browser_get_content";
  }
  var SYSTEM_PROMPT = `You are HeySure AI, a browser automation assistant running as a Chrome extension.
You can navigate pages, click, type, take screenshots, search the web, close popups/modals/dialogs, and extract information.

When completing a task:
1. Navigate to the relevant URL or search for it
2. Use browser_page_info to know where you are on the page (scroll position, current section, visible headings) and browser_screenshot when you need to see it
3. Interact with elements systematically: click, double_click, right_click, type, fill forms, drag, press_key
4. If a popup/modal/dialog blocks the page, use browser_find_popups to inspect it and browser_close_popup to close it
5. Extract or summarize the result

Memory cards (automation workflows):
- When the user asks to save/remember a sequence of actions as a card, call card_save with name + steps, where each step is { tool, args, note } and note (\u5907\u6CE8) explains the step.
- To replay a workflow, call card_run by name or id.
- If card_run reports a failedStep, diagnose the cause (inspect the page with browser_page_info/browser_get_content, re-check the selector), then fix that step with card_update_step and run the card again. Repeat until it succeeds or you can explain why it cannot.

Always:
- After scrolling, read the returned position (scrollY, percent, atTop/atBottom, section, visible headings) so you know where you landed and what changed
- Be methodical and verify each step
- Respond in the same language as the user's message
- Summarize what you accomplished at the end`;
  async function executeTask(task, settings) {
    const toolName = task.tool || inferTool(task.instruction || "");
    const args = task.args || {};
    if (toolName && toolName !== "ai_agent" && !toolName.startsWith("ai.")) {
      if (!task.tool && task.instruction && Object.keys(args).length === 0) {
        if (toolName === "browser_search")
          args.query = task.instruction;
        else if (toolName === "browser_navigate")
          args.url = task.instruction;
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
              const b64 = toolResult.dataUrl.replace(/^data:image\/png;base64,/, "");
              content = [
                { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } },
                { type: "text", text: `Screenshot of: ${toolResult.url || "current page"}` }
              ];
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

  // src/background.ts
  var socket = null;
  var currentStatus = "disconnected";
  var taskOutcomes = /* @__PURE__ */ new Map();
  var popupPorts = /* @__PURE__ */ new Set();
  var _machineId = null;
  function mkEntry(type, status, message, data) {
    return { id: Math.random().toString(36).slice(2), type, status, message, data, timestamp: Date.now() };
  }
  function log(type, status, message, data) {
    const entry = mkEntry(type, status, message, data);
    void pushActivity(entry);
    broadcast({ type: "activity:log", entry });
  }
  function setStatus(status, reason) {
    currentStatus = status;
    broadcast({ type: "agent:status", status, reason });
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
  function broadcast(msg) {
    popupPorts.forEach((port) => {
      try {
        port.postMessage(msg);
      } catch {
        popupPorts.delete(port);
      }
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
  async function connect() {
    const settings = await getSettings();
    if (socket?.connected)
      return;
    if (settings.offlineMode) {
      log("system", "info", "\u79BB\u7EBF\u6A21\u5F0F\u5DF2\u5F00\u542F\uFF0C\u8DF3\u8FC7\u670D\u52A1\u5668\u8FDE\u63A5");
      return;
    }
    let url2;
    try {
      url2 = new URL(settings.serverUrl);
    } catch {
      log("system", "error", "\u670D\u52A1\u5668 URL \u683C\u5F0F\u65E0\u6548");
      return;
    }
    setStatus("connecting");
    log("system", "info", `\u8FDE\u63A5\u5230 ${url2.href}...`);
    socket = lookup2(url2.href, {
      transports: ["websocket"],
      // XHR polling unavailable in service workers
      reconnectionDelay: 2e3,
      reconnectionAttempts: Infinity,
      autoConnect: true
    });
    socket.on("connect", async () => {
      setStatus("connected");
      log("system", "info", "\u5DF2\u8FDE\u63A5\u5230\u670D\u52A1\u5668");
      await register();
    });
    socket.on("disconnect", (reason) => {
      setStatus("disconnected", reason);
      log("system", "warn", `\u8FDE\u63A5\u65AD\u5F00: ${reason}`);
    });
    socket.on("connect_error", (err) => {
      setStatus("error", err.message);
      log("system", "error", `\u8FDE\u63A5\u5931\u8D25: ${err.message}`);
    });
    socket.on("agent:registered", (data) => {
      setStatus("registered");
      log("system", "success", `\u5DF2\u6CE8\u518C: ${data?.name || settings.agentName}`);
    });
    socket.on("agent:register_rejected", (data) => {
      setStatus("error", data?.reason);
      log("system", "error", `\u6CE8\u518C\u88AB\u62D2\u7EDD: ${data?.reason}`);
    });
    socket.on("task:dispatch", (task) => {
      void handleTask(task);
    });
  }
  async function register() {
    const settings = await getSettings();
    const auth = await getAuth();
    if (settings.offlineMode) {
      log("system", "info", "\u79BB\u7EBF\u6A21\u5F0F\u5DF2\u5F00\u542F\uFF0C\u8DF3\u8FC7\u6CE8\u518C");
      return;
    }
    const id = settings.agentId || await getMachineId();
    const selectedAiConfigId = auth.token ? settings.selectedAiConfigId || null : null;
    if (!auth.token && settings.selectedAiConfigId) {
      await saveSettings({ selectedAiConfigId: null });
      log("system", "warn", "\u672A\u767B\u5F55\uFF0C\u5DF2\u53D6\u6D88 AI \u6210\u5458\u81EA\u52A8\u6CE8\u518C\u9009\u62E9");
    }
    socket?.emit("agent:register", {
      id,
      aiConfigId: selectedAiConfigId,
      name: settings.agentName || "Browser Agent",
      group: settings.agentGroup || "",
      platform: `browser-extension (${navigator?.userAgent?.split(" ").pop() || "chrome"})`,
      os: { platform: "browser", arch: "unknown", release: "1.0", hostname: id },
      capabilities: BROWSER_CAPABILITIES,
      version: "1.0.0",
      token: settings.agentToken || "",
      workspaceRoot: "",
      lifecycle: "registered",
      isWindowsDesktop: false,
      isBrowserExtension: true
    });
  }
  function disconnect() {
    socket?.disconnect();
    socket = null;
    setStatus("disconnected");
  }
  async function refreshServerAiSelectionOnStartup() {
    const settings = await getSettings();
    const auth = await getAuth();
    if (settings.offlineMode || !auth.token || !settings.serverUrl)
      return null;
    let members;
    try {
      members = await listConfigs(settings.serverUrl, auth.token);
    } catch (err) {
      log("system", "warn", `\u542F\u52A8\u65F6\u83B7\u53D6 AI \u6210\u5458\u5931\u8D25: ${err?.message || err}`);
      return null;
    }
    const selectedAiConfigId = settings.selectedAiConfigId || null;
    if (!selectedAiConfigId)
      return null;
    const selected = members.find((m) => m.id === selectedAiConfigId);
    if (!selected) {
      await saveSettings({ selectedAiConfigId: null });
      log("system", "warn", "\u4E0A\u6B21\u9009\u62E9\u7684 AI \u5DF2\u4E0D\u5B58\u5728\uFF0C\u5DF2\u6E05\u9664\u81EA\u52A8\u9009\u62E9");
      return null;
    }
    log("system", "info", `\u5DF2\u6062\u590D\u4E0A\u6B21\u9009\u62E9\u7684 AI\uFF1A${selected.name || selected.id}`);
    return selectedAiConfigId;
  }
  async function restoreAndConnectOnStartup() {
    const selectedAiConfigId = await refreshServerAiSelectionOnStartup();
    const s = await getSettings();
    if (!s.offlineMode && (selectedAiConfigId || s.autoConnect))
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
      const outcome = await executeTask(task, settings);
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
    try {
      const start = Date.now();
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5e3) }).catch(() => fetch(base, { signal: AbortSignal.timeout(5e3) }));
      return { success: true, status: res.status, ms: Date.now() - start };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
  var CHAT_SYSTEM = `You are HeySure AI, a browser automation assistant running as a Chrome extension.
You can navigate pages, click, double-click, right-click, type, drag, press keys, scroll, take
screenshots, search the web, detect and close popups/modals/dialogs, extract data, and more.

Use browser_page_info to know where you are on the page (scroll position, current section,
visible headings); after scrolling, read the returned position so you know where you landed and
what changed.

If a popup/modal/dialog blocks the page, call browser_find_popups to inspect detected dialogs and
browser_close_popup to close the matching one before continuing.

Memory cards: when the user asks to save a sequence of actions, call card_save (steps are
{tool,args,note}, where note is a \u5907\u6CE8). Replay with card_run by name/id. If card_run returns a
failedStep, diagnose it, fix that step with card_update_step, and run again until it works.

When asked to complete tasks, use the available tools systematically and summarize what you did.
Respond in the same language as the user. For factual questions, search the web if needed.`;
  async function runChat(messages) {
    const settings = await getSettings();
    if (!settings.aiKey)
      throw new Error("\u672A\u914D\u7F6E AI Key");
    const toolsUsed = [];
    let iter = 0;
    const MAX = 12;
    while (iter < MAX) {
      const resp = await callAI(settings.aiBaseUrl, settings.aiKey, settings.aiModel, messages, BROWSER_TOOLS, CHAT_SYSTEM);
      if (!resp.toolUses?.length) {
        return { text: resp.text || "\u5B8C\u6210", toolsUsed };
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
            const b64 = result.dataUrl.replace(/^data:image\/png;base64,/, "");
            content = [
              { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } },
              { type: "text", text: `Page: ${result.url || ""}` }
            ];
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
    return { text: "\u5DF2\u8FBE\u5230\u6700\u5927\u8FED\u4EE3\u6B21\u6570", toolsUsed };
  }
  var cardRunning = false;
  var cardStopRequested = false;
  setCardProgress((cardId, index, total, note, tool, status, error) => {
    broadcast({ type: "card:progress", cardId, index, total, note, tool, status, error });
    const label = `[${index + 1}/${total}] ${note}`;
    if (status === "running")
      log("card", "running", label, { tool });
    else if (status === "success")
      log("card", "success", `\u5B8C\u6210 ${label}`);
    else if (status === "error")
      log("card", "error", `\u5931\u8D25 ${label} \u2014 ${error || ""}`);
  });
  async function runCard(cardId) {
    if (cardRunning) {
      log("card", "warn", "\u5DF2\u6709\u5361\u7247\u6B63\u5728\u6267\u884C\uFF0C\u8BF7\u5148\u505C\u6B62");
      return;
    }
    const card = await getCard(cardId);
    if (!card) {
      broadcast({ type: "card:done", cardId, success: false, reason: "\u5361\u7247\u4E0D\u5B58\u5728" });
      log("card", "error", "\u5361\u7247\u4E0D\u5B58\u5728");
      return;
    }
    cardRunning = true;
    cardStopRequested = false;
    log("card", "info", `\u5F00\u59CB\u6267\u884C\u5361\u7247\u300C${card.name}\u300D\uFF0C\u5171 ${card.steps.length} \u6B65`);
    try {
      const res = await runCardSteps(card, { shouldStop: () => cardStopRequested });
      if (res.stopped) {
        log("card", "warn", `\u5DF2\u505C\u6B62\uFF1A${card.name}`);
        broadcast({ type: "card:done", cardId, success: false, reason: "stopped" });
      } else if (res.success) {
        log("card", "success", `\u5361\u7247\u6267\u884C\u5B8C\u6210\uFF1A${card.name}`);
        broadcast({ type: "card:done", cardId, success: true });
      } else {
        broadcast({ type: "card:done", cardId, success: false, reason: res.failedStep?.error || "\u6267\u884C\u5931\u8D25" });
      }
    } finally {
      cardRunning = false;
    }
  }
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "popup")
      return;
    popupPorts.add(port);
    port.postMessage({ type: "agent:status", status: currentStatus });
    getActivity().then((entries) => {
      entries.forEach((e) => port.postMessage({ type: "activity:log", entry: e }));
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
        case "settings:get": {
          const settings = await getSettings();
          port.postMessage({ type: "settings:data", settings });
          break;
        }
        case "settings:save": {
          await saveSettings(msg.payload);
          if (msg.payload.offlineMode === true && socket?.connected) {
            disconnect();
          }
          break;
        }
        case "agent:selected-ai": {
          const auth = await getAuth();
          const aiConfigId = auth.token ? msg.aiConfigId : null;
          if (msg.aiConfigId && !auth.token) {
            log("system", "warn", "\u8BF7\u5148\u767B\u5F55\u8F6F\u4EF6\u7AEF\u8D26\u53F7\uFF0C\u518D\u9009\u62E9 AI \u6210\u5458\u81EA\u52A8\u6CE8\u518C");
          }
          await saveSettings({ selectedAiConfigId: aiConfigId });
          if (socket?.connected) {
            await register();
          }
          break;
        }
        case "chat:send": {
          const requestId = msg.requestId;
          try {
            const result = await runChat(msg.messages);
            port.postMessage({ type: "chat:response", text: result.text, toolsUsed: result.toolsUsed, requestId });
          } catch (err) {
            port.postMessage({ type: "chat:error", error: err.message, requestId });
          }
          break;
        }
        case "connection:test": {
          const result = await testConnection();
          port.postMessage({ type: "connection:result", result });
          break;
        }
        case "card:run": {
          void runCard(msg.cardId);
          break;
        }
        case "card:stop": {
          if (cardRunning) {
            cardStopRequested = true;
            log("card", "warn", "\u6536\u5230\u505C\u6B62\u8BF7\u6C42");
          }
          break;
        }
      }
    });
  });
  chrome.alarms.create("keepalive", { periodInMinutes: 0.4 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "keepalive" && socket && !socket.connected && currentStatus !== "connecting") {
      socket.connect();
    }
  });
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({ id: "hs-ask", title: "HeySure AI: \u8BE2\u95EE\u9009\u4E2D\u5185\u5BB9", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "hs-screenshot", title: "HeySure AI: \u622A\u56FE\u5206\u6790\u6B64\u9875", contexts: ["page"] });
  });
  chrome.contextMenus.onClicked.addListener(async (info) => {
    if (info.menuItemId === "hs-ask" && info.selectionText) {
      await chrome.storage.session.set({ _pendingChat: info.selectionText });
    }
  });
  chrome.runtime.onStartup.addListener(async () => {
    await restoreAndConnectOnStartup();
  });
  void restoreAndConnectOnStartup();
  chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create("keepalive", { periodInMinutes: 0.4 });
  });
})();
