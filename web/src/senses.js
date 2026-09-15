/**
 * Map the embodied world onto every Male CNS sensory channel.
 * Only receptor / sensory pools are driven; the connectome propagates the rest.
 *
 * Ambient levels stay modest so the full ~25M-edge graph stays realtime; food /
 * sugar bath and close contacts can still push channels harder.
 */
import { STIM_MAP } from "./roles.js";

/**
 * Continuous environmental → receptor drive (levels 0..1 per STIM_MAP key).
 * @param {object} ctx
 * @param {import('./brain.js').Brain} ctx.brain
 * @param {number} ctx.foodDrive
 * @param {{x:number,y:number,z:number}} ctx.thorax
 * @param {{ wrap?: { position: { x:number,y:number,z:number } }, body?: { position: { x:number,y:number,z:number }, velocity: { x:number,y:number,z:number } } } | null} ctx.ball
 * @param {string} ctx.envMode
 * @param {number} ctx.legContact 0..1 fraction of legs in stance/contact
 * @param {number} ctx.walkSpeed approx horizontal speed
 */
export function applyWorldSenses(ctx) {
  const {
    brain,
    foodDrive = 0,
    thorax,
    ball = null,
    envMode = "terrarium",
    legContact = 0.5,
    walkSpeed = 0,
  } = ctx;

  // Gustation from food pellets (sugar bath is a separate manual stim.sweet).
  brain.setFoodDrive(foodDrive);

  const foodOdour = Math.min(0.7, foodDrive * 0.9 + (foodDrive > 0 ? 0.12 : 0));
  const sceneOdour =
    envMode === "terrarium" ? 0.07 : envMode === "flat" ? 0.03 : 0.05;

  // Ground contact tone — enough to recruit mechanosensory paths without
  // saturating the entire periphery every ms.
  const touch = Math.min(
    0.55,
    0.1 + legContact * 0.28 + Math.min(0.2, walkSpeed * 5)
  );

  const heat =
    envMode === "nil" || envMode === "nil-plane"
      ? 0.12
      : envMode === "flat"
        ? 0.16
        : 0.1;
  const damp = envMode === "terrarium" ? 0.14 : envMode === "flat" ? 0.05 : 0.08;
  const light =
    envMode === "flat" ? 0.18 : envMode === "terrarium" ? 0.12 : 0.1;

  let looming = 0;
  if (ball?.body && thorax) {
    const bp = ball.body.position;
    const dx = bp.x - thorax.x;
    const dy = bp.y - thorax.y;
    const dz = bp.z - thorax.z;
    const dist = Math.hypot(dx, dy, dz);
    const closing =
      ball.body.velocity
        ? -(
            (bp.x - thorax.x) * ball.body.velocity.x +
            (bp.y - thorax.y) * ball.body.velocity.y +
            (bp.z - thorax.z) * ball.body.velocity.z
          ) / Math.max(dist, 1e-3)
        : 0;
    if (dist < 0.55) {
      looming = Math.min(1, (1 - dist / 0.55) * 0.7 + Math.max(0, closing) * 0.5);
    }
  }

  const levels = {
    odour: Math.min(1, sceneOdour + foodOdour * 0.7),
    touch,
    heat,
    damp,
    light,
    looming,
  };
  if ("proprio" in brain.stim) {
    levels.proprio = Math.min(0.5, 0.08 + walkSpeed * 6 + legContact * 0.15);
  }
  brain.setStimMany(levels);
}

/** Human-readable snapshot of current sensory drive levels. */
export function senseSnapshot(brain) {
  const out = {};
  for (const k of Object.keys(STIM_MAP)) {
    out[k] = +(brain.stim[k] || 0).toFixed(2);
  }
  out.food = +(brain._foodDrive || 0).toFixed(2);
  return out;
}
