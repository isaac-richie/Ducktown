import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { GroundedSkybox } from 'three/addons/objects/GroundedSkybox.js';

// The hero duck in a real city: a 360° photo capture of Neuer Zollhof, Düsseldorf at blue hour
// (Poly Haven, CC0; see ./city/README.md). The photo is projected onto a flat ground so the duck
// stands on the real paving at its true size, and its HDR light and reflections come from the
// same place, so the duck sits in the scene instead of floating over it.
//
// Units are the rig's centimetres: the duck is 25 cm tall, the panorama was shot from about 1.65 m.
export const CAPTURE_HEIGHT = 165;
export const GROUND_RADIUS = 4000;
const FLOOR_Y = -.24; // matches the duck's shadow-catcher floor

const BACKDROP_URL = new URL('./city/neuer-zollhof-4k.jpg', import.meta.url).href;
const BACKDROP_LITE_URL = new URL('./city/neuer-zollhof-2k.jpg', import.meta.url).href;
const LIGHTING_URL = new URL('./city/neuer-zollhof-1k.hdr', import.meta.url).href;

export function buildCity({renderer, lite = false}) {
  const group = new THREE.Group();
  group.name = 'ducktown-city';
  const disposables = [];
  let skybox = null, environment = null, disposed = false;

  // Seen from underneath, the projected ground disappears; a faint grid keeps the floor readable.
  const grid = new THREE.GridHelper(160, 40, '#cfe3ff', '#cfe3ff');
  grid.material.transparent = true; grid.material.opacity = .3; grid.position.y = FLOOR_Y; grid.visible = false;
  disposables.push(grid.geometry, grid.material);
  group.add(grid);

  // Phones: a 2K photo (~0.4 MB) that also provides the lighting, instead of 4K photo + HDR (~3 MB).
  const backdrop = new THREE.TextureLoader().loadAsync(lite ? BACKDROP_LITE_URL : BACKDROP_URL).then(texture => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return texture;
  });
  const prefilter = source => {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(source).texture;
    pmrem.dispose();
    return env;
  };
  const lighting = lite
    ? backdrop.then(prefilter)
    : new HDRLoader().loadAsync(LIGHTING_URL).then(hdr => {
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const env = prefilter(hdr); hdr.dispose(); return env;
    });

  const ready = Promise.all([backdrop, lighting]).then(([texture, env]) => {
    if (disposed) { texture.dispose(); env.dispose(); return false; }
    skybox = new GroundedSkybox(texture, CAPTURE_HEIGHT, GROUND_RADIUS, 96);
    // The backdrop is already a finished photo: show it as shot, without tone-mapping it twice.
    skybox.material.toneMapped = false;
    skybox.position.y = CAPTURE_HEIGHT + FLOOR_Y - .01;
    skybox.renderOrder = -1;
    group.add(skybox);
    environment = env;
    disposables.push(texture, env, skybox.geometry, skybox.material);
    return true;
  });

  return {
    group,
    ready,
    get environment() { return environment; },
    farPlane: GROUND_RADIUS * 2,
    update(camera) {
      const below = camera.position.y < FLOOR_Y;
      grid.visible = below;
      if (skybox) skybox.visible = !below;
    },
    dispose() { disposed = true; for (const item of disposables) item.dispose?.(); }
  };
}
