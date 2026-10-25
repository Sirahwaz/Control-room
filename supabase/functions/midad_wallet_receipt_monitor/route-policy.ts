export interface ReceiptMonitorRouteCandidate {
  active?: unknown;
  route_kind?: unknown;
  auto_route?: unknown;
  requires_approval?: unknown;
}

export function isReceiptMonitorRouteEligible(
  route: ReceiptMonitorRouteCandidate,
): boolean {
  return route.active === true && route.route_kind === "receive";
}
