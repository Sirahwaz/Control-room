import { assertEquals } from "jsr:@std/assert@1";
import { isRelevantSearchResult, parseBing } from "./search-result-parser.ts";

Deno.test("Bing parser unwraps the tracked href to the original HTTPS result URL", () => {
  const destination = "https://github.com/pietro93/ai-training-jobs";
  const tracking = "https://www.bing.com/ck/a?u=a1" + btoa(destination);
  const html = `
    <li class="b_algo">
      <h2><a target="_blank" href="${tracking}" h="ID=SERP,5146.2"><strong>AI Training</strong> Jobs — Weekly Updated List - GitHub</a></h2>
    </li>`;
  assertEquals(parseBing(html), [{
    title: "AI Training Jobs — Weekly Updated List - GitHub",
    url: destination,
  }]);
});

Deno.test("Bing parser accepts h2 descendant anchors and rejects unsafe protocols", () => {
  const html = `
    <li class="b_algo">
      <h2><span><a href="https://work.example.org/automation">API Automation Engineer</a></span></h2>
    </li>
    <li class="b_algo">
      <h2><a href="javascript:alert(1)">Unsafe result</a></h2>
    </li>`;
  assertEquals(parseBing(html), [{title:"API Automation Engineer",url:"https://work.example.org/automation"}]);
});

Deno.test("AI training and API automation results remain discoverable without a crypto keyword in their title", () => {
  assertEquals(isRelevantSearchResult({
    title:"AI Training Jobs — Weekly Updated List",
    url:"https://github.com/pietro93/ai-training-jobs",
  }, "Find live AI model evaluation training RLHF and data annotation work paid in USDC or BTC"), true);
  assertEquals(isRelevantSearchResult({
    title:"TypeScript API Automation Contracts",
    url:"https://jobs.example.org/typescript-api-automation",
  }, "Find direct client demand for TypeScript API integration automation paid in USDC"), true);
});

Deno.test("search relevance still rejects unrelated pages", () => {
  assertEquals(isRelevantSearchResult({
    title:"Best restaurants in Paris",
    url:"https://travel.example.org/paris-food",
  }, "Find AI model evaluation training and data annotation tasks paid in USDC"), false);
});
