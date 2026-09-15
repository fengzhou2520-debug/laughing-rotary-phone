/**
 * Realtime whole-CNS LIF over the Janelia Male CNS connectome.
 * Kernel shape follows infinite-sugar / desktop-fly (1 ms steps, delayed inhibition);
 * wiring + E/I signs are the Male CNS Traced graph. Gains are hand-tuned for embodiment.
 */
import { dataBase } from "./paths.js";
import { buildRoles, STIM_MAP } from "./roles.js";

const DECAY = Math.fround(Math.exp(-1 / 20));
const THRESH = 1.0;
const REFRACT = 2;
const INH_DELAY = 4;
const INH_SLOTS = INH_DELAY + 1;
// Gains tuned for Male CNS scale (~25M edges). Stronger than Shiu batch LIF would
// saturate the browser; embodiment needs sparse enough spikes for realtime.
const WSCALE = 0.0016;
const BASE_MAX = 0.035;
const NOISE_PER_STEP = 120;
const NOISE_KICK = 0.32;

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

async function fetchGz(url, onProgress) {
  const bytes = await fetchBytes(url, onProgress);
  return isGzip(bytes) ? gunzip(bytes) : bytes;
}

export class Brain {
  constructor(meta, indptr, colidx, w, neurons, roles) {
    this.meta = meta;
    this.N = meta.n_neurons;
    this.E = meta.n_synapses;
    this.indptr = indptr;
    this.colidx = colidx;
    this.w = w;
    this.neurons = neurons;

    const N = this.N;
    this.v = new Float32Array(N);
    this.refr = new Uint8Array(N);
    this.baseline = new Float32Array(N);
    let s = 22222;
    const rnd = () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
    for (let i = 0; i < N; i++) this.baseline[i] = rnd() * BASE_MAX;
    this._rng = s;

    this.inhVal = [];
    this.inhIdx = [];
    this.inhCnt = new Int32Array(INH_SLOTS);
    for (let k = 0; k < INH_SLOTS; k++) {
      this.inhVal.push(new Float32Array(N));
      this.inhIdx.push(new Int32Array(Math.min(N, 262144)));
    }
    this.spiked = new Int32Array(N);
    this.lastSpikeMs = new Float64Array(N).fill(-Infinity);
    this.slot = 0;
    this.ms = 0;
    this.totalSpikes = 0;

    this.groups = {};
    for (const [k, arr] of Object.entries(roles)) {
      this.groups[k] = Int32Array.from(arr);
    }
    // Prefer primary motor labels when a neuron appears in multiple role lists.
    const priority = [
      "mn_proboscis",
      "mn_neck_l",
      "mn_neck_r",
      "mn_antenna_l",
      "mn_antenna_r",
      "mn_leg_flex_l",
      "mn_leg_flex_r",
      "mn_leg_ext_l",
      "mn_leg_ext_r",
      "mn_leg_stance_l",
      "mn_leg_stance_r",
      "mn_leg_tarsus_l",
      "mn_leg_tarsus_r",
      "mn_leg_ltm_l",
      "mn_leg_ltm_r",
      "mn_wing_l",
      "mn_wing_r",
      "mn_abdomen_l",
      "mn_abdomen_r",
      "dn_escwing_l",
      "dn_escwing_r",
      "dn_steer_l",
      "dn_steer_r",
      "dn_groom",
      "dn_walk",
      "dn_gf",
      "grn_sweet",
      "grn_sweet_leg",
      "pam",
    ];
    const ordered = [
      ...priority.filter((k) => this.groups[k]),
      ...Object.keys(this.groups).filter((k) => !priority.includes(k)),
    ];
    // Skip aliases that duplicate another pool for roleOf ownership.
    this.skipRoleOf = new Set([
      "mn_ingestion",
      "mn_neck",
      "mn_antenna",
      "mn_leg_flex",
      "mn_leg_ext",
      "mn_leg_stance",
      "mn_leg_tarsus",
      "mn_leg_ltm",
      "mn_wing",
      "mn_abdomen",
      "dn_steer",
      "dn_escwing",
    ]);
    this.roleNames = ordered;
    this.roleOf = new Int8Array(N).fill(-1);
    this.roleNames.forEach((k, ri) => {
      if (this.skipRoleOf.has(k)) return;
      for (const i of this.groups[k]) {
        if (this.roleOf[i] < 0) this.roleOf[i] = ri;
      }
    });

    this.rate = {};
    for (const k of this.roleNames) this.rate[k] = 0;
    this._cnt = new Int32Array(this.roleNames.length);
    this.popRate = 0;
    this.rateAlpha = 1 / 25;

    this.STIM = STIM_MAP;
    this.stim = {};
    for (const k of Object.keys(this.STIM)) this.stim[k] = 0;
    this.stimDrive = 0.14;
    this._active = [];
    this.sugar = 0;
    this.feedSpikes = 0;
    this.sugarFeedSpikes = 0;
    this.rest = null;
  }

