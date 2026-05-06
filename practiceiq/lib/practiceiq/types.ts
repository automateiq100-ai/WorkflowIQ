export type FirmRole = 'admin' | 'dept_head' | 'staff' | 'hr_admin';

export interface Firm {
  id: string;
  name: string;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  state_code: string | null;
  created_at: string;
}

export interface FirmUser {
  firm_id: string;
  user_id: string;
  role: FirmRole;
  department_id: string | null;
  created_at: string;
  // Joined fields (populated when listing users with profile data)
  email?: string;
  display_name?: string;
}

export interface FirmInvite {
  token: string;
  firm_id: string;
  email: string;
  role: FirmRole;
  department_id: string | null;
  created_by: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  consumed_by_user_id: string | null;
}

export type ClientType = 'individual' | 'company' | 'llp' | 'partnership';

export interface Client {
  id: string;
  owner_user_id: string;
  name: string;
  pan: string | null;
  gstin: string | null;
  phone: string | null;
  address: string | null;
  client_type: ClientType | null;
  assigned_to: string | null;
  notes: string | null;
  followup_broadcast: boolean;
  created_at: string;
}

export interface ClientServiceDocType {
  id: string;
  client_service_id: string;
  owner_user_id: string;
  doc_type: string;
  label: string | null;
  created_at: string;
}

export interface ServiceTemplateDocType {
  id: string;
  template_id: string;
  owner_user_id: string;
  doc_type: string;
  label: string | null;
  created_at: string;
}

export interface ServiceModule {
  id: string;
  firm_id: string;
  name: string;
  code: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  sort_order: number;
  is_system: boolean;
  created_at: string;
  filing_count?: number;
}

export interface ServiceTemplate {
  id: string;
  owner_user_id: string;
  module_id: string | null;
  service: string;
  cadence: Cadence;
  deadline_day: number | null;
  deadline_month: number | null;
  followup_lead_days: number | null;
  active: boolean;
  is_system: boolean;
  created_at: string;
  doc_types?: ServiceTemplateDocType[];
}

export interface ClientService {
  id: string;
  client_id: string;
  owner_user_id: string;
  module_id: string | null;
  service: string;
  cadence: Cadence;
  deadline_day: number | null;
  deadline_month: number | null;
  followup_lead_days: number | null;
  active: boolean;
  created_at: string;
  doc_types?: ClientServiceDocType[];
}

export interface ClientEmail {
  id: string;
  client_id: string;
  owner_user_id: string;
  email: string;
  label: string | null;
  is_primary: boolean;
  added_at: string;
}

export interface ClientTelegramAccount {
  id: string;
  client_id: string;
  owner_user_id: string;
  telegram_chat_id: number;
  telegram_username: string | null;
  telegram_first_name: string | null;
  label: string | null;
  consent_given: boolean;
  consent_at: string | null;
  is_primary: boolean;
  added_at: string;
}

export interface TelegramInvite {
  token: string;
  client_id: string;
  owner_user_id: string;
  label: string | null;
  created_by: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  consumed_by_chat_id: number | null;
}

export type TaskStatus = 'open' | 'processing' | 'review' | 'done';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Task {
  id: string;
  owner_user_id: string;
  client_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  assigned_to: string | null;
  fee_amount: number | null;
  completed_at: string | null;
  created_at: string;
  // RBAC + dashboard extensions
  task_number: number | null;
  service_type: string | null;
  chargeable: boolean;
  financial_year: string | null;
}

export interface TaskStats {
  due_today: number;
  due_tomorrow: number;
  due_in_7_days: number;
  due_after_7_days: number;
  overdue_le_7_days: number;
  overdue_gt_7_days: number;
  due_total: number;
  chargeable_total: number;
  non_chargeable_total: number;
}

export type PermissionModule =
  | 'dashboard' | 'clients' | 'services' | 'calendar' | 'tasks' | 'documents'
  | 'invoices' | 'hrms' | 'hrms_admin' | 'admin' | 'reports';

