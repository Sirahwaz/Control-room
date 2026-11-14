export const AUTO_ROUTE_SELECT =
  "id,asset,network,route_kind,wallet_id,address_ref,active,auto_route,requires_approval,metadata";

export interface AutoRouteCandidate {
  active?: unknown;
  auto_route?: unknown;
  requires_approval?: unknown;
  route_kind?: unknown;
}

export function isAutoRouteEligible(route: AutoRouteCandidate): boolean {
  return route.active === true &&
    route.auto_route === true &&
    route.requires_approval === false &&
    route.route_kind === "receive";
}
