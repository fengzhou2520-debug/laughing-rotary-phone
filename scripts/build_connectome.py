#!/usr/bin/env python3
"""
Build browser-ready Male CNS connectome assets for the LIF simulator.

Downloads (if missing) the official Janelia Male CNS v1.0 feather files:
  - body-annotations-male-cns-v1.0-minconf-0.5.feather
  - body-neurotransmitters-male-cns-v1.0.feather
  - connectome-weights-male-cns-v1.0-minconf-0.5.feather

Uses the FULL proofread neuronal graph: every status==Traced body and every
synapse between those bodies (no random subsampling / mock graphs).

E/I sign follows Shiu et al. (Nature 2024 / PMC10187186): GABA and glutamate
are inhibitory; acetylcholine and monoamines are excitatory.
"""

from __future__ import annotations

import argparse
import gzip
import json
import urllib.request
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.feather as feather

GCS = "https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome"
FILES = [
    "body-annotations-male-cns-v1.0-minconf-0.5.feather",
    "body-neurotransmitters-male-cns-v1.0.feather",
    "connectome-weights-male-cns-v1.0-minconf-0.5.feather",
]
INHIB = {"gaba", "glutamate"}


def download_missing(raw: Path) -> None:
    raw.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        dest = raw / name
        if dest.exists() and dest.stat().st_size > 0:
            print(f"exists {dest} ({dest.stat().st_size / 1e6:.1f} MB)")
            continue
        url = f"{GCS}/{name}"
        print(f"downloading {url}")
        urllib.request.urlretrieve(url, dest)
        print(f"  -> {dest.stat().st_size / 1e6:.1f} MB")


def effective_nt(row: pd.Series) -> str:
    for key in ("consensus_nt", "predicted_nt", "celltype_predicted_nt"):
        val = row.get(key)
        if isinstance(val, str) and val and val != "unclear":
            return val
    return "unclear"


def write_gz(path: Path, data: bytes) -> None:
    # Store gzip payload under a .bin extension so static hosts do not set
    # Content-Encoding: gzip (which would double-decode in the browser).
    with gzip.open(path, "wb", compresslevel=9) as handle:
        handle.write(data)
    print(f"  {path.name:28s} {path.stat().st_size / 1e6:.2f} MB")


