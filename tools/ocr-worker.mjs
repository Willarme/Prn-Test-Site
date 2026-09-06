import './ocr-offline-guard.mjs';
// The upstream Node entry attaches to parentPort after networking is disabled.
await import('tesseract.js/src/worker-script/node/index.js');
