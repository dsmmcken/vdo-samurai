// Assembles kernels.wat into kernels.wasm (build-time only; wabt isn't shipped).
import fs from 'node:fs';
import initWabt from 'wabt';
const wabt = await initWabt();
const mod = wabt.parseWat('kernels.wat', fs.readFileSync(new URL('./kernels.wat', import.meta.url), 'utf8'), { simd: true, bulk_memory: true });
mod.validate();
const { buffer } = mod.toBinary({});
fs.writeFileSync(new URL('./kernels.wasm', import.meta.url), buffer);
console.log(`kernels.wasm: ${buffer.length} bytes`);
