/**
 * Map Male CNS cell types / classes onto motor & sensory roles used to drive the body.
 * Male CNS includes the VNC, so leg / wing / abdomen motor neurons are real populations.
 */

function pushAll(out, idxs) {
  if (!idxs) return;
  for (const i of idxs) out.push(i);
}

function bySide(neurons, indices, side) {
  return indices.filter((i) => neurons[i]?.side === side);
}

/**
 * @param {object[]} neurons
 * @param {Record<string, number[]>} typeIndex
 * @returns {Record<string, number[]>}
 */
export function buildRoles(neurons, typeIndex) {
  const roles = {};
  const add = (role, idxs) => {
    if (!idxs?.length) return;
    roles[role] = (roles[role] || []).concat(idxs);
  };
  const typesMatching = (pred) => {
    const out = [];
    for (const [t, idxs] of Object.entries(typeIndex)) {
      if (pred(t)) pushAll(out, idxs);
    }
    return out;
  };
  const classOf = (cls) => {
    const out = [];
    for (let i = 0; i < neurons.length; i++) {
      if (neurons[i].class === cls) out.push(i);
    }
    return out;
  };
  const superclassOf = (sc) => {
    const out = [];
    for (let i = 0; i < neurons.length; i++) {
      if (neurons[i].superclass === sc) out.push(i);
    }
    return out;
  };
  const typeList = (names) => {
    const out = [];
    for (const name of names) pushAll(out, typeIndex[name]);
    return out;
  };

  // --- Sensory (FULL Male CNS sensory periphery — every matching cell) ---
  add("grn_sweet", typeIndex["claw_tpGRN"]);
  add("grn_sweet", typeIndex["dorsal_tpGRN"]);
  add(
    "grn_sweet_leg",
    typesMatching((t) => /^WG[1-4]$/.test(t))
  );
  add(
    "grn_bitter",
    typesMatching((t) => /^LB[1-3]/.test(t))
  );
  // Broader gustatory / chemosensory pools (all class members, not a subsample)
  add("gustatory", classOf("gustatory"));
  add("chemo", classOf("chemosensory"));
  add(
    "orn",
    typesMatching((t) => t.startsWith("ORN_"))
  );
  add("olfactory", classOf("olfactory"));
  add(
    "mechano",
    classOf("mechanosensory")
      .concat(classOf("mechanosensory_tactile"))
      .concat(classOf("mechanosensory_tbc"))
  );
  add("proprio", classOf("mechanosensory_proprioceptive"));
  add("unknown_sensory", classOf("unknown_sensory"));
  add("thermo", classOf("thermosensory"));
  add("hygro", classOf("hygrosensory"));
  add("visual", classOf("visual"));
  add("lc4", typeIndex["LC4"]);
  add("lplc2", typeIndex["LPLC2"]);
  add(
    "pam",
    typesMatching((t) => t.startsWith("PAM"))
  );

  // --- Descending commands (named FlyWire-compatible pools) ---
  add("dn_gf", typeIndex["DNp01"]);
  add(
    "dn_escwing",
    []
      .concat(typeIndex["DNp02"] || [])
      .concat(typeIndex["DNp04"] || [])
      .concat(typeIndex["DNp11"] || [])
  );
  add("dn_groom", typeIndex["DNg11"]);
  add(
    "dn_steer",
    []
      .concat(typeIndex["DNa01"] || [])
      .concat(typeIndex["DNa02"] || [])
  );
  add(
    "dn_walk",
    []
      .concat(typeIndex["DNb01"] || [])
      .concat(typeIndex["DNd01"] || [])
  );

  for (const [base, left, right] of [
    ["dn_steer", "dn_steer_l", "dn_steer_r"],
    ["dn_escwing", "dn_escwing_l", "dn_escwing_r"],
  ]) {
    const idxs = roles[base] || [];
    add(left, bySide(neurons, idxs, "L"));
    add(right, bySide(neurons, idxs, "R"));
  }

  // --- Head / feeding motors (central brain motor neurons) ---
  const cbMotor = superclassOf("cb_motor");
  const neck = typesMatching((t) => /^CvN/.test(t));
  const antenna = typesMatching((t) => /^(MN10|MN11D|MN11V|MN12D|MN13|CEM)/.test(t));
  const proboscis = typesMatching((t) =>
    /^(MN1|MN2Da|MN2Db|MN2V|MN3L|MN3M|MN4a|MN4b|MN5|MN6|MN7|MN8|MN9|MNx0[1-5]|PS348|PS349)$/.test(
      t
    )
  );
  add("mn_neck", neck.length ? neck : cbMotor.slice(0, 20));
  add("mn_antenna", antenna.length ? antenna : cbMotor.slice(20, 40));
  add("mn_proboscis", proboscis.length ? proboscis : cbMotor.slice(40, 80));
  add("mn_ingestion", (roles.mn_proboscis || []).slice());
  add("mn_neck_l", bySide(neurons, roles.mn_neck || [], "L"));
  add("mn_neck_r", bySide(neurons, roles.mn_neck || [], "R"));
  add("mn_antenna_l", bySide(neurons, roles.mn_antenna || [], "L"));
  add("mn_antenna_r", bySide(neurons, roles.mn_antenna || [], "R"));

  // --- Leg motor neurons (VNC) ---
  const legFlex = typeList([
    "Ti flexor MN",
    "Acc. ti flexor MN",
    "Tr flexor MN",
    "Acc. tr flexor MN",
  ]);
  const legExt = typeList(["Ti extensor MN", "Tr extensor MN", "Fe reductor MN"]);
  const legStance = typeList([
    "Sternotrochanter MN",
    "Sternal anterior rotator MN",
    "Sternal posterior rotator MN",
    "Tergopleural/Pleural promotor MN",
    "Pleural remotor/abductor MN",
    "Sternal adductor MN",
    "Tergotr. MN",
  ]);
  const legTarsus = typeList(["Ta depressor MN", "Ta levator MN"]);
  const legLtm = typeList(["ltm MN", "ltm1-tibia MN", "ltm2-femur MN"]);
  add("mn_leg_flex", legFlex);
  add("mn_leg_ext", legExt);
  add("mn_leg_stance", legStance);
  add("mn_leg_tarsus", legTarsus);
  add("mn_leg_ltm", legLtm);
  for (const [base, left, right] of [
    ["mn_leg_flex", "mn_leg_flex_l", "mn_leg_flex_r"],
    ["mn_leg_ext", "mn_leg_ext_l", "mn_leg_ext_r"],
    ["mn_leg_stance", "mn_leg_stance_l", "mn_leg_stance_r"],
    ["mn_leg_tarsus", "mn_leg_tarsus_l", "mn_leg_tarsus_r"],
    ["mn_leg_ltm", "mn_leg_ltm_l", "mn_leg_ltm_r"],
  ]) {
    const idxs = roles[base] || [];
    add(left, bySide(neurons, idxs, "L"));
    add(right, bySide(neurons, idxs, "R"));
  }

  // --- Wing power / steering muscles (VNC) ---
  add(
    "mn_wing",
    typesMatching(
      (t) =>
        /^(b1|b2|b3|i1|i2|iii1|iii3|hg\d|ps\d|tp\d|TTMn|hDVM|hi1|hi2|hiii2|tpn|STTMm) MN$/.test(
          t
        ) ||
        t === "TTMn" ||
        t === "hDVM MN" ||
        t === "STTMm" ||
        /^DLMn/.test(t) ||
        /^DVMn/.test(t)
    )
  );
  add("mn_wing_l", bySide(neurons, roles.mn_wing || [], "L"));
  add("mn_wing_r", bySide(neurons, roles.mn_wing || [], "R"));

  // --- Abdominal motor neurons (VNC) ---
  add(
    "mn_abdomen",
    typesMatching((t) => /^(MNad|ADNM)/.test(t))
  );
  add("mn_abdomen_l", bySide(neurons, roles.mn_abdomen || [], "L"));
  add("mn_abdomen_r", bySide(neurons, roles.mn_abdomen || [], "R"));

  // Deduplicate
  for (const k of Object.keys(roles)) {
    roles[k] = [...new Set(roles[k])];
  }
  return roles;
}

/** Sensory switches → role populations (levels 0..1). Full periphery. */
export const STIM_MAP = {
  sweet: ["grn_sweet", "grn_sweet_leg", "gustatory"],
  bitter: ["grn_bitter", "chemo"],
  odour: ["orn", "olfactory"],
  touch: ["mechano", "unknown_sensory"],
  proprio: ["proprio"],
  heat: ["thermo"],
  damp: ["hygro"],
  light: ["visual"],
  looming: ["lc4", "lplc2"],
};
