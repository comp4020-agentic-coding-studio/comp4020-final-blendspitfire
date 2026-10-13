// The final colour grade, applied once to the whole frame in
// client/postprocess.ts. Tuning the look --- how bright, how contrasty, how
// coloured --- happens here, without rebuilding a single model. It's a
// plain object on purpose: a future admin panel can bind sliders straight
// to these fields.

export interface Grade {
  /** overall brightness, before tone mapping (1 = as lit) */
  exposure: number;
  /** around mid-grey; >1 deepens shadows and lifts highlights */
  contrast: number;
  /** 1 = as lit; <1 greys the whole frame (emitters included) */
  saturation: number;
  /** what the darkest tones lean toward: a near-black, not pure black, so shadows have a temperature */
  shadowTint: [number, number, number];
  /** what the brightest tones lean toward */
  highlightTint: [number, number, number];
  /** how strongly the two tints apply (0 = off) */
  tintStrength: number;
  /** lift the black point, so the darkest lit things never crush to 0 (out-of-sight stays true black regardless) */
  blackLift: number;
  /** darkening toward the screen edges, 0..1 */
  vignette: number;
  /** ordered-dither strength in 0..1 colour units; hides banding in dark gradients */
  dither: number;
}

export const GRADE: Grade = {
  exposure: 1.15,
  contrast: 1.08,
  saturation: 0.92,
  shadowTint: [0.06, 0.075, 0.09],
  highlightTint: [1.0, 0.97, 0.92],
  tintStrength: 0.35,
  blackLift: 0.012,
  vignette: 0.35,
  dither: 0.018,
};
