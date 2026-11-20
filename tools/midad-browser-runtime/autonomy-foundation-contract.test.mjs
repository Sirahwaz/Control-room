import test from "node:test";
import assert from "node:assert/strict";
import {validateProfile,validateCheckpoint,resumeDecision} from "./autonomy-foundation-contract.mjs";
test("profile schema admits scoped metadata and rejects secret material",()=>{assert.equal(validateProfile({id:"p1",label:"Development",scopes:["read","navigate"]}).ok,true);assert.equal(validateProfile({id:"p2",label:"x",scopes:["read"],password:"x"}).code,"SECRET_MATERIAL_FORBIDDEN");});
test("profile scopes reject unknown privileges",()=>{assert.equal(validateProfile({id:"p",label:"p",scopes:["admin"]}).code,"PROFILE_SCOPE_INVALID");});
test("checkpoint only contains bounded evidence references and safe metadata",()=>{const v=validateCheckpoint({taskId:"t",profileId:"p",state:"paused",updatedAt:1,evidenceRefs:Array.from({length:30},(_,i)=>String(i))});assert.equal(v.ok,true);assert.equal(v.checkpoint.evidenceRefs.length,20);});
test("checkpoint secret fields are rejected",()=>{assert.equal(validateCheckpoint({taskId:"t",profileId:"p",state:"paused",updatedAt:1,rawCookies:"x"}).code,"SECRET_MATERIAL_FORBIDDEN");});
test("resume policy rejects terminal and running states and permits paused/queued",()=>{assert.equal(resumeDecision({taskId:"t",profileId:"p",state:"paused",updatedAt:1}).allowed,true);assert.equal(resumeDecision({taskId:"t",profileId:"p",state:"running",updatedAt:1}).code,"RUNNING_TASK_REQUIRES_LEASE_RECOVERY");assert.equal(resumeDecision({taskId:"t",profileId:"p",state:"completed",updatedAt:1}).code,"TASK_TERMINAL");});
