/**
 * Environment modes for the embodied Male CNS fly.
 *
 * - terrarium: default prop-filled terrarium
 * - flat: infinite-looking Euclidean ground plane
 * - nil: Nil geometry (Heisenberg) visuals + connection-form z-twist
 *         ds² = dx² + dy² + (dz − ½(x dy − y dx))²
 *         https://3-dimensional.space/geometries/nil/
 * - nil-plane: infinite plane with the induced contact metric from the Nil
 *              line element (dz = 0 ⇒ ds² = dx² + dy² + (½(x dy − y dx))²)
 */
import * as THREE from "three";

export const ENV_MODES = [
  { id: "terrarium", label: "Terrarium" },
  { id: "flat", label: "Flat plane" },
  { id: "nil", label: "Nil space" },
  { id: "nil-plane", label: "Nil plane" },
];

const NIL_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

// Nil-inspired ground: spiraling grid from the contact 1-form θ = dz − ½(x dy − y dx).
const NIL_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying vec3 vWorld;
  uniform float uTime;
  uniform float uMode; // 0 = full nil lattice, 1 = plane contact metric
  uniform vec3 uColorA;
  uniform vec3 uColorB;

  float gridLine(float v, float width) {
    float g = abs(fract(v - 0.5) - 0.5) / max(fwidth(v), 1e-4);
    return 1.0 - smoothstep(0.0, width, g);
  }

  void main() {
    float x = vWorld.x;
    float y = vWorld.y;
    float z = vWorld.z;

    // Contact form / Nil connection: α = ½(x dy − y dx)
    float r2 = x * x + y * y;
    float theta = atan(y, x);
    float twist = 0.5 * r2; // integrated connection around origin

    // Spiral coordinates that follow Nil left-invariant framing
    float u = x * cos(0.35 * twist + uTime * 0.05) + y * sin(0.35 * twist + uTime * 0.05);
    float v = -x * sin(0.35 * twist + uTime * 0.05) + y * cos(0.35 * twist + uTime * 0.05);
    float w = z + 0.5 * (x * y); // nil "height" mixing

    float scale = mix(2.2, 1.6, uMode);
    float g1 = gridLine(u * scale, 1.2);
    float g2 = gridLine(v * scale, 1.2);
    float g3 = uMode < 0.5 ? gridLine(w * 1.4, 1.1) : gridLine(twist * 1.8, 1.1);
    float rings = gridLine(sqrt(r2) * 1.5 - uTime * 0.08, 1.0);

    float line = max(max(g1, g2), max(g3 * 0.85, rings * 0.55));
    vec3 col = mix(uColorA, uColorB, 0.35 + 0.35 * sin(theta * 2.0 + twist));
    col = mix(col, vec3(0.85, 0.95, 0.55), line * 0.75);

    float fade = smoothstep(18.0, 3.0, length(vWorld.xy));
    gl_FragColor = vec4(col, 0.92 * fade + 0.08);
  }
`;

const FLAT_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying vec3 vWorld;
  uniform vec3 uColorA;
  uniform vec3 uColorB;

  float gridLine(float v, float width) {
    float g = abs(fract(v - 0.5) - 0.5) / max(fwidth(v), 1e-4);
    return 1.0 - smoothstep(0.0, width, g);
  }

  void main() {
    float g = max(gridLine(vWorld.x * 2.0, 1.1), gridLine(vWorld.y * 2.0, 1.1));
    vec3 col = mix(uColorA, uColorB, g * 0.55);
    float fade = smoothstep(22.0, 4.0, length(vWorld.xy));
    gl_FragColor = vec4(col, 0.95 * fade + 0.05);
  }
`;

export function createEnvironmentController(scene, propRoot) {
  let mode = "terrarium";
  const clock = { t: 0 };
  let lastX = 0;
  let lastY = 0;
  let hasLast = false;

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(48, 48, 1, 1),
    new THREE.ShaderMaterial({
      vertexShader: NIL_VERT,
      fragmentShader: FLAT_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uMode: { value: 0 },
        uColorA: { value: new THREE.Color(0x1a2420) },
        uColorB: { value: new THREE.Color(0x2e4038) },
      },
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  ground.rotation.z = 0;
  ground.position.z = -0.12;
  ground.visible = false;
  ground.name = "env-ground";
  ground.renderOrder = -1;
  scene.add(ground);

  const nilMat = new THREE.ShaderMaterial({
    vertexShader: NIL_VERT,
    fragmentShader: NIL_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uMode: { value: 0 },
      uColorA: { value: new THREE.Color(0x101820) },
      uColorB: { value: new THREE.Color(0x1e3a44) },
    },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const flatMat = ground.material;

  function setMode(next) {
    if (!ENV_MODES.some((m) => m.id === next)) return mode;
    mode = next;
    const showProps = mode === "terrarium";
    if (propRoot) propRoot.visible = showProps;
    // Individual prop groups may live as direct scene children.
    scene.traverse((obj) => {
      if (obj.userData?.isEnvProp) obj.visible = showProps;
    });

    if (mode === "terrarium") {
      ground.visible = false;
    } else if (mode === "flat") {
      ground.visible = true;
      ground.material = flatMat;
      flatMat.uniforms.uColorA.value.set(0x1a2420);
      flatMat.uniforms.uColorB.value.set(0x3d5248);
    } else if (mode === "nil") {
      ground.visible = true;
      ground.material = nilMat;
      nilMat.uniforms.uMode.value = 0;
      nilMat.uniforms.uColorA.value.set(0x0c141c);
      nilMat.uniforms.uColorB.value.set(0x1a3340);
    } else if (mode === "nil-plane") {
      ground.visible = true;
      ground.material = nilMat;
      nilMat.uniforms.uMode.value = 1;
      nilMat.uniforms.uColorA.value.set(0x101818);
      nilMat.uniforms.uColorB.value.set(0x243830);
    }
    return mode;
  }

  function update(dt, flyX, flyY, data, freeQadr) {
    clock.t += dt;
    const mat = ground.material;
    if (mat.uniforms?.uTime) mat.uniforms.uTime.value = clock.t;

    // Nil connection: holonomy dz += ½(x dy − y dx) when moving in the xy-plane.
    if ((mode === "nil" || mode === "nil-plane") && data && freeQadr >= 0) {
      if (hasLast) {
        const dx = flyX - lastX;
        const dy = flyY - lastY;
        const dz = 0.5 * (lastX * dy - lastY * dx);
        if (Math.abs(dz) > 1e-8) {
          data.qpos[freeQadr + 2] += dz;
        }
      }
      lastX = flyX;
      lastY = flyY;
      hasLast = true;
    } else {
      hasLast = false;
    }
  }

  setMode("terrarium");

  return {
    get mode() {
      return mode;
    },
    setMode,
    update,
    ground,
    modes: ENV_MODES,
  };
}

/** Mark loaded prop roots so environment switching can hide them. */
export function tagEnvProp(object3d) {
  object3d.userData.isEnvProp = true;
  return object3d;
}