def build(raw: Path, out: Path, web: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    web.mkdir(parents=True, exist_ok=True)

    ann = feather.read_table(
        raw / "body-annotations-male-cns-v1.0-minconf-0.5.feather",
        columns=[
            "bodyId",
            "status",
            "type",
            "instance",
            "class",
            "superclass",
            "somaSide",
        ],
    ).to_pandas()
    neurons = ann[ann["status"] == "Traced"].reset_index(drop=True)
    print(f"traced neurons: {len(neurons)}")

    nt = (
        feather.read_table(
            raw / "body-neurotransmitters-male-cns-v1.0.feather",
            columns=[
                "body",
                "consensus_nt",
                "predicted_nt",
                "celltype_predicted_nt",
            ],
        )
        .to_pandas()
        .set_index("body")
    )

    body_ids = neurons["bodyId"].to_numpy()
    body_to_idx = {int(b): i for i, b in enumerate(body_ids)}
    n = len(body_ids)
    signs = np.ones(n, dtype=np.int8)
    nts: list[str] = []
    for i, body in enumerate(body_ids):
        if int(body) in nt.index:
            eff = effective_nt(nt.loc[int(body)])
        else:
            eff = "unclear"
        nts.append(eff)
        if eff in INHIB:
            signs[i] = -1
    print(f"inhibitory={int((signs < 0).sum())} excitatory={int((signs > 0).sum())}")

    source = pa.memory_map(
        str(raw / "connectome-weights-male-cns-v1.0-minconf-0.5.feather"), "r"
    )
    reader = pa.ipc.open_file(source)
    pres: list[np.ndarray] = []
    posts: list[np.ndarray] = []
    weights: list[np.ndarray] = []
    kept = 0
    total = 0
    for bi in range(reader.num_record_batches):
        batch = reader.get_batch(bi)
        total += batch.num_rows
        df = pd.DataFrame(
            {
                "pre": batch.column(0).to_numpy(),
                "post": batch.column(1).to_numpy(),
                "w": batch.column(2).to_numpy(),
            }
        )
        df["i"] = df["pre"].map(body_to_idx)
        df["j"] = df["post"].map(body_to_idx)
        df = df.dropna(subset=["i", "j"])
        if len(df):
            ii = df["i"].to_numpy(dtype=np.int32)
            jj = df["j"].to_numpy(dtype=np.int32)
            ww = df["w"].to_numpy(dtype=np.float32) * signs[ii].astype(np.float32)
            pres.append(ii)
            posts.append(jj)
            weights.append(ww)
            kept += len(df)
        if bi % 100 == 0:
            print(f"batch {bi}/{reader.num_record_batches} total={total} kept={kept}")

    print(f"DONE total={total} kept={kept}")
    pre = np.concatenate(pres)
    post = np.concatenate(posts)
    w = np.concatenate(weights)
    order = np.argsort(pre, kind="mergesort")
    pre, post, w = pre[order], post[order], w[order]
    row_ptr = np.zeros(n + 1, dtype=np.uint32)
    counts = np.bincount(pre, minlength=n).astype(np.uint32)
    row_ptr[1:] = np.cumsum(counts)

    meta = {
        "n_neurons": int(n),
        "n_synapses": int(len(post)),
        "source": "male-cns-v1.0-minconf-0.5",
        "neuron_filter": "status==Traced",
        "model": "Shiu et al. LIF (Nature 2024)",
        "citation": "https://doi.org/10.1038/s41586-024-07763-9",
        "data_url": "https://male-cns.janelia.org/download/",
        "w_syn_mV": 0.275,
        "dt_ms": 0.1,
        "weight_dtype": "int16",
        "params": {
            "v0": -52.0,
            "vReset": -52.0,
            "vRest": -52.0,
            "vThreshold": -45.0,
            "tauMem": 20.0,
            "tauSyn": 5.0,
            "tRefrac": 2.2,
            "tDelay": 1.8,
            "scalePoisson": 250,
            "wScale": 0.275,
        },
        "inhibitory_nts": sorted(INHIB),
        "compression": "gzip-in-bin",
        "files": {
            "row_ptr": "csr_row_ptr.u32.bin",
            "col_idx": "csr_col_idx.u32.bin",
            "weights": "csr_weights.i16.bin",
            "body_ids": "body_ids.u64.bin",
            "signs": "signs.i8.bin",
            "neurons_meta": "neurons.jsonl.bin",
            "type_index": "type_index.json.bin",
            "meta": "meta.json",
        },
    }

    w_i16 = np.rint(w).astype(np.int16)
    row_ptr.tofile(out / "csr_row_ptr.u32")
    post.astype(np.uint32).tofile(out / "csr_col_idx.u32")
    w_i16.tofile(out / "csr_weights.i16")
    body_ids.astype(np.uint64).tofile(out / "body_ids.u64")
    signs.tofile(out / "signs.i8")
    (out / "meta.json").write_text(json.dumps(meta, indent=2))

    with open(out / "neurons.jsonl", "w") as handle:
        for i, row in neurons.iterrows():
            rec = {
                "i": int(i),
                "bodyId": int(row["bodyId"]),
                "type": None if pd.isna(row["type"]) else str(row["type"]),
                "instance": None if pd.isna(row["instance"]) else str(row["instance"]),
                "class": None if pd.isna(row["class"]) else str(row["class"]),
                "superclass": None
                if pd.isna(row["superclass"])
                else str(row["superclass"]),
                "side": None if pd.isna(row["somaSide"]) else str(row["somaSide"]),
                "nt": nts[i],
                "sign": int(signs[i]),
            }
            handle.write(json.dumps(rec, separators=(",", ":")) + "\n")

    by_type: dict[str, list[int]] = defaultdict(list)
    for i, typ in enumerate(neurons["type"].tolist()):
        if isinstance(typ, str) and typ:
            by_type[typ].append(i)
    (out / "type_index.json").write_text(
        json.dumps({k: v for k, v in sorted(by_type.items())})
    )

    write_gz(web / "csr_row_ptr.u32.bin", row_ptr.tobytes())
    write_gz(web / "csr_col_idx.u32.bin", post.astype(np.uint32).tobytes())
    write_gz(web / "csr_weights.i16.bin", w_i16.tobytes())
    write_gz(web / "body_ids.u64.bin", body_ids.astype(np.uint64).tobytes())
    write_gz(web / "signs.i8.bin", signs.tobytes())
    write_gz(web / "neurons.jsonl.bin", (out / "neurons.jsonl").read_bytes())
    write_gz(web / "type_index.json.bin", (out / "type_index.json").read_bytes())
    (web / "meta.json").write_text(json.dumps(meta, indent=2))
    print(f"wrote {out} and {web}")


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", type=Path, default=root / "data" / "raw")
    parser.add_argument("--out", type=Path, default=root / "data" / "processed")
    parser.add_argument("--web", type=Path, default=root / "web" / "public" / "data")
    parser.add_argument("--skip-download", action="store_true")
    args = parser.parse_args()
    if not args.skip_download:
        download_missing(args.raw)
    build(args.raw, args.out, args.web)


if __name__ == "__main__":
    main()
