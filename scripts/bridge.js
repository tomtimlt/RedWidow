globalThis.__demoQueue = [];
globalThis.acquireVsCodeApi = () => ({ postMessage: (message) => {
  if (globalThis.__demoReceive) globalThis.__demoReceive(message);
  else globalThis.__demoQueue.push(message);
} });