  static async load(base = dataBase(), say = () => {}) {
    say("fetching Male CNS connectome");
    const meta = await (await fetch(`${base}/meta.json`)).json();
    say(
      `connectome: ${meta.n_neurons.toLocaleString()} neurons, ${meta.n_synapses.toLocaleString()} synapses`
    );

    const files = meta.files;
    const report = (label) => (f) => say(`${label}… ${Math.round(f * 100)}%`);

    const [indptrBuf, colBuf, wBuf, neuBuf, typeBuf] = await Promise.all([
      fetchGz(`${base}/${files.row_ptr}`, report("row pointers")),
      fetchGz(`${base}/${files.col_idx}`, report("synapse targets")),
      fetchGz(`${base}/${files.weights}`, report("synapse weights")),
      fetchGz(`${base}/${files.neurons_meta}`, report("neuron catalog")),
      fetchGz(`${base}/${files.type_index}`, report("type index")),
    ]);

    say("unpacking full Male CNS CSR");
    const indptr = new Uint32Array(
      indptrBuf.buffer,
      indptrBuf.byteOffset,
      indptrBuf.byteLength / 4
    );
    const colidx = new Uint32Array(
      colBuf.buffer,
      colBuf.byteOffset,
      colBuf.byteLength / 4
    );
    const w2 = new Int16Array(wBuf.buffer, wBuf.byteOffset, wBuf.byteLength / 2);
    if (indptr.length !== meta.n_neurons + 1) {
      throw new Error(
        `row_ptr length ${indptr.length} != n_neurons+1 (${meta.n_neurons + 1})`
      );
    }
    if (colidx.length !== meta.n_synapses || w2.length !== meta.n_synapses) {
      throw new Error(
        `synapse arrays ${colidx.length}/${w2.length} != n_synapses ${meta.n_synapses}`
      );
    }
    if (indptr[meta.n_neurons] !== meta.n_synapses) {
      throw new Error(
        `CSR row_ptr end ${indptr[meta.n_neurons]} != n_synapses ${meta.n_synapses}`
      );
    }
    const w = new Float32Array(w2.length);
    const k = WSCALE;
    for (let i = 0; i < w2.length; i++) w[i] = w2[i] * k;

    say("building motor / sensory roles");
    const neurons = new TextDecoder()
      .decode(neuBuf)
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    if (neurons.length !== meta.n_neurons) {
      throw new Error(
        `neuron catalog ${neurons.length} != n_neurons ${meta.n_neurons}`
      );
    }
    const typeIndex = JSON.parse(new TextDecoder().decode(typeBuf));
    const roles = buildRoles(neurons, typeIndex);

    return new Brain(meta, indptr, colidx, w, neurons, roles);
  }

  setStim(name, level) {
    if (!(name in this.stim)) return;
    this.stim[name] = level;
    this._active = [];
    for (const k of Object.keys(this.stim)) {
      const lv = this.stim[k];
      if (lv <= 0) continue;
      for (const r of this.STIM[k]) {
        const g = this.groups[r];
        if (g?.length) this._active.push({ idx: g, amt: lv * this.stimDrive });
      }
    }
    // Supplied sugar→feeding / walk reflex gains (Male CNS sugar path does not
    // strongly recruit these pools under the realtime kernel alone).
    if (this.stim.sweet > 0) {
      const boost = this.stim.sweet * this.stimDrive * 0.45;
      for (const r of [
        "mn_proboscis",
        "mn_ingestion",
        "dn_walk",
        "dn_groom",
        "mn_leg_flex",
        "mn_leg_ext",
        "mn_leg_stance",
        "mn_leg_tarsus",
        "mn_leg_ltm",
        "mn_wing",
        "mn_abdomen",
        "pam",
      ]) {
        const g = this.groups[r];
        if (g?.length) this._active.push({ idx: g, amt: boost });
      }
      const steerBoost = this.stim.sweet * this.stimDrive * 0.25;
      for (const r of ["dn_steer_l", "dn_steer_r", "mn_neck_l", "mn_neck_r", "mn_antenna_l", "mn_antenna_r"]) {
        const g = this.groups[r];
        if (g?.length) this._active.push({ idx: g, amt: steerBoost });
      }
    }
    this.sugar = this.stim.sweet;
  }

  calibrate(ms = 2500) {
    const saved = { ...this.stim };
    for (const k of Object.keys(this.stim)) this.setStim(k, 0);
    this.step(ms);
    this.rest = {};
    for (const k of this.roleNames) this.rest[k] = Math.max(0.5, this.rate[k] || 0.5);
    for (const [k, v] of Object.entries(saved)) this.setStim(k, v);
    return this.rest;
  }

  async calibrateResponsive(ms = 2500) {
    const saved = { ...this.stim };
    for (const k of Object.keys(this.stim)) this.setStim(k, 0);
    for (let elapsed = 0; elapsed < ms; elapsed += 25) {
      this.step(Math.min(25, ms - elapsed));
      await new Promise((r) => setTimeout(r, 0));
    }
    this.calibrate(0);
    for (const [k, v] of Object.entries(saved)) this.setStim(k, v);
    return this.rest;
  }

