let audio: AudioContext | null = null;

export function unlockSound(): void {
  const context = audio ?? new AudioContext();
  audio = context;
  if (context.state === "suspended") void context.resume();
}

export function playAlert(tone: 1 | 2 | 3 = 1, volume = 1): void {
  const context = audio ?? new AudioContext();
  audio = context;
  if (context.state === "suspended") void context.resume();
  const level = Math.min(1, Math.max(0, volume));
  if (level === 0) return;
  if (tone === 2) {
    toneAt(context, 880, 0, 0.08, level);
    toneAt(context, 880, 0.14, 0.08, level);
    toneAt(context, 1175, 0.28, 0.16, level);
    return;
  }
  if (tone === 3) {
    toneAt(context, 523, 0, 0.45, level);
    toneAt(context, 784, 0.08, 0.35, level);
    return;
  }
  toneAt(context, 740, 0, 0.22, level);
  toneAt(context, 988, 0.14, 0.28, level);
}

function toneAt(context: AudioContext, frequency: number, at: number, length: number, volume: number): void {
  const start = context.currentTime + at;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const peak = Math.max(0.001, 0.4 * volume);
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + length + 0.02);
}
