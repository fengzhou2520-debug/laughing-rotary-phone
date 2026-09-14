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
const { buildRoles, STIM_MAP } = await import(rolesUrl);
const roles = buildRoles(neurons, typeIndex);

const brainUrl = pathToFileURL(path.join(root, "web/src/brain.js")).href;
const { Brain } = await import(brainUrl);

// Create brain instance
const indptr = new Uint32Array(rowPtr.buffer, rowPtr.byteOffset, rowPtr.byteLength / 4);
const colidx = new Uint32Array(colIdx.buffer, colIdx.byteOffset, colIdx.byteLength / 4);
const w = new Float32Array(weights.length);
const WSCALE = 0.0016;
for (let i = 0; i < weights.length; i++) w[i] = weights[i] * WSCALE;

const testStimuli = ["sweet", "bitter", "odour", "touch", "heat", "damp", "light", "looming"];
const motorRoles = [
  "mn_proboscis",
  "mn_neck",
  "mn_antenna",
  "mn_leg_flex",
  "mn_leg_ext",
  "mn_wing",
  "dn_escwing",
  "dn_groom",
  "dn_steer",
  "dn_walk"
];

for (const stimName of testStimuli) {
  const brain = new Brain(meta, indptr, colidx, w, neurons, roles);
  // Calibrate first
  brain.calibrate(500);

  // Directly activate sensory groups for this stimulus (bypassing sweet hardcoded motor boost)
  brain._active = [];
  const rolesForStim = STIM_MAP[stimName];
  if (rolesForStim) {
    for (const r of rolesForStim) {
      const g = brain.groups[r];
      if (g?.length) {
        brain._active.push({ idx: g, amt: 1.0 }); // Use strong stimulus drive
      }
    }
  }

  brain.step(500);
  console.log(`\n--- Stimulating ${stimName.toUpperCase()} (only sensory neurons) ---`);
  console.log("Motor/Descending rates after 500ms:");
  let firingCount = 0;
  for (const mr of motorRoles) {
    const rate = brain.rate[mr] || 0;
    if (rate > 0.01) {
      firingCount++;
    }
    console.log(`  - ${mr}: ${rate.toFixed(4)} Hz`);
  }
  if (firingCount === 0) {
    console.log("  (No motor/descending pools fired)");
  }
}
