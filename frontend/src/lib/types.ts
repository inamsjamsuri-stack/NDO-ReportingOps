// Types for the ReportOps API (backend/app/models.py).
// Hand-written so the app does not depend on regenerating the OpenAPI client.

export type Role = "admin" | "manager" | "engineer" | "requester"

export type Status =
  | "submitted"
  | "under_assessment"
  | "approved"
  | "assigned"
  | "in_progress"
  | "under_review"
  | "completed"
  | "rejected"
  | "on_hold"
  | "cancelled"

export type Priority = "critical" | "high" | "medium" | "low"
export type Category = "regular" | "ad_hoc"
export type Frequency = "daily" | "weekly" | "monthly" | "one_time"
export type Visibility = "public" | "internal"
export type AutomationStatus = "fully_automated" | "hybrid" | "manual"

export interface Me {
  id: string
  email: string
  full_name: string | null
  role: Role
  is_active: boolean
  is_superuser: boolean
  customer_id: string | null
  approval_status?: "approved" | "pending" | "rejected"
  registration_note?: string | null
  must_change_password?: boolean
  created_at?: string | null
}

export interface SignupOptions {
  enabled: boolean
  allowed_domains: string[]
  customers: { id: string; name: string }[]
}

export interface DirectoryEntry {
  id: string
  full_name: string | null
  role: Role
}

export interface UsersList {
  data: Me[]
  count: number
}

export interface MasterEntry {
  id: string
  name: string
  sort_order: number
  is_active: boolean
  kind?: "external" | "internal" | null
  code?: string | null
}

export interface RequestItem {
  id: string
  code: string
  title: string
  requester_id: string
  submitted_by_id: string
  customer_id: string
  category: Category
  request_type_id: string
  domain_id: string
  report_id: string | null
  report_name: string | null
  frequency: Frequency
  business_purpose: string
  priority: Priority
  required_date: string
  committed_date: string | null
  committed_late_reason: string | null
  estimated_hours: string | null
  status: Status
  assessment_note: string | null
  submitted_at: string
  completed_at: string | null
  is_overdue: boolean
}

export interface RequestsList {
  data: RequestItem[]
  count: number
}

export interface RequestCreate {
  title: string
  requester_id?: string | null
  customer_id: string
  category: Category
  request_type_id: string
  domain_id: string
  report_id?: string | null
  report_name?: string | null
  frequency: Frequency
  business_purpose: string
  priority: Priority
  required_date: string
}

export type RequestUpdate = Partial<
  Omit<RequestCreate, "requester_id"> & {
    committed_date: string | null
    committed_late_reason: string | null
    estimated_hours: string | null
  }
>

export interface Assignment {
  id: string
  request_id: string
  engineer_id: string
  assignment_role: "primary" | "supporting"
  level: "L1" | "L2"
  estimated_hours: string
  is_active: boolean
  assigned_at: string
  released_at: string | null
  actual_hours: string
}

export interface TimeLog {
  id: string
  assignment_id: string
  work_date: string
  hours: string
  note: string | null
  created_at: string
}

export interface CommentItem {
  id: string
  author_id: string
  visibility: Visibility
  body: string
  edited_at: string | null
  deleted_at: string | null
  created_at: string
}

export interface ActivityItem {
  id: string
  actor_id: string | null
  kind: string
  data: Record<string, unknown>
  visibility: Visibility
  created_at: string
}

export interface AttachmentItem {
  id: string
  file_name: string
  mime_type: string
  size_bytes: number
  is_output: boolean
  visibility: Visibility
  uploaded_by_id: string
  created_at: string
}

export interface RequestSla {
  sla_policy_id: string | null
  response_due_at: string | null
  responded_at: string | null
  resolution_due_at: string | null
  resolved_at: string | null
  paused_min: number
  resolution_min: number | null
  resolution_target_min: number | null
  resolution_used_min: number | null
  is_at_risk: boolean
  is_breached: boolean
}

export interface CountItem {
  name: string
  count: number
}

export interface Dashboard {
  total_incoming: number
  open: number
  in_progress: number
  on_hold: number
  completed: number
  overdue: number
  avg_resolution_hours: number | null
  median_resolution_hours: number | null
  sla_compliance_pct: number | null
  by_domain: CountItem[]
  by_category: CountItem[]
}

export interface WorkloadRow {
  engineer_id: string
  full_name: string | null
  active_requests: number
  remaining_estimated_hours: string
  overdue_requests: number
}

export interface Report {
  id: string
  code: string
  name: string
  customer_id: string
  domain_id: string
  frequency: Frequency
  data_source_id: string | null
  data_source_note: string | null
  owner_id: string | null
  automation_status: AutomationStatus
  manual_effort_hours: string | null
  automation_blocker: string | null
  automation_conditions: string | null
  is_active: boolean
}

export interface NotificationItem {
  id: string
  request_id: string | null
  event: string
  title: string
  body: string | null
  read_at: string | null
  created_at: string
}

export interface SlaPolicy {
  id: string
  name: string
  priority: Priority
  category: Category | null
  request_type_id: string | null
  response_target_min: number
  resolution_target_min: number
  calendar: "working" | "24x7"
  is_active: boolean
}

export interface Holiday {
  id: string
  day: string
  name: string
  kind: "national" | "cuti_bersama" | "company"
}

export interface CalendarSettings {
  timezone: string
  work_days: number[]
  work_start: string
  work_end: string
  break_start: string | null
  break_end: string | null
}

export interface AuditEntry {
  id: number
  at: string
  actor_id: string | null
  action: string
  entity: string | null
  entity_id: string | null
  old_value: unknown
  new_value: unknown
  ip_address: string | null
}
