/// <reference lib="webworker" />
import { createCompiler, type CompileInput } from './compile';

const compiler = createCompiler();

// Runs the heavy part (building the animations, JSON + gzip for sizes) off the main thread.
self.onmessage = (e: MessageEvent<{ seq: number; input: CompileInput; keep?: string[] }>) => {
  const { seq, input, keep } = e.data;
  try {
    self.postMessage({ seq, output: compiler.compile(input, keep) });
  } catch (err) {
    self.postMessage({ seq, error: err instanceof Error ? err.message : String(err) });
  }
};
