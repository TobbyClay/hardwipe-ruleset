/** Canonical evaluated roll fields, independent of D&D's display-only d20 subclass. */
export function coverRollSignatureData(data) {
  const normalize = value => {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== "object") return value;
    const result = Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalize(entry)]));
    // D&D5e rehydrates ordinary d20s as D20Die; Midi serializes them as Die.
    if (result.class === "D20Die" && result.faces === 20) result.class = "Die";
    if (Array.isArray(result.results)) for (const dieResult of result.results) delete dieResult.hidden;
    return result;
  };
  return { class: data.class, formula: data.formula, evaluated: data.evaluated,
    terms: normalize(data.terms), total: data.total, type: data.options?.type };
}
