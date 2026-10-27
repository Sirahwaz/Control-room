import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "index.ts"), "utf8");

function smokeBranch() {
  const start = source.indexOf('if(action==="gemini_smoke")');
  const end = source.indexOf("const tc=taskClass(body);", start);
  assert.ok(start >= 0, "Gemini smoke action must be present");
  assert.ok(end > start, "Gemini smoke action must end before the normal router path");
  return source.slice(start, end);
}

test("Gemini smoke check is authenticated before dispatch", () => {
  const auth = source.indexOf("if(!(await authOK(req)))");
  const dispatch = source.indexOf('if(action==="gemini_smoke")');
  assert.ok(auth >= 0 && dispatch > auth, "operator authentication must precede the smoke action");
});

test("Gemini smoke issues one stateless, bounded interactions request", () => {
  const branch = smokeBranch();
  assert.match(branch, /fetch\("https:\/\/generativelanguage\.googleapis\.com\/v1beta\/interactions"/);
  assert.match(branch, /method:"POST"/);
  assert.match(branch, /store:false/);
  assert.match(branch, /max_output_tokens:16/);
  assert.match(branch, /thinking_level:"minimal"/);
  assert.doesNotMatch(branch, /for\s*\(|while\s*\(|attempt\s*</);
});

test("Gemini smoke never calls the APMIX executor or enables fallback", () => {
  const branch = smokeBranch();
  assert.doesNotMatch(branch, /midad_model_gateway_v3|internal\(|MIDAD_APMIX_API_KEY/);
  assert.match(branch, /provider:"google_gemini"/);
});

test("Gemini smoke success requires the exact synthetic response, not HTTP 200 alone", () => {
  const branch = smokeBranch();
  assert.match(branch, /output_matches/);
  assert.match(branch, /MIDAD_GEMINI_OK/);
  assert.match(branch, /if\(!matches\)/);
  assert.match(branch, /inference_tested:true/);
});

test("Gemini HTTP errors are sanitized and never counted as successful inference", () => {
  const branch = smokeBranch();
  const start = branch.indexOf("if(!r.ok)");
  const end = branch.indexOf("const output=", start);
  assert.ok(start >= 0 && end > start, "HTTP error branch must be distinct from output verification");
  const errorBranch = branch.slice(start, end);
  assert.match(branch, /providerMessage=clip\(redactSecrets\(/);
  assert.match(errorBranch, /provider_error_message:providerMessage/);
  assert.match(errorBranch, /inference_attempted:true/);
  assert.match(errorBranch, /inference_tested:false/);
});
