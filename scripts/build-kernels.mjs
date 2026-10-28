// Assembles src/lib/face/kernels.wat into kernels.wasm (the committed binary).
// Only needed after editing the .wat: npm run build:kernels
import fs from 'node:fs';
import initWabt from 'wabt';

const src = new URL('../src/lib/face/kernels.wat', import.meta.url);
const wabt = await initWabt();
const mod = wabt.parseWat('kernels.wat', fs.readFileSync(src, 'utf8'), { simd: true, bulk_memory: true });
mod.validate();
const { buffer } = mod.toBinary({});
fs.writeFileSync(new URL('../src/lib/face/kernels.wasm', import.meta.url), buffer);
console.log(`kernels.wasm: ${buffer.length} bytes`);
