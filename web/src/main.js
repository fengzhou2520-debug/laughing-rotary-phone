import SimWorker from "./sim.worker.js?worker";
import { dataBase } from "./paths.js";

const $ = (id) => document.getElementById(id);

const state = {
  worker: null,
  loaded: false,
  lastResult: null,
  pendingResolve: null,
};

function fmt(n) {
  return Number(n).toLocaleString("en-US");
}

function setBar(barId, labelId, frac, label) {
  $(barId).style.width = `${Math.round(frac * 100)}%`;
  $(labelId).textContent = label;
}

function parseLines(text) {
  return text
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function drawRaster(canvas, events, durationMs, topNeurons) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#07110e";
  ctx.fillRect(0, 0, w, h);

  const ids = topNeurons.slice(0, 120).map((a) => a.i);
  if (!ids.length) {
    ctx.fillStyle = "#8fa398";
    ctx.font = "14px IBM Plex Mono";
    ctx.fillText("No spikes recorded", 24, 40);
    return;
  }
  const yIndex = new Map(ids.map((id, i) => [id, i]));
  const padL = 8;
  const padR = 8;
  const padT = 8;
  const padB = 8;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const rowH = plotH / ids.length;

  ctx.strokeStyle = "rgba(180,210,190,0.08)";
  ctx.beginPath();
  for (let i = 0; i <= 10; i++) {
    const x = padL + (plotW * i) / 10;
    ctx.moveTo(x, padT);
    ctx.lineTo(x, h - padB);
  }
  ctx.stroke();

  ctx.fillStyle = "#c4f061";
  for (const ev of events) {
    const yi = yIndex.get(ev.i);
    if (yi === undefined) continue;
    const x = padL + (ev.t / durationMs) * plotW;
    const y = padT + yi * rowH + rowH * 0.5;
    ctx.fillRect(x, y - 1, 1.5, Math.max(2, rowH * 0.55));
  }

  ctx.fillStyle = "#8fa398";
  ctx.font = "11px IBM Plex Mono";
  ctx.fillText(`0 ms`, padL, h - 2);
  ctx.fillText(`${durationMs} ms`, w - 70, h - 2);
  ctx.fillText(`${ids.length} most active neurons`, padL, 12);
}

function fillTable(active) {
  const body = $("rate-body");
  body.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const row of active.slice(0, 300)) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.rateHz.toFixed(1)}</td>
      <td>${row.count}</td>
      <td>${row.type ?? ""}</td>
      <td>${row.instance ?? ""}</td>
      <td>${row.nt ?? ""}</td>
      <td>${row.bodyId}</td>`;
    frag.appendChild(tr);
  }
  body.appendChild(frag);
}

function ensureWorker() {
  if (state.worker) return state.worker;
  const worker = new SimWorker();
  worker.onmessage = (ev) => {
    const msg = ev.data;
    if (msg.type === "load-progress") {
      $("load-progress").hidden = false;
      setBar(
        "load-bar",
        "load-label",
        msg.frac ?? 0,
        `Loading ${msg.label}… ${Math.round((msg.frac || 0) * 100)}%`
      );
    } else if (msg.type === "loaded") {
      state.loaded = true;
      $("stat-n").textContent = fmt(msg.meta.n_neurons);
      $("stat-e").textContent = fmt(msg.meta.n_synapses);
      $("stat-t").textContent = fmt(msg.nTypes);
      $("load-label").textContent = `Ready · ${fmt(msg.meta.n_neurons)} neurons · ${fmt(msg.meta.n_synapses)} synapses`;
      $("load-bar").style.width = "100%";
      $("btn-load").disabled = true;
      $("controls").hidden = false;
    } else if (msg.type === "resolved") {
      $("resolve-out").textContent = `Matched ${fmt(msg.count)} neuron(s) for “${Array.isArray(msg.query) ? msg.query.join(", ") : msg.query}”.`;
      if (state.pendingResolve) {
        state.pendingResolve(msg.indices);
        state.pendingResolve = null;
      }
    } else if (msg.type === "run-progress") {
      $("run-progress").hidden = false;
      setBar("run-bar", "run-label", msg.frac, `Simulating… ${Math.round(msg.frac * 100)}%`);
    } else if (msg.type === "result") {
      state.lastResult = msg;
      $("run-label").textContent = `Done · ${fmt(msg.nSpikes)} spikes · ${fmt(msg.nActive)} active neurons`;
      $("run-bar").style.width = "100%";
      $("viz").hidden = false;
      $("btn-export").disabled = false;
      $("btn-run").disabled = false;
      $("result-summary").textContent = `${msg.durationMs} ms · ${fmt(msg.nSpikes)} spikes · ${fmt(msg.nActive)} neurons above 0 Hz`;
      drawRaster($("raster"), msg.events, msg.durationMs, msg.active);
      fillTable(msg.active);
    } else if (msg.type === "error") {
      console.error(msg);
      alert(`Error: ${msg.message}`);
      $("btn-run").disabled = false;
      $("btn-load").disabled = false;
    }
  };
  state.worker = worker;
  return worker;
}

function resolveAsync(queries) {
  return new Promise((resolve) => {
    state.pendingResolve = resolve;
    ensureWorker().postMessage({ type: "resolve", query: queries });
  });
}

$("btn-load").addEventListener("click", () => {
  $("btn-load").disabled = true;
  $("load-progress").hidden = false;
  ensureWorker().postMessage({ type: "load", dataBase: dataBase() });
});

$("btn-resolve").addEventListener("click", async () => {
  if (!state.loaded) return;
  const queries = parseLines($("excite").value);
  await resolveAsync(queries);
});

$("btn-run").addEventListener("click", async () => {
  if (!state.loaded) return;
  $("btn-run").disabled = true;
  $("run-progress").hidden = false;
  setBar("run-bar", "run-label", 0, "Resolving targets…");

  const exciteQ = parseLines($("excite").value);
  const silenceQ = parseLines($("silence").value);
  let exciteIndices = await resolveAsync(exciteQ);
  const silenceIndices = silenceQ.length ? await resolveAsync(silenceQ) : [];
  const maxExcite = Math.max(1, Number($("max-excite").value) || 100);
  const matched = exciteIndices.length;
  if (exciteIndices.length > maxExcite) {
    exciteIndices = exciteIndices.slice(0, maxExcite);
  }

  if (!exciteIndices.length) {
    alert("No neurons matched the excite query.");
    $("btn-run").disabled = false;
    return;
  }

  $("resolve-out").textContent = `Exciting ${fmt(exciteIndices.length)} of ${fmt(matched)} matched · silencing ${fmt(silenceIndices.length)}`;

  ensureWorker().postMessage({
    type: "run",
    exciteIndices,
    silenceIndices,
    exciteHz: Number($("rate").value) || 150,
    durationMs: Number($("duration").value) || 200,
    recordEvents: true,
    topK: 500,
  });
});

$("btn-export").addEventListener("click", () => {
  const r = state.lastResult;
  if (!r) return;
  const lines = ["t_ms,neuron_index,body_id"];
  const bodyByI = new Map(r.active.map((a) => [a.i, a.bodyId]));
  for (const ev of r.events) {
    lines.push(`${ev.t},${ev.i},${bodyByI.get(ev.i) ?? ""}`);
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "male_cns_lif_spikes.csv";
  a.click();
  URL.revokeObjectURL(url);
});
