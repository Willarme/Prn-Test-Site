// Loaded in both the OCR child and its worker thread before the OCR library.
// This adapter accepts image bytes and bundled weights only, never remote URLs.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';

const denied = () => { throw new Error('OCR_NETWORK_DISABLED'); };
globalThis.fetch = denied;
http.request = denied;
http.get = denied;
https.request = denied;
https.get = denied;
net.connect = denied;
net.createConnection = denied;
net.Socket.prototype.connect = denied;
syncBuiltinESMExports();
