import axios, { AxiosError } from "axios"

import type {
  ActivityItem,
  Assignment,
  AttachmentItem,
  CalendarSettings,
  CommentItem,
  Dashboard,
  DirectoryEntry,
  Holiday,
  MasterEntry,
  Me,
  NotificationItem,
  Report,
  RequestCreate,
  RequestItem,
  RequestSla,
  RequestsList,
  RequestUpdate,
  SlaPolicy,
  TimeLog,
  UsersList,
  Visibility,
  WorkloadRow,
} from "./types"

export const http = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL ?? ""}/api/v1`,
  // FastAPI expects repeated keys for lists: ?status=a&status=b
  paramsSerializer: { indexes: null },
})

http.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token")
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

http.interceptors.response.use(undefined, (error: AxiosError) => {
  if (error.response?.status === 401) {
    localStorage.removeItem("access_token")
    window.location.href = "/login"
  }
  return Promise.reject(error)
})

/** A readable message from an API error. */
export function errorMessage(err: unknown): string {
  if (err instanceof AxiosError) {
    const detail = (err.response?.data as { detail?: unknown } | undefined)?.detail
    if (typeof detail === "string") return detail
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: string; loc?: unknown[] }
      const field = Array.isArray(first.loc) ? first.loc[first.loc.length - 1] : ""
      return `${field ? `${String(field)}: ` : ""}${first.msg ?? "Invalid value"}`
    }
    return err.message
  }
  return err instanceof Error ? err.message : "Something went wrong"
}

const get = async <T>(url: string, params?: object): Promise<T> =>
  (await http.get<T>(url, { params })).data
const post = async <T>(url: string, body?: unknown): Promise<T> =>
  (await http.post<T>(url, body)).data
const patch = async <T>(url: string, body?: unknown): Promise<T> =>
  (await http.patch<T>(url, body)).data
const put = async <T>(url: string, body?: unknown): Promise<T> =>
  (await http.put<T>(url, body)).data
const del = async <T>(url: string): Promise<T> => (await http.delete<T>(url)).data

export type MasterKind = "customers" | "domains" | "request-types" | "data-sources"

export interface RequestFilters {
  q?: string
  status?: string[]
  priority?: string[]
  customer_id?: string
  domain_id?: string
  engineer_id?: string
  overdue?: boolean
  mine?: boolean
  sort?: string
  skip?: number
  limit?: number
}

export const api = {
  me: () => get<Me>("/users/me"),
  users: () => get<UsersList>("/users/", { limit: 500 }),
  engineers: () => get<UsersList>("/users/engineers"),
  directory: () => get<DirectoryEntry[]>("/users/directory"),
  createUser: (body: Partial<Me> & { password: string }) => post<Me>("/users/", body),
  updateUser: (id: string, body: Partial<Me> & { password?: string }) =>
    patch<Me>(`/users/${id}`, body),
  deactivateUser: (id: string) => del<{ message: string }>(`/users/${id}`),

  master: (kind: MasterKind, includeInactive = false) =>
    get<MasterEntry[]>(`/master/${kind}`, { include_inactive: includeInactive }),
  createMaster: (kind: MasterKind, body: Partial<MasterEntry>) =>
    post<MasterEntry>(`/master/${kind}`, body),
  updateMaster: (kind: MasterKind, id: string, body: Partial<MasterEntry>) =>
    patch<MasterEntry>(`/master/${kind}/${id}`, body),

  requests: (f: RequestFilters) => get<RequestsList>("/requests/", f),
  request: (id: string) => get<RequestItem>(`/requests/${id}`),
  createRequest: (body: RequestCreate) => post<RequestItem>("/requests/", body),
  updateRequest: (id: string, body: RequestUpdate) => patch<RequestItem>(`/requests/${id}`, body),
  move: (id: string, action: string, reason?: string) =>
    post<RequestItem>(`/requests/${id}/transitions`, { action, reason: reason || null }),
  actions: (id: string) => get<string[]>(`/requests/${id}/actions`),
  activity: (id: string) => get<ActivityItem[]>(`/requests/${id}/activity`),
  sla: (id: string) => get<RequestSla>(`/requests/${id}/sla`),

  assignments: (id: string) => get<Assignment[]>(`/requests/${id}/assignments`),
  assign: (
    id: string,
    body: { engineer_id: string; assignment_role: string; level: string; estimated_hours: string },
  ) => post<Assignment>(`/requests/${id}/assignments`, body),
  release: (id: string, assignmentId: string) =>
    del<{ message: string }>(`/requests/${id}/assignments/${assignmentId}`),
  timelogs: (id: string) => get<TimeLog[]>(`/requests/${id}/timelogs`),
  logHours: (id: string, body: { work_date: string; hours: string; note?: string }) =>
    post<TimeLog>(`/requests/${id}/timelogs`, body),

  comments: (id: string) => get<CommentItem[]>(`/requests/${id}/comments`),
  addComment: (id: string, body: string, visibility: Visibility) =>
    post<CommentItem>(`/requests/${id}/comments`, { body, visibility }),

  attachments: (id: string) => get<AttachmentItem[]>(`/requests/${id}/attachments`),
  upload: (id: string, file: File, isOutput: boolean, visibility: Visibility) => {
    const form = new FormData()
    form.append("file", file)
    form.append("is_output", String(isOutput))
    form.append("visibility", visibility)
    return post<AttachmentItem>(`/requests/${id}/attachments`, form)
  },
  downloadAttachment: async (id: string, att: AttachmentItem) => {
    const res = await http.get(`/requests/${id}/attachments/${att.id}`, { responseType: "blob" })
    const url = URL.createObjectURL(res.data as Blob)
    const a = document.createElement("a")
    a.href = url
    a.download = att.file_name
    a.click()
    URL.revokeObjectURL(url)
  },

  dashboard: (params: object) => get<Dashboard>("/dashboard", params),
  workload: () => get<WorkloadRow[]>("/workload"),

  reports: (params?: object) => get<Report[]>("/reports/", params),
  createReport: (body: Partial<Report>) => post<Report>("/reports/", body),
  updateReport: (id: string, body: Partial<Report>) => patch<Report>(`/reports/${id}`, body),

  notifications: () => get<{ data: NotificationItem[]; unread: number }>("/notifications/"),
  readNotification: (id: string) => post<{ message: string }>(`/notifications/${id}/read`),
  readAllNotifications: () => post<{ message: string }>("/notifications/read-all"),

  slaPolicies: () => get<SlaPolicy[]>("/admin/sla-policies"),
  createSlaPolicy: (body: Omit<SlaPolicy, "id">) => post<SlaPolicy>("/admin/sla-policies", body),
  updateSlaPolicy: (id: string, body: Omit<SlaPolicy, "id">) =>
    put<SlaPolicy>(`/admin/sla-policies/${id}`, body),
  holidays: (year?: number) => get<Holiday[]>("/admin/holidays", { year }),
  addHoliday: (body: Omit<Holiday, "id">) => post<Holiday>("/admin/holidays", body),
  removeHoliday: (id: string) => del<{ message: string }>(`/admin/holidays/${id}`),
  calendar: () => get<CalendarSettings>("/admin/calendar"),
  saveCalendar: (body: CalendarSettings) => put<CalendarSettings>("/admin/calendar", body),
  recalculateSla: () => post<{ message: string }>("/admin/recalculate-sla"),
}
