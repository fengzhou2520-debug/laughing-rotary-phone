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
const neuBuf = readGz(meta.files.neurons_meta);
const typeBuf = readGz(meta.files.type_index);

const neurons = neuBuf.toString("utf8").trim().split("\n").map(line => JSON.parse(line));
const typeIndex = JSON.parse(typeBuf.toString("utf8"));

const rolesUrl = pathToFileURL(path.join(root, "web/src/roles.js")).href;
const { buildRoles } = await import(rolesUrl);

const roles = buildRoles(neurons, typeIndex);
console.log("ROLE SIZES:");
for (const [k, v] of Object.entries(roles)) {
  console.log(`  - ${k}: ${v.length}`);
}
