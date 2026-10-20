// A deliberately rough monthly price list, so "add 50 replicas" has a cost to weigh against.
// The numbers are round, ballpark cloud prices per running instance, not quotes; what matters is
// their ratio (a database replica costs a lot more than a cache node or an app server).

import type { ComponentKind } from './catalog'
import type { Design, DesignNode } from './design'

/** US dollars per month for one instance (replica, or replica × shard for SQL). */
export const MONTHLY_COST: Record<ComponentKind, number> = {
  client: 0,
  dns: 5,
  cdn: 50,
  'load-balancer': 25,
  'api-gateway': 40,
  service: 60,
  worker: 40,
  cache: 50,
  'sql-db': 200,
  'nosql-db': 150,
  'object-storage': 25,
  search: 150,
  queue: 20,
  stream: 120,
  'external-api': 50,
}

export function componentCost(node: DesignNode): number {
  const instances = (node.params.replicas ?? 1) * (node.params.shards ?? 1)
  return MONTHLY_COST[node.kind] * instances
}

export function monthlyCost(design: Design): number {
  return design.nodes.reduce((sum, node) => sum + componentCost(node), 0)
}
