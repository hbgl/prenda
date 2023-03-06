import { sleepMs, sleepMsSync } from '../../support/sleep.js';

export function procExists(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function killProcSync(pid: number, signal?: string | number) {
  while (procExists(pid)) {
    try {
      global.process.kill(pid, signal);
    } catch {
      // Just retry.
    }
    sleepMsSync(50);
  }
}

export async function killProc(pid: number, signal?: string | number) {
  while (procExists(pid)) {
    try {
      global.process.kill(pid, signal);
    } catch {
      // Just retry.
    }
    await sleepMs(50);
  }
}
