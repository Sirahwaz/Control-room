import test from "node:test";
import assert from "node:assert/strict";
import { createNetworkPrivacyPolicy, validateTunnelProfile } from "./network-privacy-policy.mjs";

const profile={protocol:"socks5",host:"proxy.example",port:1080};
const attestation={source:"ai.midad.browser.vpnservice",sessionId:"session-1",status:"connected",interfaceName:"tun0",routesInstalled:true,dnsConfigured:true};
test("profile validation rejects malformed and unsupported profiles",()=>{
 assert.equal(validateTunnelProfile(profile).ok,true);
 assert.equal(validateTunnelProfile({...profile,port:70000}).ok,false);
 assert.equal(validateTunnelProfile({...profile,protocol:"ftp"}).ok,false);
 assert.equal(validateTunnelProfile({...profile,host:"proxy.example/path"}).ok,false);
});
test("kill switch remains closed until trusted native tunnel attestation",()=>{
 const p=createNetworkPrivacyPolicy();
 assert.equal(p.configure(profile).ok,true);
 assert.equal(p.setState("connected").error,"native_tunnel_attestation_required");
 assert.equal(p.routeDecision({requestUrl:"https://example.com"}).action,"block");
 assert.equal(p.reportNativeTunnel(attestation).ok,true);
 assert.equal(p.routeDecision({requestUrl:"https://example.com"}).action,"tunnel");
});
test("untrusted or incomplete native attestation cannot open the tunnel",()=>{
 const p=createNetworkPrivacyPolicy(); p.configure(profile);
 assert.equal(p.reportNativeTunnel({...attestation,source:"webview"}).error,"native_source_required");
 assert.equal(p.reportNativeTunnel({...attestation,routesInstalled:false}).error,"routes_or_dns_not_verified");
 assert.equal(p.routeDecision({requestUrl:"https://example.com"}).action,"block");
});
test("disconnect/failure and stale sessions return to blocked state",()=>{
 const p=createNetworkPrivacyPolicy(); p.configure(profile); p.reportNativeTunnel(attestation);
 assert.equal(p.reportNativeTunnel({...attestation,sessionId:"old",status:"disconnected"}).error,"stale_session_event");
 assert.equal(p.reportNativeTunnel({...attestation,status:"failed",error:"connect_error"}).ok,true);
 assert.equal(p.routeDecision({requestUrl:"https://example.com"}).action,"block");
});
test("private content is never forwarded to remote tunnel",()=>{
 const p=createNetworkPrivacyPolicy({killSwitch:false}); p.configure(profile); p.reportNativeTunnel(attestation);
 assert.equal(p.routeDecision({requestUrl:"https://example.com",isPrivate:true}).action,"local");
});
test("kill switch toggle and unsafe schemes",()=>{
 const p=createNetworkPrivacyPolicy();
 assert.equal(p.setKillSwitch(false).ok,true);
 assert.equal(p.routeDecision({requestUrl:"https://example.com"}).action,"direct");
 assert.equal(p.routeDecision({requestUrl:"file:///etc/passwd"}).action,"block");
});
test("proxy credentials are not exposed in configuration results or snapshots",()=>{
 const p=createNetworkPrivacyPolicy();
 const configured=p.configure({...profile,username:"u",password:"secret"});
 assert.equal(JSON.stringify(configured).includes("secret"),false);
 assert.equal(JSON.stringify(p.snapshot()).includes("secret"),false);
});
