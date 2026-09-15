/**
 * Click-to-place sugar food pellets. Proximity to the fly drives sweet GRNs
 * through the connectome (no motor bypass).
 */
import * as THREE from "three";

const FOOD_RADIUS = 0.035;
const SENSE_RADIUS = 0.22;

export function createFoodSystem(scene) {
  const group = new THREE.Group();
  group.name = "food-pellets";
  scene.add(group);

  /** @type {{ mesh: THREE.Mesh, pos: THREE.Vector3 }[]} */
  const foods = [];
  let placeMode = false;

  const geo = new THREE.SphereGeometry(FOOD_RADIUS, 18, 14);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xc4f061,
    emissive: 0x5a8a20,
    emissiveIntensity: 0.35,
    roughness: 0.45,
    metalness: 0.05,
  });

  function addFood(x, y, z) {
    const mesh = new THREE.Mesh(geo, mat.clone());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(x, y, z + FOOD_RADIUS);
    mesh.userData.food = true;
    group.add(mesh);
    foods.push({ mesh, pos: mesh.position.clone() });
    return mesh;
  }

  function clear() {
    for (const f of foods) {
      group.remove(f.mesh);
      f.mesh.geometry = geo;
    }
    foods.length = 0;
  }

  /**
   * Drive level 0..1 from nearest food to thorax position.
   * @param {{ x: number, y: number, z: number }} thorax
   */
  function proximityDrive(thorax) {
    if (!foods.length) return 0;
    let best = Infinity;
    for (const f of foods) {
      const dx = f.pos.x - thorax.x;
      const dy = f.pos.y - thorax.y;
      const dz = f.pos.z - thorax.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < best) best = d;
    }
    if (best >= SENSE_RADIUS) return 0;
    // Smooth falloff — strong when standing on the pellet.
    const t = 1 - best / SENSE_RADIUS;
    return t * t;
  }

  return {
    group,
    foods,
    get placeMode() {
      return placeMode;
    },
    setPlaceMode(on) {
      placeMode = !!on;
    },
    addFood,
    clear,
    proximityDrive,
    senseRadius: SENSE_RADIUS,
    foodRadius: FOOD_RADIUS,
  };
}
