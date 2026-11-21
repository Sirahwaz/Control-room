import test from "node:test";
import assert from "node:assert/strict";
import { createNetworkPrivacyPolicy, validateTunnelProfile } from "./network-privacy-policy.mjs";

const profile={protocol:"socks5",host:"proxy.example",port:1080};
test("profile validation rejects malformed and unsupported profiles",()=>{
 assert.equal(validateTunnelProfile(profile).ok,true);
 assert.equal(validateTunnelProfile({...profile,port:70000}).ok,false);
 assert.equal(validateTunnelProfile({...profile,protocol:"ftp"}).ok,false);
});
test("kill switch blocks direct traffic until tunnel reports connected",()=>{
 const p=createNetworkPrivacyPolicy();
 assert.equal(p.configure(profile).ok,true);
 assert.equal(p.routeDecision({requestUrl:"https://example.com"}).action,"block");
 assert.equal(p.setState("connected").ok,true);
 assert.equal(p.routeDecision({requestUrl:"https://example.com"}).action,"tunnel");
});
test("disconnect/failure returns to blocked state with kill switch",()=>{
 const p=createNetworkPrivacyPolicy();
 p.configure(profile); p.setState("connected"); p.setState("failed","connect_error");
 assert.equal(p.routeDecision({requestUrl:"https://example.com"}).action,"block");
});
test("private content is not forwarded to remote tunnel",()=>{
 const p=createNetworkPrivacyPolicy({killSwitch:false});
 p.configure(profile); p.setState("connected");
 assert.equal(p.routeDecision({requestUrl:"https://example.com",isPrivate:true}).action,"local");
});
test("kill switch toggle and unsafe schemes",()=>{
 const p=createNetworkPrivacyPolicy();
 assert.equal(p.setKillSwitch(false).ok,true);
 assert.equal(p.routeDecision({requestUrl:"https://example.com"}).action,"direct");
 assert.equal(p.routeDecision({requestUrl:"file:///etc/passwd"}).action,"block");
});
