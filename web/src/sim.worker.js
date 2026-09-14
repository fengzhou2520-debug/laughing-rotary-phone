import { LifSimulator } from "./lif.js";
import { loadConnectome } from "./loadConnectome.js";

let connectome = null;
let sim = null;

function post(type, payload) {
  self.postMessage({ type, ...payload });
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === "load") {
      connectome = await loadConnectome(msg.dataBase, (p) =>
        post("load-progress", p)
      );
      sim = new LifSimulator(
        {
          n: connectome.n,
          rowPtr: connectome.rowPtr,
          colIdx: connectome.colIdx,
          weights: connectome.weights,
          bodyIds: connectome.bodyIds,
        },
        connectome.meta.params
      );
      // Don't transfer neurons array back — too large; UI loads catalog separately if needed
      post("loaded", {
        meta: connectome.meta,
        nTypes: Object.keys(connectome.typeIndex).length,
      });
      // Keep type index + neurons in worker for resolve queries
    } else if (msg.type === "resolve") {
      const indices = resolveTargets(msg.query);
      post("resolved", { query: msg.query, indices, count: indices.length });
    } else if (msg.type === "run") {
      if (!sim) throw new Error("Connectome not loaded");
      const excite = msg.exciteIndices || [];
      const silence = msg.silenceIndices || [];
      sim.setStimulus({
        excite,
        exciteHz: msg.exciteHz ?? 150,
        silence,
      });
      const result = sim.run(msg.durationMs ?? 500, {
        onProgress: (frac) => post("run-progress", { frac }),
        recordEvents: msg.recordEvents !== false,
        maxEvents: msg.maxEvents ?? 1_500_000,
      });
      // Enrich top neurons with metadata
      const neu = connectome.neurons;
      const enriched = result.active.slice(0, msg.topK ?? 500).map((a) => {
        const m = neu[a.i];
        return {
          ...a,
          type: m?.type ?? null,
          instance: m?.instance ?? null,
          nt: m?.nt ?? null,
          superclass: m?.superclass ?? null,
        };
      });
      post("result", {
        durationMs: result.durationMs,
        nSpikes: result.nSpikes,
        nActive: result.nActive,
        active: enriched,
        events: result.events,
      });
    } else if (msg.type === "catalog") {
      post("catalog", {
        neurons: connectome.neurons,
        typeIndex: connectome.typeIndex,
      });
    }
  } catch (err) {
    post("error", { message: err.message || String(err), stack: err.stack });
  }
};

function resolveTargets(query) {
  if (!connectome) return [];
  const { typeIndex, bodyToIdx, neurons } = connectome;
  if (!query) return [];
  if (Array.isArray(query)) {
    const out = [];
    for (const q of query) out.push(...resolveTargets(q));
    return [...new Set(out)];
  }
  if (typeof query === "number") {
    if (bodyToIdx.has(query)) return [bodyToIdx.get(query)];
    if (query >= 0 && query < connectome.n) return [query];
    return [];
  }
  const q = String(query).trim();
  if (!q) return [];
  // bodyId:
  if (/^\d+$/.test(q)) {
    const id = Number(q);
    if (bodyToIdx.has(id)) return [bodyToIdx.get(id)];
  }
  // exact type
  if (typeIndex[q]) return typeIndex[q].slice();
  // instance exact / prefix
  const lower = q.toLowerCase();
  const hits = [];
  for (let i = 0; i < neurons.length; i++) {
    const n = neurons[i];
    if (n.type && n.type.toLowerCase() === lower) hits.push(i);
    else if (n.instance && n.instance.toLowerCase() === lower) hits.push(i);
    else if (n.instance && n.instance.toLowerCase().startsWith(lower)) hits.push(i);
  }
  if (hits.length) return hits;
  // substring type match
  for (const [typ, idxs] of Object.entries(typeIndex)) {
    if (typ.toLowerCase().includes(lower)) hits.push(...idxs);
  }
  return [...new Set(hits)];
}
