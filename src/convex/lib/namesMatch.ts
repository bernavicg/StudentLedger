/**
 * Loose key for cross-tab matching: drops parenthetical remarks
 * ("(Minus 8 sessions)"), school-year tags ("25-26", "SY24-25"), and case
 * number noise so "Rina Ishay 25-26" and "Rina Ishay" collapse to the same
 * student. Exact compare first; containment when both keys are long enough
 * to avoid false positives on short names.
 *
 * Lives in lib/ because both the node actions (legacyImport.ts) and the
 * isolate module (sheetsPicker.ts) use it — a node-runtime module must never
 * be pulled into the isolate bundle, or `node:` imports fail to resolve.
 */

export function namesMatch(a: string, b: string): boolean {
  const ka = looseKey(a);
  const kb = looseKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  if (ka.length >= 8 && kb.length >= 8) return ka.includes(kb) || kb.includes(ka);
  return false;
}

function looseKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/sy\s*\d{2,4}(\s*-\s*\d{2,4})?/g, " ")
    .replace(/\d+/g, " ")
    .replace(/[^a-z]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
