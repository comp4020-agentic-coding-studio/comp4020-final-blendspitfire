import * as THREE from "three";
import { describe, expect, it } from "vitest";
import * as palette from "../shared/palette.ts";
import { ASSETS, BUDGETS } from "../client/models/registry.ts";
import { emissiveMaterial } from "../client/models/kit.ts";

// The asset pipeline's checks: every registered model stays inside its
// triangle budget, and every non-emissive surface colour stays inside the
// surface gamut (docs/art-and-interaction.md). An asset that breaks either
// fails here, before it reaches review.

/** baked AO and the OKLCH round trip move colours a little; allow for it */
const CHROMA_TOLERANCE = 0.012;

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
}

/** the model's own triangles, not its outline shell (a copy of the same geometry) */
const isOutline = (m: THREE.Mesh): boolean => (m.material as THREE.Material).side === THREE.BackSide;

describe("assets", () => {
  for (const asset of ASSETS) {
    describe(asset.id, () => {
      const root = asset.build();
      const meshes = meshesOf(root).filter((m) => !isOutline(m));

      it(`fits the ${asset.category} budget (${BUDGETS[asset.category]} tris)`, () => {
        const tris = meshes.reduce((n, m) => n + m.geometry.attributes.position.count / 3, 0);
        expect(tris).toBeLessThanOrEqual(BUDGETS[asset.category]);
      });

      it("keeps every surface colour inside the gamut", () => {
        const offenders = new Set<string>();
        for (const m of meshes) {
          if (m.material === emissiveMaterial) continue;
          const colour = m.geometry.attributes.color;
          if (!colour) continue;
          for (let i = 0; i < colour.count; i++) {
            const c = new THREE.Color(colour.getX(i), colour.getY(i), colour.getZ(i));
            const { C } = palette.toOklch(c.getHex());
            if (C > palette.SURFACE_CHROMA_MAX + CHROMA_TOLERANCE) offenders.add(`#${c.getHexString()} (C ${C.toFixed(3)})`);
          }
        }
        expect([...offenders].slice(0, 5)).toEqual([]);
      });
    });
  }
});

describe("palette", () => {
  const ramps = Object.entries(palette).filter(
    (e): e is [string, palette.Ramp] => typeof e[1] === "object" && e[1] !== null && "base" in e[1],
  );

  it("has surface swatches to check", () => {
    expect(ramps.length).toBeGreaterThan(10);
  });

  for (const [name, ramp] of ramps) {
    it(`${name} stays inside the surface gamut`, () => {
      for (const c of [ramp.shade, ramp.base, ramp.light]) {
        const { L, C } = palette.toOklch(c);
        expect(C).toBeLessThanOrEqual(palette.SURFACE_CHROMA_MAX + 0.003);
        expect(L).toBeGreaterThanOrEqual(palette.SURFACE_L_MIN - 0.01);
        expect(L).toBeLessThanOrEqual(palette.SURFACE_L_MAX + 0.01);
      }
    });
  }

  it("round-trips OKLCH", () => {
    const back = palette.toOklch(palette.oklch(0.6, 0.05, 150));
    expect(back.L).toBeCloseTo(0.6, 2);
    expect(back.C).toBeCloseTo(0.05, 2);
  });
});
