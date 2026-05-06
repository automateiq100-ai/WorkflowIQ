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

export interface ServiceTemplate {
  id: string;
  owner_user_id: string;
  service: string;
  cadence: Cadence;
  deadline_day: number | null;
  deadline_month: number | null;
  followup_lead_days: number | null;
  active: boolean;
  created_at: string;
  doc_types?: ServiceTemplateDocType[];
}

export interface ClientService {
  id: string;
  client_id: string;
  owner_user_id: string;
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

export type TaskStatus = 'open' | 'in_progress' | 'review' | 'done';
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
