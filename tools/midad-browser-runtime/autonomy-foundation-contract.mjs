const allowedStates=new Set(["queued","running","paused","completed","failed"]);
const scopes=new Set(["read","navigate","inspect","download","interactive","remote"]);
export function validateProfile(p){
 if(!p||typeof p!=="object"||Array.isArray(p))return {ok:false,code:"PROFILE_INVALID"};
 if(typeof p.id!=="string"||!p.id.trim()||typeof p.label!=="string"||!p.label.trim())return {ok:false,code:"PROFILE_ID_REQUIRED"};
 if(!Array.isArray(p.scopes)||p.scopes.some(s=>!scopes.has(s)))return {ok:false,code:"PROFILE_SCOPE_INVALID"};
 if(p.secret||p.password||p.cookies||p.sessionToken||p.accessToken)return {ok:false,code:"SECRET_MATERIAL_FORBIDDEN"};
 return {ok:true,profile:{id:p.id,label:p.label,scopes:[...new Set(p.scopes)],createdAt:p.createdAt||null}};
}
export function validateCheckpoint(c){
 if(!c||typeof c!=="object"||Array.isArray(c))return {ok:false,code:"CHECKPOINT_INVALID"};
 if(typeof c.taskId!=="string"||!c.taskId.trim()||typeof c.profileId!=="string"||!c.profileId.trim())return {ok:false,code:"CHECKPOINT_ID_REQUIRED"};
 if(!allowedStates.has(c.state))return {ok:false,code:"CHECKPOINT_STATE_INVALID"};
 if(typeof c.updatedAt!=="number"||!Number.isFinite(c.updatedAt))return {ok:false,code:"CHECKPOINT_TIMESTAMP_INVALID"};
 if(c.rawCookies||c.password||c.sessionToken||c.accessToken||c.otp)return {ok:false,code:"SECRET_MATERIAL_FORBIDDEN"};
 return {ok:true,checkpoint:{taskId:c.taskId,profileId:c.profileId,state:c.state,updatedAt:c.updatedAt,evidenceRefs:Array.isArray(c.evidenceRefs)?c.evidenceRefs.filter(x=>typeof x==="string").slice(0,20):[]}};
}
export function resumeDecision(c){
 const v=validateCheckpoint(c); if(!v.ok)return {allowed:false,code:v.code};
 if(c.state==="completed"||c.state==="failed")return {allowed:false,code:"TASK_TERMINAL"};
 if(c.state==="running")return {allowed:false,code:"RUNNING_TASK_REQUIRES_LEASE_RECOVERY"};
 return {allowed:true,code:"RESUME_ALLOWED"};
}
