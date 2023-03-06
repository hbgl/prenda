import * as crypto from 'node:crypto';

const randomStringChars = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-.'];

export function randomString64(length: number) {
  let string = '';
  const bytes = crypto.randomBytes(length);
  for (let n = 0; n < length; n++) {
    const i = bytes[n] & 0b111111;
    const c = randomStringChars[i];
    string += c;
  }
  return string;
}
