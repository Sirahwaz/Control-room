const MAX_KEY_LENGTH = 4096;

function constantTimeEqual(left, right) {
  if (left.length !== right.length || left.length > MAX_KEY_LENGTH) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) {
    difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return difference === 0;
}

export function isAuthorizedEvolutionRequest(suppliedKey, expectedKeys) {
  const supplied = typeof suppliedKey === "string" ? suppliedKey : "";
  if (!supplied || supplied.length > MAX_KEY_LENGTH || !Array.isArray(expectedKeys)) return false;
  const configured = expectedKeys.filter(
    (value) => typeof value === "string" && value.length > 0 && value.length <= MAX_KEY_LENGTH
  );
  if (configured.length === 0) return false;
  let matched = false;
  for (const candidate of configured) {
    if (constantTimeEqual(supplied, candidate)) matched = true;
  }
  return matched;
}
