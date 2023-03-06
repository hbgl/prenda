// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PartialRecord<K extends keyof any, V> = {
  [P in K]?: V;
};

export function identity<T>(t: T) {
  return t;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Throwable = any;
