import { ChildProcess, fork, spawn } from 'child_process';
import { withTimeout } from '../support/promise.js';
import fs from 'node:fs';
import path from 'node:path';
import Ajv, { JSONSchemaType } from 'ajv';
import * as AjvType from 'ajv';
import { pathToFileURL } from 'node:url';
import { $dirname } from '../support/meta.js';
import glob from 'glob';

let config: Config;
let testServer: TestServer;

async function main() {
  config = await readConfig();

  console.log('\nStarting test web server...\n');
  testServer = new TestServer();
  try {
    await testServer.start();
    await runTests();
  } finally {
    testServer.stop();
  }
}

async function runTests() {
  const files = new Set(
    glob.sync('**/*.spec.ts', {
      cwd: path.resolve($dirname(import.meta.url), '..'), // src
      nodir: true,
      realpath: true,
    })
  );

  let error = false;

  const realSerialFiles = config.serialFiles.map(f => fs.realpathSync(f)).filter(f => files.delete(f));
  if (realSerialFiles.length > 0) {
    try {
      await shellSpawn('npm run test:ava --', ['--concurrency=1', ...realSerialFiles]);
    } catch (e) {
      error = true;
    }
  }

  const restFiles = Array.from(files);
  if (restFiles.length > 0) {
    try {
      await shellSpawn('npm run test:ava --', restFiles);
    } catch (e) {
      error = true;
    }
  }

  console.error('\n---');
  if (error) {
    console.error('\x1b[31m\nerror: tests did not complete succssfully\n\x1b[0m');
    process.exit(1);
  } else {
    console.error('\x1b[32m\nAll tests passed.\n\x1b[0m');
  }
}

function shellSpawn(command: string, args?: readonly string[], options?: { silent?: boolean }) {
  options = options ?? {};
  const silent = options.silent ?? false;
  return new Promise<void>((resolve, reject) => {
    spawn(command, args ?? [], {
      stdio: silent ? 'ignore' : ['ignore', 'inherit', 'inherit'],
      shell: true,
    })
      .on('error', err => {
        reject(err);
      })
      .on('exit', code => {
        if (code === null || code !== 0) {
          reject(new Error(`Process exited with code: ${code}`));
        } else {
          resolve();
        }
      });
  });
}

class TestServer {
  private process: ChildProcess|null = null;


  public async start() {
    const buildPromise = shellSpawn('npm run test-server:build', [], { silent: true });

    const proc = fork('src/test-server/main.ts', {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      execArgv: ['--loader=ts-node/esm'],
    });
    this.process = proc;

    // Show output during startup.
    proc.stdout?.pipe(process.stdout);
    proc.stderr?.pipe(process.stderr);

    try {
      const listening = new Promise<void>((resolve, reject) => {
        proc.on('message', function (message: any) {
          if (message.type === 'listening') {
            resolve();
          }
        });
        proc.on('close', code => {
          reject(new Error(`Test server terminated with code ${code}.`));
        });
      });

      await withTimeout(listening, 15000);

      proc.removeAllListeners();
    } finally {
      // Stop showing output once running.
      proc.stdout?.unpipe(process.stdout);
      proc.stderr?.unpipe(process.stderr);
    }

    await buildPromise;
  }

  public stop() {
    if (this.process === null) {
      return;
    }
    this.process.removeAllListeners();
    this.process.kill();
    this.process = null;
  }
}

async function readConfig() {
  const importPath = pathToFileURL('ava.config.js').toString();
  const module = await import(importPath);
  const input = module.extended;

  const ajv: AjvType.default = new (Ajv as any)({
    discriminator: true,
    allErrors: true,
  });

  const validate = ajv.compile(configInputSchema);
  if (!validate(input)) {
    const message = validate.errors!.map(e => `${e.instancePath} ${e.message}`).join('\n');
    throw new Error(`Configuration is invalid:\n${message}`);
  }

  const config: Config = {
    serialFiles: input.serialFiles ?? [],
  };

  return config;
}

interface Config {
  serialFiles: string[];
}

interface InputConfig {
  serialFiles?: string[];
}

const configInputSchema: JSONSchemaType<InputConfig> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    serialFiles: { type: 'array', items: { type: 'string' }, nullable: true },
  },
};

await main();
