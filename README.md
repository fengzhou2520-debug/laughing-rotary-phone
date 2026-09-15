# Male CNS full-connectome embodied simulator

Browser webapp that runs a **leaky integrate-and-fire** model on the **full Janelia Male CNS v1.0 proofread connectome** (every `Traced` neuron and every synapse between those neurons), embodied as a fruit fly in a terrarium — walking, feeding, and gesturing from neural activity.

Live on GitHub Pages after enabling Pages (Settings → Pages → GitHub Actions).

Inspired by [infinite-sugar](https://github.com/cnqso/infinite-sugar); this build uses the Male CNS (brain + VNC) so **leg motor neurons** can pace a real walking gait, not only descending “shuffle” commands.

## What’s included

| Asset | Source |
| --- | --- |
| Neurons | `body-annotations-male-cns-v1.0-minconf-0.5.feather` (`status==Traced`) |
| E/I signs | `body-neurotransmitters-male-cns-v1.0.feather` (GABA/glutamate inhibitory) |
| Synapses | `connectome-weights-male-cns-v1.0-minconf-0.5.feather` (edges with both ends traced) |
| Body | [FlyBody](https://github.com/TuragaLab/flybody) via MuJoCo Menagerie + MuJoCo WASM |
| Scene | Terrarium / props (CC-BY — see `web/public/model/props/CREDITS.md`) |

Current build: **165,122 neurons · 25,563,197 synapses · 11,751 cell types**.

### Embodiment

- Continuous sugar stimulation of gustatory receptor neurons
- **All 78 FlyBody actuators** driven from identified Male CNS motor & descending pools (head, feeding, antennae, wings, abdomen, every leg DOF, labrum/claw adhesion)
- Tripod-style walking from VNC leg flexor / extensor / stance / tarsus / LTM rates, with free-joint translation so the fly walks around the terrarium
- Adaptive quality scaler for realtime performance (rendering only — the LIF still steps every Traced neuron and every synapse)

Realtime kernel uses 1&nbsp;ms steps (infinite-sugar / desktop-fly style) on the Male CNS CSR wiring. Batch Shiu-parameter LIF (`web/src/lif.js`) remains available for offline smoke tests.

## Local app

```bash
cd web
npm install
npm run dev
```

Open the URL Vite prints, name the fly, wait for the connectome + body to load (~75&nbsp;MB compressed CSR on first visit). Drag to orbit, scroll to zoom. Toggle **Sugar**, **Pause**, and open **Inspect** for rates.

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

- Fragment/orphan segments in the raw weight table are excluded; only proofread **Traced** bodies enter the network.
- First load downloads ~75 MB of compressed CSR data plus the FlyBody meshes; keep the tab open while it decompresses.
- Some movements use supplied gait patterns scaled by neural rates (explicit, not learned). There is no habituation.
