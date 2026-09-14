import fs from "fs";
import zlib from "zlib";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "web/public/data");

function readGz(name) {
  return zlib.gunzipSync(fs.readFileSync(path.join(dataDir, name)));
}
const meta = JSON.parse(fs.readFileSync(path.join(dataDir, "meta.json"), "utf8"));
const typeBuf = readGz(meta.files.type_index);
const typeIndex = JSON.parse(typeBuf.toString("utf8"));

const types = Object.keys(typeIndex);

console.log("SENSORY TYPES:");
console.log(types.filter(t => t.toLowerCase().includes("grn") || t.toLowerCase().includes("orn") || t.toLowerCase().includes("sensory")).slice(0, 50));

console.log("MOTOR TYPES:");
console.log(types.filter(t => t.toLowerCase().includes("mn") || t.toLowerCase().includes("motor neuron")).slice(0, 50));
