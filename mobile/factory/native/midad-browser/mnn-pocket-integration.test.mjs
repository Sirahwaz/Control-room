import test from "node:test";
import assert from "node:assert/strict";
import { MNN_POCKET_MODEL, localModelCapability, localModelStatus, localModelGenerate } from "./mnn-pocket-integration.mjs";
test("registry identifies the MNN INT4 model with bounded footprint and license",()=>{
 assert.equal(MNN_POCKET_MODEL.id,"taobao-mnn/MNN-Pocket-0.3B-MNN");
 assert.equal(MNN_POCKET_MODEL.format,"MNN-INT4-W4A16");
 assert.equal(MNN_POCKET_MODEL.license,"Apache-2.0");
 assert.equal(MNN_POCKET_MODEL.approximateBytes,173*1024*1024);
});
test("does not falsely report inference ready when native runtime is absent",()=>{
 assert.equal(localModelCapability(null),false);
 assert.equal(localModelStatus(null).inferenceReady,false);
 assert.equal(localModelStatus(null).state,"runtime_missing");
});
test("generation fails closed until native runtime exists and bounds prompt/options",async()=>{
 await assert.rejects(()=>localModelGenerate(null,"hello"),/native_mnn_runtime_not_integrated/);
 const fake={localModelStatus:()=>({state:"ready"}),localModelGenerate:(p,o)=>({p,o})};
 assert.deepEqual(await localModelGenerate(fake,"hello",{maxTokens:9999}),{p:"hello",o:{maxTokens:512}});
 await assert.rejects(()=>localModelGenerate(fake," "),/prompt_invalid/);
});