export const ALL_PERMISSION_MODULES: PermissionModule[] = [
  'dashboard','clients','services','calendar','tasks','documents',
  'invoices','hrms','hrms_admin','admin','reports',
];

export interface Role {
  id: string;
  firm_id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  system_key: string | null;
  restrict_to_assigned_clients: boolean;
  created_at: string;
}

export interface RolePermission {
  role_id: string;
  module: PermissionModule;
  can_read: boolean;
  can_write: boolean;
}

export type PermissionMap = Record<PermissionModule, { can_read: boolean; can_write: boolean }>;

export interface UserClientAssignment {
  firm_id: string;
  user_id: string;
  client_id: string;
  assigned_at: string;
  assigned_by: string | null;
}

// ===== HRMS =====
export type EmployeeStatus = 'active' | 'inactive';

export interface Department {
  id: string;
  firm_id: string;
  name: string;
  head_employee_id: string | null;
  created_at: string;
}

export interface Employee {
  id: string;
  firm_id: string;
  user_id: string | null;
  employee_code: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  designation: string | null;
  department_id: string | null;
  manager_id: string | null;
  date_of_joining: string | null;
  status: EmployeeStatus;
  created_at: string;
}

export interface AttendanceRecord {
  id: string;
  firm_id: string;
  employee_id: string;
  date: string; // yyyy-mm-dd
  check_in_at: string | null;
  check_out_at: string | null;
  source: 'web' | 'manual';
}

export type LeaveType = 'casual' | 'sick' | 'earned' | 'unpaid';
export type LeaveStatus = 'pending' | 'approved' | 'rejected';

export interface LeaveRequest {
  id: string;
  firm_id: string;
  employee_id: string;
  leave_type: LeaveType;
  from_date: string;
  to_date: string;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  approver_employee_id: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}

export type ExpenseCategory = 'travel' | 'meals' | 'supplies' | 'other';
export type ExpenseStatus = 'pending' | 'approved' | 'rejected';

export interface ExpenseClaim {
  id: string;
  firm_id: string;
  employee_id: string;
  claim_date: string;
  category: ExpenseCategory;
  amount: number;
  currency: string;
  description: string | null;
  receipt_url: string | null;
  status: ExpenseStatus;
  approver_employee_id: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}

export interface TimesheetEntry {
  id: string;
  firm_id: string;
  employee_id: string;
  date: string;
  client_id: string | null;
  task_id: string | null;
  hours: number;
  description: string | null;
  billable: boolean;
  created_at: string;
}

export type Cadence = 'monthly' | 'quarterly' | 'annual';

export interface InvoiceLineItem {
  description: string;
  qty: number;
  rate: number;
  amount: number;
  task_id?: string;
}

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue';

export interface Invoice {
  id: string;
  owner_user_id: string;
  client_id: string | null;
  invoice_number: string;
  issue_date: string;
  due_date: string | null;
  line_items: InvoiceLineItem[];
  subtotal: number;
  tax_amount: number;
  total: number;
  status: InvoiceStatus;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface DocumentMeta {
  id: string;
  owner_user_id: string;
  client_id: string | null;
  storage_path: string;
  filename: string;
  category: string | null;
  fy: string | null;
  size_bytes: number | null;
  uploaded_at: string;
}

export interface FirmSettings {
  firm_id: string;
  firm_name: string | null;
  firm_gstin: string | null;
  firm_pan: string | null;
  firm_address: string | null;
  default_tax_rate: number;
  invoice_prefix: string;
  invoice_counter: number;
  ca_telegram_chat_id: string | null;
  client_agent_prompt: string | null;
}

export interface ComplianceEvent {
  date: string;        // ISO yyyy-mm-dd
  title: string;
  type: 'gst' | 'tds' | 'itr' | 'roc' | 'tax' | 'other';
  description?: string;
}
