// Downloads the CC0 Poly Haven models used by the Town Map scenes (1k textures) into
// frontend/place-assets-cache/ (git-ignored). Only the rendered images are committed.
import { mkdir, writeFile, access } from 'node:fs/promises';

export const MODELS = ['SchoolDesk_01', 'SchoolChair_01', 'book_encyclopedia_set_01', 'WoodenTable_01', 'bench_vice_01',
  'metal_toolbox', 'desk_lamp_arm_01', 'adjustable_wrench', 'ArmChair_01', 'classic_laptop', 'CoffeeTable_01', 'fern_02',
  'coast_rocks_01', 'coast_rocks_02', 'grass_medium_01', 'boombox', 'planter_box_01', 'garden_gnome', 'painted_wooden_bench',
  'potted_plant_01', 'pachira_aquatica_01', 'football', 'Lantern_01', 'calathea_orbifolia_01'];

const root = new URL('../frontend/place-assets-cache/', import.meta.url);
for (const id of MODELS) {
  const files = await fetch(`https://api.polyhaven.com/files/${id}`).then(r => r.ok ? r.json() : null);
  const gltf = files?.gltf?.['1k']?.gltf;
  if (!gltf) { console.log(`skip ${id}: no 1k glTF`); continue; }
  const dir = new URL(`${id}/`, root);
  await mkdir(new URL('textures/', dir), {recursive: true});
  const save = async (name, url) => {
    const target = new URL(name, dir);
    try { await access(target); return; } catch {}
    const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`);
    await writeFile(target, Buffer.from(await r.arrayBuffer()));
  };
  await save(`${id}.gltf`, gltf.url);
  for (const [name, {url}] of Object.entries(gltf.include || {})) await save(name, url);
  console.log(`ok ${id}`);
}
