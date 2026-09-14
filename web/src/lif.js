/**
 * Full Male CNS LIF simulator — Shiu et al. (Nature 2024 / PMC10187186).
 * Uses every Traced Male CNS neuron and every synapse between them.
 *
 *   dv/dt = (v_rest - v + g) / tau_mem
 *   dg/dt = -g / tau_syn
 *   on pre spike (+t_delay): g += w_syn * signed_synapse_count
 *   Poisson drive → v with weight w_syn * scalePoisson (no refractory)
 */

export const DEFAULT_PARAMS = {
  v0: -52.0,
  vReset: -52.0,
  vRest: -52.0,
  vThreshold: -45.0,
  tauMem: 20.0,
  tauSyn: 5.0,
  tRefrac: 2.2,
  tDelay: 1.8,
  scalePoisson: 250,
  wScale: 0.275,
  dt: 0.1,
};

export class LifSimulator {
  constructor(connectome, params = {}) {
    this.n = connectome.n;
    this.rowPtr = connectome.rowPtr;
    this.colIdx = connectome.colIdx;
    this.weights = connectome.weights;
    this.bodyIds = connectome.bodyIds;
    this.params = { ...DEFAULT_PARAMS, ...params };

    const { n } = this;
    this.delaySteps = Math.max(1, Math.round(this.params.tDelay / this.params.dt));
    this.refracSteps = Math.max(1, Math.round(this.params.tRefrac / this.params.dt));

    this.v = new Float32Array(n);
    this.g = new Float32Array(n);
    this.refrac = new Int16Array(n);
    this.rates = new Float32Array(n);
    this.silenced = new Uint8Array(n);
    this.driven = new Uint8Array(n);

    // Ring of sparse PSC deliveries: each slot is a list of (postIndex, amplitude)
    this.delaySlots = Array.from({ length: this.delaySteps }, () => ({
      idx: [],
      amp: [],
    }));
    this.delayWrite = 0;

    this.pendingSpikes = [];
    this.active = [];
    this.isActive = new Uint8Array(n);
    this.spikeCounts = new Uint32Array(n);
    this.eventT = [];
    this.eventI = [];

    // Scratch for coalescing outgoing synaptic current this step
    this._curAmp = new Float32Array(n);
    this._curTouched = [];

    this.memFactor = this.params.dt / this.params.tauMem;
    this.synDecay = 1 - this.params.dt / this.params.tauSyn;
    this.pScale = this.params.dt / 1000.0;
    this.stimW = this.params.wScale * this.params.scalePoisson;
    this.reset();
  }

