import fs from "fs";
import zlib from "zlib";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "web/public/data");

function readGz(name) {
  return zlib.gunzipSync(fs.readFileSync(path.join(dataDir, name)));
}
const meta = JSON.parse(fs.readFileSync(path.join(dataDir, "meta.json"), "utf8"));
const rowPtr = new Uint32Array(readGz(meta.files.row_ptr).buffer);
const colIdx = new Uint32Array(readGz(meta.files.col_idx).buffer);
const weights = new Int16Array(readGz(meta.files.weights).buffer);
const bodyIds = new BigUint64Array(readGz(meta.files.body_ids).buffer);
const typeIndex = JSON.parse(readGz(meta.files.type_index).toString("utf8"));
const neuBuf = readGz(meta.files.neurons_meta);
const neurons = neuBuf.toString("utf8").trim().split("\n").map(line => JSON.parse(line));

const rolesUrl = pathToFileURL(path.join(root, "web/src/roles.js")).href;
const { buildRoles } = await import(rolesUrl);
const roles = buildRoles(neurons, typeIndex);

const brainUrl = pathToFileURL(path.join(root, "web/src/brain.js")).href;
const { Brain } = await import(brainUrl);

// Create brain instance
const indptr = new Uint32Array(rowPtr.buffer, rowPtr.byteOffset, rowPtr.byteLength / 4);
const colidx = new Uint32Array(colIdx.buffer, colIdx.byteOffset, colIdx.byteLength / 4);
const w = new Float32Array(weights.length);
const WSCALE = 0.0016;
for (let i = 0; i < weights.length; i++) w[i] = weights[i] * WSCALE;

const testAmts = [0.14, 0.5, 1.0, 1.5, 2.0, 3.0];
for (const amt of testAmts) {
  const brain = new Brain(meta, indptr, colidx, w, neurons, roles);
  brain.calibrate(500);

  brain._active = [];
  const sweet_g = brain.groups["grn_sweet"];
  const sweet_leg_g = brain.groups["grn_sweet_leg"];
  brain._active.push({ idx: sweet_g, amt: amt });
  brain._active.push({ idx: sweet_leg_g, amt: amt });

  brain.step(500);
  console.log(`\nSweet Stimulus Amt: ${amt}`);
  console.log(`  - mn_proboscis: ${brain.rate.mn_proboscis.toFixed(4)} Hz`);
  console.log(`  - mn_leg_flex:  ${brain.rate.mn_leg_flex.toFixed(4)} Hz`);
  console.log(`  - mn_leg_ext:   ${brain.rate.mn_leg_ext.toFixed(4)} Hz`);
  console.log(`  - dn_walk:      ${brain.rate.dn_walk.toFixed(4)} Hz`);
}
