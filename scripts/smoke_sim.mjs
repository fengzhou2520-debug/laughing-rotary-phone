/**
 * Smoke-test LIF on the real Male CNS CSR (Node).
 * Usage: node scripts/smoke_sim.mjs
 */
import fs from "fs";
import zlib from "zlib";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "web/public/data");

function readGz(name) {
  return zlib.gunzipSync(fs.readFileSync(path.join(dataDir, name)));
}
function asU32(buf) { return new Uint32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4); }
function asI16(buf) { return new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2); }
function asU64(buf) { return new BigUint64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8); }

const meta = JSON.parse(fs.readFileSync(path.join(dataDir, "meta.json"), "utf8"));
const rowPtr = asU32(readGz(meta.files.row_ptr));
const colIdx = asU32(readGz(meta.files.col_idx));
const weights = asI16(readGz(meta.files.weights));
const bodyIds = asU64(readGz(meta.files.body_ids));
const typeIndex = JSON.parse(readGz(meta.files.type_index).toString("utf8"));

console.log("meta", meta.n_neurons, meta.n_synapses);
console.log("arrays", rowPtr.length, colIdx.length, weights.length, bodyIds.length);

const lifUrl = pathToFileURL(path.join(root, "web/src/lif.js")).href;
const { LifSimulator } = await import(lifUrl);

const sim = new LifSimulator(
  { n: meta.n_neurons, rowPtr, colIdx, weights, bodyIds },
  { ...meta.params, dt: 0.1 }
);

// Prefer excitatory (cholinergic) types — GABA/glutamate are inhibitory in fly
const candidates = ["Mi1", "ORN_DA1", "Tm3", "T4a", "KCg-m"];
let excite = [];
let chosen = null;
for (const t of candidates) {
  if (typeIndex[t]?.length) {
    chosen = t;
    excite = typeIndex[t].slice(0, 30);
    break;
  }
}
if (!excite.length) {
  // fallback: first type with >= 10 cells
  for (const [t, idxs] of Object.entries(typeIndex)) {
    if (idxs.length >= 10) {
      chosen = t;
      excite = idxs.slice(0, 20);
      break;
    }
  }
}

console.log("exciting", chosen, excite.length, "neurons");
sim.setStimulus({ excite, exciteHz: 150 });
const t0 = Date.now();
const result = sim.run(100, { recordEvents: true });
console.log(
  JSON.stringify(
    {
      ms: Date.now() - t0,
      nSpikes: result.nSpikes,
      nActive: result.nActive,
      top: result.active.slice(0, 8),
    },
    null,
    2
  )
);
