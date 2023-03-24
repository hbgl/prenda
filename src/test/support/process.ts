import { sleepMs, sleepMsSync } from '../../support/sleep.js';
import os from 'node:os';
import fs from 'node:fs';

export function procExists(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function procAlive(pid: number) {
  if (os.platform() === 'win32') {
    return procExists(pid);
  }
  let statusRaw: string;
  try {
    statusRaw = fs.readFileSync(`/proc/${pid}/status`, 'utf-8');
  } catch (e) {
    const code = (e as any).code;
    if (code === 'ENOENT') {
      return false;
    }
    throw e;
  }

  const match = statusRaw.match(/^State:\s+(.)/m);
  if (match === null) {
    throw new Error('Invalid process status file: process state property missing.');
  }
  const status = match[1].toUpperCase();
  return status !== 'Z' && status !== 'X';
}

export function killProcSync(pid: number, signal?: string | number) {
  while (procAlive(pid)) {
    try {
      global.process.kill(pid, signal);
    } catch {
      // Just retry.
    }
    sleepMsSync(50);
  }
}

export async function killProc(pid: number, signal?: string | number) {
  while (procAlive(pid)) {
    try {
      global.process.kill(pid, signal);
    } catch {
      // Just retry.
    }
    await sleepMs(50);
  }
}
