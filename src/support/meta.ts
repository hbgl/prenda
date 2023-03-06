import { fileURLToPath } from 'url';

export function $dirname(url: string) {
  return fileURLToPath(new URL('.', url));
}

export function $filename(url: string) {
  return fileURLToPath(new URL(url));
}
