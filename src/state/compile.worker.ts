/// <reference lib="webworker" />
import { compileAll, type CompileInput } from './compile';

// Runs the heavy part (building 20+ animations, JSON + gzip for sizes) off the main thread.
self.onmessage = (e: MessageEvent<{ seq: number; input: CompileInput }>) => {
  const { seq, input } = e.data;
  try {
    self.postMessage({ seq, output: compileAll(input) });
  } catch (err) {
    self.postMessage({ seq, error: err instanceof Error ? err.message : String(err) });
  }
};