  reset() {
    this.v.fill(this.params.v0);
    this.g.fill(0);
    this.refrac.fill(0);
    for (const slot of this.delaySlots) {
      slot.idx.length = 0;
      slot.amp.length = 0;
    }
    this.delayWrite = 0;
    this.pendingSpikes.length = 0;
    this.active.length = 0;
    this.isActive.fill(0);
    this.spikeCounts.fill(0);
    this.eventT.length = 0;
    this.eventI.length = 0;
    this.timeMs = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.driven[i]) this._activate(i);
    }
  }

  _activate(i) {
    if (!this.isActive[i]) {
      this.isActive[i] = 1;
      this.active.push(i);
    }
  }

  setStimulus({ excite = [], exciteHz = 150, silence = [] } = {}) {
    this.rates.fill(0);
    this.silenced.fill(0);
    this.driven.fill(0);
    for (const i of excite) {
      if (i >= 0 && i < this.n) {
        this.rates[i] = exciteHz;
        this.driven[i] = 1;
        this._activate(i);
      }
    }
    for (const i of silence) {
      if (i >= 0 && i < this.n) this.silenced[i] = 1;
    }
  }

  step(recordEvents = true) {
    const {
      v,
      g,
      refrac,
      rates,
      silenced,
      driven,
      rowPtr,
      colIdx,
      weights,
      params,
      memFactor,
      synDecay,
      refracSteps,
      pScale,
      stimW,
      _curAmp,
      _curTouched,
    } = this;

    // --- Synaptic currents from last step's spikes → enqueue at delayWrite ---
    for (const i of this.pendingSpikes) {
      if (silenced[i]) continue;
      const a = rowPtr[i];
      const b = rowPtr[i + 1];
      for (let e = a; e < b; e++) {
        const j = colIdx[e];
        if (silenced[j]) continue;
        if (_curAmp[j] === 0) _curTouched.push(j);
        _curAmp[j] += weights[e] * params.wScale;
      }
    }

    const slot = this.delaySlots[this.delayWrite];
    // Apply PSCs that were written delaySteps ago (this slot is due)
    for (let k = 0; k < slot.idx.length; k++) {
      const j = slot.idx[k];
      if (silenced[j]) continue;
      if (refrac[j] <= 0) g[j] += slot.amp[k];
      this._activate(j);
    }
    // Replace slot contents with newly generated currents
    slot.idx.length = 0;
    slot.amp.length = 0;
    for (const j of _curTouched) {
      slot.idx.push(j);
      slot.amp.push(_curAmp[j]);
      _curAmp[j] = 0;
      this._activate(j);
    }
    _curTouched.length = 0;
    this.delayWrite = (this.delayWrite + 1) % this.delaySteps;

    // --- LIF update on active set ---
    const oldActive = this.active;
    const nextActive = [];
    this.pendingSpikes = [];

    for (let k = 0; k < oldActive.length; k++) {
      const i = oldActive[k];
      this.isActive[i] = 0;

      if (silenced[i]) {
        v[i] = params.vRest;
        g[i] = 0;
        refrac[i] = 0;
        continue;
      }

      let gi = g[i] * synDecay;
      g[i] = gi;

      let stim = 0;
      const r = rates[i];
      if (r > 0 && Math.random() < r * pScale) stim = stimW;

      let vi = v[i] + stim;
      vi = vi + memFactor * (gi - (vi - params.vRest));

      let keep = driven[i] !== 0;

      if (refrac[i] > 0) {
        refrac[i] -= 1;
        v[i] = params.vReset;
        keep = true;
      } else if (vi > params.vThreshold) {
        v[i] = params.vReset;
        g[i] = 0;
        refrac[i] = driven[i] ? 0 : refracSteps;
        this.spikeCounts[i] += 1;
        this.pendingSpikes.push(i);
        if (recordEvents) {
          this.eventT.push(this.timeMs);
          this.eventI.push(i);
        }
        keep = true;
      } else {
        v[i] = vi;
        if (Math.abs(gi) > 1e-4 || Math.abs(vi - params.vRest) > 1e-3) keep = true;
      }

      if (keep) {
        this.isActive[i] = 1;
        nextActive.push(i);
      }
    }

    // Neurons activated only via delay enqueue this step may not be in nextActive yet
    for (let k = 0; k < slot.idx.length; k++) {
      const j = slot.idx[k];
      if (!this.isActive[j] && !silenced[j]) {
        this.isActive[j] = 1;
        nextActive.push(j);
      }
    }

    this.active = nextActive;
    this.timeMs += params.dt;
  }

  run(durationMs, { onProgress = null, recordEvents = true, maxEvents = 2_000_000 } = {}) {
    this.reset();
    const steps = Math.round(durationMs / this.params.dt);
    const reportEvery = Math.max(1, Math.floor(steps / 40));
    for (let s = 0; s < steps; s++) {
      const allow = recordEvents && this.eventT.length < maxEvents;
      this.step(allow);
      if (onProgress && s % reportEvery === 0) onProgress(s / steps);
    }
    if (onProgress) onProgress(1);
    return this.getResults(durationMs);
  }

  getResults(durationMs) {
    const active = [];
    for (let i = 0; i < this.n; i++) {
      const c = this.spikeCounts[i];
      if (c > 0) {
        active.push({
          i,
          bodyId: Number(this.bodyIds[i]),
          count: c,
          rateHz: c / (durationMs / 1000),
        });
      }
    }
    active.sort((a, b) => b.rateHz - a.rateHz);
    const events = new Array(this.eventT.length);
    for (let k = 0; k < this.eventT.length; k++) {
      events[k] = { t: this.eventT[k], i: this.eventI[k] };
    }
    return {
      durationMs,
      nSpikes: this.eventT.length,
      nActive: active.length,
      active,
      events,
    };
  }
}
