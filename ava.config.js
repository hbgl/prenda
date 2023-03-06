// These are custom extensions that are not part of the
// standard ava configuration.
export const extended = {
  serialFiles: [
    'src/render/tab.spec.ts',
    'src/render/manager.spec.ts',
    'src/browser/providers/external.spec.ts',
    'src/browser/providers/supervisor.spec.ts',
    'src/browser/process.spec.ts',
  ],
};

export default {
  // files: [
  // ],
  extensions: {
    ts: 'module',
  },
  nodeArguments: ['--loader=ts-node/esm'],
  timeout: '30s',
};
