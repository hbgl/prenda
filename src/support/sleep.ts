export function sleepMs(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

const sleepSyncArray = new Int32Array(new SharedArrayBuffer(4));

export function sleepMsSync(ms: number) {
  Atomics.wait(sleepSyncArray, 0, 0, ms);
}