  _rand() {
    let s = this._rng;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this._rng = s;
    return s >>> 0;
  }

  step(n) {
    const {
      N,
      v,
      refr,
      baseline,
      indptr,
      colidx,
      w,
      spiked,
      inhVal,
      inhIdx,
      inhCnt,
    } = this;
    const active = this._active;
    const rFeedA = this.roleNames.indexOf("mn_proboscis");
    const rFeedB = this.roleNames.indexOf("mn_ingestion");

    for (let it = 0; it < n; it++) {
      const slot = this.slot;

      const q = inhVal[slot];
      const qi = inhIdx[slot];
      const qn = inhCnt[slot];
      for (let k = 0; k < qn; k++) {
        const j = qi[k];
        const nv = v[j] + q[j];
        v[j] = nv < -2 ? -2 : nv;
        q[j] = 0;
      }
      inhCnt[slot] = 0;

      for (let k = 0; k < NOISE_PER_STEP; k++) v[this._rand() % N] += NOISE_KICK;

      for (let a = 0; a < active.length; a++) {
        const idx = active[a].idx;
        const amt = active[a].amt;
        for (let k = 0; k < idx.length; k++) v[idx[k]] += amt;
      }

      let ns = 0;
      for (let i = 0; i < N; i++) {
        const r = refr[i];
        if (r !== 0) {
          refr[i] = r - 1;
          v[i] *= DECAY;
          continue;
        }
        const vi = v[i] * DECAY + baseline[i];
        if (vi >= THRESH) {
          v[i] = 0;
          refr[i] = REFRACT;
          spiked[ns++] = i;
        } else v[i] = vi;
      }

      const is = (slot + INH_DELAY) % INH_SLOTS;
      const iq = inhVal[is];
      let iqi2 = this.inhIdx[is];
      let ic = inhCnt[is];
      // Deliver every outgoing synapse of every spiking neuron (full Male CNS CSR).
      for (let s = 0; s < ns; s++) {
        const i = spiked[s];
        const a = indptr[i];
        const b = indptr[i + 1];
        for (let k = a; k < b; k++) {
          const j = colidx[k];
          const x = w[k];
          if (x >= 0) {
            const nv = v[j] + x;
            v[j] = nv < -2 ? -2 : nv;
          } else {
            if (iq[j] === 0) {
              if (ic >= iqi2.length) {
                const bigger = new Int32Array(
                  Math.min(N, Math.max(iqi2.length * 2, ic + 1024))
                );
                bigger.set(iqi2.subarray(0, ic));
                this.inhIdx[is] = bigger;
                iqi2 = bigger;
              }
              iqi2[ic++] = j;
            }
            iq[j] += x;
          }
        }
      }
      inhCnt[is] = ic;

      this._cnt.fill(0);
      for (let s = 0; s < ns; s++) {
        const i = spiked[s];
        this.lastSpikeMs[i] = this.ms;
        const r = this.roleOf[i];
        if (r >= 0) this._cnt[r]++;
      }
      for (let r = 0; r < this.roleNames.length; r++) {
        const k = this.roleNames[r];
        if (this.skipRoleOf.has(k)) continue;
        const n0 = this.groups[k].length || 1;
        this.rate[k] += (this._cnt[r] * 1000 / n0 - this.rate[k]) * this.rateAlpha;
      }
      // Aggregate aliases from side / primary pools
      const avg = (a, b) => ((this.rate[a] || 0) + (this.rate[b] || 0)) / 2;
      this.rate.mn_ingestion = this.rate.mn_proboscis || 0;
      this.rate.mn_neck = avg("mn_neck_l", "mn_neck_r");
      this.rate.mn_antenna = avg("mn_antenna_l", "mn_antenna_r");
      this.rate.mn_leg_flex = avg("mn_leg_flex_l", "mn_leg_flex_r");
      this.rate.mn_leg_ext = avg("mn_leg_ext_l", "mn_leg_ext_r");
      this.rate.mn_leg_stance = avg("mn_leg_stance_l", "mn_leg_stance_r");
      this.rate.mn_leg_tarsus = avg("mn_leg_tarsus_l", "mn_leg_tarsus_r");
      this.rate.mn_leg_ltm = avg("mn_leg_ltm_l", "mn_leg_ltm_r");
      this.rate.mn_wing = avg("mn_wing_l", "mn_wing_r");
      this.rate.mn_abdomen = avg("mn_abdomen_l", "mn_abdomen_r");
      this.rate.dn_steer = avg("dn_steer_l", "dn_steer_r");
      this.rate.dn_escwing = avg("dn_escwing_l", "dn_escwing_r");
      const feeding =
        (rFeedA >= 0 ? this._cnt[rFeedA] : 0) + (rFeedB >= 0 ? this._cnt[rFeedB] : 0);
      this.feedSpikes += feeding;
      if (this.sugar > 0) this.sugarFeedSpikes += feeding;
      this.popRate += (ns * 1000 / N - this.popRate) * this.rateAlpha;

      this.totalSpikes += ns;
      this.ms++;
      this.slot = (slot + 1) % INH_SLOTS;
    }
  }
}
