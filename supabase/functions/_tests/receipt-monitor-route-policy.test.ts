import { assertEquals } from "jsr:@std/assert@1";
import { isReceiptMonitorRouteEligible as isSolanaMonitorRouteEligible } from "../midad_wallet_receipt_monitor/route-policy.ts";
import { isReceiptMonitorRouteEligible as isEvmMonitorRouteEligible } from "../midad_multichain_usdt_monitor/route-policy.ts";

Deno.test("monitors active receive routes when automatic routing is disabled", () => {
  const manualRoute = {
    active: true,
    route_kind: "receive",
    auto_route: false,
    requires_approval: true,
  };
  assertEquals(isSolanaMonitorRouteEligible(manualRoute), true);
  assertEquals(isEvmMonitorRouteEligible(manualRoute), true);
});

Deno.test("automatic routing flags do not change monitoring eligibility", () => {
  const autoRoute = {
    active: true,
    route_kind: "receive",
    auto_route: true,
    requires_approval: false,
  };
  assertEquals(isSolanaMonitorRouteEligible(autoRoute), true);
  assertEquals(isEvmMonitorRouteEligible(autoRoute), true);
});

Deno.test("rejects inactive and non-receive routes", () => {
  const inactive = {
    active: false,
    route_kind: "receive",
    auto_route: false,
    requires_approval: true,
  };
  const reinvest = {
    active: true,
    route_kind: "reinvest",
    auto_route: false,
    requires_approval: true,
  };
  assertEquals(isSolanaMonitorRouteEligible(inactive), false);
  assertEquals(isEvmMonitorRouteEligible(inactive), false);
  assertEquals(isSolanaMonitorRouteEligible(reinvest), false);
  assertEquals(isEvmMonitorRouteEligible(reinvest), false);
});
