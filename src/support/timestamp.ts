export function secsToHrTime(secs: number) {
  const whole = Math.floor(secs);
  const fraction = secs - whole;
  const hr = BigInt(whole) * BigInt(1000000) + BigInt(Math.floor(fraction * 1000000));
  return hr;
}
