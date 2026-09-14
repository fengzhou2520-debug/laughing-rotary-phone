/** Load and gunzip Male CNS connectome binaries from /data. */

async function fetchBytes(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (onProgress && total) onProgress(Math.min(1, received / total));
  }
  return concat(chunks);
}

function concat(chunks) {
  let n = 0;
  for (const c of chunks) n += c.byteLength;
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

function isGzip(bytes) {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function gunzip(bytes) {
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Fetch a file that may be served as raw gzip bytes OR already decoded by the
 * host (some static servers set Content-Encoding: gzip for *.gz).
 */
async function fetchGz(url, onProgress) {
  const bytes = await fetchBytes(url, onProgress);
  if (isGzip(bytes)) return gunzip(bytes);
  return bytes;
}

export async function loadConnectome(dataBase, onProgress = () => {}) {
  const meta = await (await fetch(`${dataBase}/meta.json`)).json();
  const files = meta.files;
  const n = meta.n_neurons;

  const report = (label, frac) => onProgress({ label, frac });

  report("row pointers", 0);
  const rowPtrBuf = await fetchGz(`${dataBase}/${files.row_ptr}`, (f) =>
    report("row pointers", f)
  );
  const rowPtr = new Uint32Array(
    rowPtrBuf.buffer,
    rowPtrBuf.byteOffset,
    rowPtrBuf.byteLength / 4
  );

  report("synapse targets", 0);
  const colBuf = await fetchGz(`${dataBase}/${files.col_idx}`, (f) =>
    report("synapse targets", f)
  );
  const colIdx = new Uint32Array(colBuf.buffer, colBuf.byteOffset, colBuf.byteLength / 4);

  report("synapse weights", 0);
  const wBuf = await fetchGz(`${dataBase}/${files.weights}`, (f) =>
    report("synapse weights", f)
  );
  const weights = new Int16Array(wBuf.buffer, wBuf.byteOffset, wBuf.byteLength / 2);

  report("body IDs", 0);
  const bodyBuf = await fetchGz(`${dataBase}/${files.body_ids}`, (f) =>
    report("body IDs", f)
  );
  const bodyIds = new BigUint64Array(
    bodyBuf.buffer,
    bodyBuf.byteOffset,
    bodyBuf.byteLength / 8
  );

  report("neuron catalog", 0);
  const neuBuf = await fetchGz(`${dataBase}/${files.neurons_meta}`, (f) =>
    report("neuron catalog", f)
  );
  const neuText = new TextDecoder().decode(neuBuf);
  const neurons = neuText
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  report("type index", 0);
  const typeBuf = await fetchGz(`${dataBase}/${files.type_index}`, (f) =>
    report("type index", f)
  );
  const typeIndex = JSON.parse(new TextDecoder().decode(typeBuf));

  if (rowPtr.length !== n + 1) {
    throw new Error(`row_ptr length ${rowPtr.length} != n+1 (${n + 1})`);
  }
  if (colIdx.length !== meta.n_synapses || weights.length !== meta.n_synapses) {
    throw new Error("synapse array length mismatch");
  }

  const bodyToIdx = new Map();
  for (let i = 0; i < n; i++) bodyToIdx.set(Number(bodyIds[i]), i);

  report("ready", 1);
  return {
    meta,
    n,
    rowPtr,
    colIdx,
    weights,
    bodyIds,
    neurons,
    typeIndex,
    bodyToIdx,
  };
}
