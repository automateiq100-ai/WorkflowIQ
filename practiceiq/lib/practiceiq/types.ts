export type ClientType = 'individual' | 'company' | 'llp' | 'partnership';
export type ServiceTag = 'gst' | 'tds' | 'itr' | 'audit' | 'roc' | 'bookkeeping';

export interface Client {
  id: string;
  owner_user_id: string;
  name: string;
  pan: string | null;
  gstin: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  client_type: ClientType | null;
  services: ServiceTag[] | null;
  assigned_to: string | null;
  notes: string | null;
  created_at: string;
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
  recurring_template_id: string | null;
  completed_at: string | null;
  created_at: string;
}

export type Cadence = 'monthly' | 'quarterly' | 'annual';

export interface RecurringTemplate {
  id: string;
  owner_user_id: string;
  client_id: string | null;
  title: string;
  cadence: Cadence;
  day_of_month: number | null;
  month_of_year: number | null;
  fee_amount: number | null;
  assigned_to: string | null;
  active: boolean;
  last_spawned_for: string | null;
  created_at: string;
}

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
  owner_user_id: string;
  firm_name: string | null;
  firm_gstin: string | null;
  firm_pan: string | null;
  firm_address: string | null;
  default_tax_rate: number;
  invoice_prefix: string;
  invoice_counter: number;
}

export interface ComplianceEvent {
  date: string;        // ISO yyyy-mm-dd
  title: string;
  type: 'gst' | 'tds' | 'itr' | 'roc' | 'tax' | 'other';
  description?: string;
}
