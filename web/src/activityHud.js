/**
 * Abstract neural activity HUD — role-rate bars + recent spike flash field.
 * Male CNS metadata has no 3D positions in this build, so this is schematic rather than
 * a FlyWire-style spatial map.
 */
export function createActivityHud(canvas, brain) {
  const ctx = canvas.getContext("2d");
  const roles = [
    { key: "grn_sweet", label: "sweet GRN", kind: "sensory" },
    { key: "orn", label: "ORN", kind: "sensory" },
    { key: "mn_proboscis", label: "proboscis MN", kind: "motor" },
    { key: "mn_neck", label: "neck MN", kind: "motor" },
    { key: "mn_leg_flex", label: "leg flexor", kind: "motor" },
    { key: "mn_leg_ext", label: "leg extensor", kind: "motor" },
    { key: "mn_leg_stance", label: "leg stance", kind: "motor" },
    { key: "mn_wing", label: "wing MN", kind: "motor" },
    { key: "mn_abdomen", label: "abdomen MN", kind: "motor" },
    { key: "dn_steer_l", label: "steer L", kind: "command" },
    { key: "dn_steer_r", label: "steer R", kind: "command" },
    { key: "dn_groom", label: "groom DN", kind: "command" },
    { key: "dn_escwing", label: "escape DN", kind: "command" },
    { key: "pam", label: "PAM", kind: "internal" },
  ].filter((r) => brain.groups[r.key]?.length);

  let mapRatio = 1;
  const colors = {
    sensory: "#5ec8ff",
    motor: "#f0d060",
    command: "#ff9a6b",
    internal: "#e29ad4",
  };

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, mapRatio);
    const w = canvas.clientWidth || 280;
    const h = canvas.clientHeight || 160;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    const w = canvas.clientWidth || 280;
    const h = canvas.clientHeight || 160;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(8, 14, 12, 0.55)";
    ctx.fillRect(0, 0, w, h);

    // Ambient pop-rate field
    const pop = Math.min(1, brain.popRate / 8);
    for (let i = 0; i < 40; i++) {
      const x = ((i * 47 + (brain.ms * 0.13)) % w);
      const y = ((i * 31 + brain.ms * 0.07) % h);
      ctx.fillStyle = `rgba(196, 240, 97, ${0.04 + pop * 0.12})`;
      ctx.beginPath();
      ctx.arc(x, y, 1.2 + pop * 2, 0, Math.PI * 2);
      ctx.fill();
    }

    const rowH = Math.min(14, (h - 8) / roles.length);
    ctx.font = "10px IBM Plex Mono, ui-monospace, monospace";
    roles.forEach((r, i) => {
      const y = 6 + i * rowH;
      const rate = brain.rate[r.key] || 0;
      const rest = (brain.rest && brain.rest[r.key]) || 1;
      // Bar = activity above rest (matches body drive). Resting Hz alone does not fill.
      const excess = Math.max(0, rate - rest);
      const frac = Math.max(0, Math.min(1, excess / Math.max(8, rest * 2)));
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(78, y + 2, w - 86, rowH - 4);
      ctx.fillStyle = colors[r.kind] || "#fff";
      ctx.globalAlpha = 0.35 + frac * 0.65;
      ctx.fillRect(78, y + 2, (w - 86) * frac, rowH - 4);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(231,240,234,0.85)";
      ctx.fillText(r.label, 6, y + rowH - 4);
    });
  }

  resize();
  return {
    draw,
    setQuality(ratio) {
      mapRatio = ratio;
      resize();
    },
    resize,
  };
}
