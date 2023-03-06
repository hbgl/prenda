import * as os from 'node:os';

export interface AsyncMapOptions {
  maxConcurrency?: number;
}

export async function asyncMap<TInput, TResult>(
  inputs: TInput[],
  selector: (input: TInput, index: number) => Promise<TResult>,
  options?: AsyncMapOptions
) {
  options = options ?? {};
  const maxConcurrency = Math.max(Math.min(options.maxConcurrency ?? os.cpus().length, inputs.length), 1);

  const results: TResult[] = [];
  let i = 0;
  const workers = Array.from({ length: maxConcurrency }).map(async () => {
    while (i < inputs.length) {
      const index = i;
      const input = inputs[index];
      i++;
      results[index] = await selector(input, index);
    }
  });

  await Promise.all(workers);

  return results;
}
