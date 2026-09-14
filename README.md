# Male CNS full-connectome LIF simulator

Browser webapp that runs a **leaky integrate-and-fire** model on the **full Janelia Male CNS v1.0 proofread connectome** (every `Traced` neuron and every synapse between those neurons).

Live on GitHub Pages after enabling Pages (Settings → Pages → GitHub Actions).

## What’s included

| Asset | Source |
| --- | --- |
| Neurons | `body-annotations-male-cns-v1.0-minconf-0.5.feather` (`status==Traced`) |
| E/I signs | `body-neurotransmitters-male-cns-v1.0.feather` (GABA/glutamate inhibitory) |
| Synapses | `connectome-weights-male-cns-v1.0-minconf-0.5.feather` (edges with both ends traced) |

Current build: **165,122 neurons · 25,563,197 synapses · 11,751 cell types**.

Model equations and parameters match [Shiu et al., Nature 2024](https://doi.org/10.1038/s41586-024-07763-9) / [PMC10187186](https://pmc.ncbi.nlm.nih.gov/articles/PMC10187186/) and the reference implementations in [philshiu/Drosophila_brain_model](https://github.com/philshiu/Drosophila_brain_model) and [eonsystemspbc/fly-brain](https://github.com/eonsystemspbc/fly-brain):

- \(v_0 = v_\mathrm{reset} = -52\,\mathrm{mV}\), \(v_\mathrm{th} = -45\,\mathrm{mV}\)
- \(\tau_\mathrm{mem} = 20\,\mathrm{ms}\), \(\tau_\mathrm{syn} = 5\,\mathrm{ms}\)
- \(t_\mathrm{ref} = 2.2\,\mathrm{ms}\), \(t_\mathrm{delay} = 1.8\,\mathrm{ms}\)
- \(W_\mathrm{syn} = 0.275\,\mathrm{mV}\)
- Poisson drive at configurable Hz with scale 250

## Local app

```bash
cd web
npm install
npm run dev
```

Open the URL Vite prints, click **Load full connectome**, then excite cell types (e.g. `ORN`, `L1`, `Kenyon_Cell` types) and run.

## Rebuild connectome assets

Requires ~2 GB disk for the raw feathers (weights ≈ 1 GB) and Python deps:

```bash
pip install -r requirements.txt
python scripts/build_connectome.py
```

Raw feathers are downloaded from the public Janelia GCS bucket documented at [male-cns.janelia.org/download](https://male-cns.janelia.org/download/). Processed gzipped binaries are written to `web/public/data/` for the static site.

## GitHub Pages

The workflow in `.github/workflows/pages.yml` builds the Vite app and pushes it to the `gh-pages` branch. In **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, then set branch to **`gh-pages`** / **`/` (root)**. The site base path is `/<repo-name>/`.

## Notes

- Fragment/orphan segments in the raw weight table are excluded; only proofread **Traced** bodies enter the network—the full neuronal Male CNS graph used for analysis, not a toy subsample.
- First load downloads ~75 MB of compressed CSR data into the browser tab; keep the tab open while it decompresses.
- Simulation cost scales with active neurons and their out-degree; start with 200–500 ms and use **Max excite N** (default 100). Prefer cholinergic types (e.g. `Mi1`, `ORN_DA1`); GABA/glutamate cells are inhibitory in this model.
