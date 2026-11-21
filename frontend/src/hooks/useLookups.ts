import { useQuery } from "@tanstack/react-query"

import { api } from "@/lib/api"
import type { DirectoryEntry, MasterEntry } from "@/lib/types"

const LONG = 5 * 60 * 1000

/** The signed-in user, with role. */
export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: LONG })
}

function toMap<T extends { id: string }>(rows: T[] | undefined): Record<string, T> {
  const out: Record<string, T> = {}
  for (const r of rows ?? []) out[r.id] = r
  return out
}

/** Master lists and people, plus id → entry maps for showing names. */
export function useLookups() {
  const me = useMe()
  const canSeePeople = me.data?.role === "manager" || me.data?.role === "admin"
  const customers = useQuery({ queryKey: ["master", "customers"], queryFn: () => api.master("customers"), staleTime: LONG })
  const domains = useQuery({ queryKey: ["master", "domains"], queryFn: () => api.master("domains"), staleTime: LONG })
  const types = useQuery({ queryKey: ["master", "request-types"], queryFn: () => api.master("request-types"), staleTime: LONG })
  const engineers = useQuery({
    queryKey: ["engineers"],
    queryFn: api.engineers,
    staleTime: LONG,
    enabled: canSeePeople,
  })
  const directory = useQuery({ queryKey: ["directory"], queryFn: api.directory, staleTime: LONG })
  const people = directory.data ?? []

  return {
    me: me.data,
    customers: (customers.data ?? []) as MasterEntry[],
    domains: (domains.data ?? []) as MasterEntry[],
    requestTypes: (types.data ?? []) as MasterEntry[],
    engineers: engineers.data?.data ?? [],
    customerById: toMap(customers.data),
    domainById: toMap(domains.data),
    typeById: toMap(types.data),
    personById: toMap(people),
  }
}

/** A person's display name, or a short fallback when the viewer cannot list users. */
export function personName(people: Record<string, DirectoryEntry>, id: string | null | undefined, meId?: string): string {
  if (!id) return "—"
  if (id === meId) return "You"
  const p = people[id]
  return p?.full_name || "Former user"
}
