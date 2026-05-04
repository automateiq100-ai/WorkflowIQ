import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/heic', 'image/heif',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv', 'text/plain',
  'application/xml', 'text/xml',
]);
const MAX_BYTES = 50 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 5 * 60;

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const clientId = url.searchParams.get('client_id');
  const period = url.searchParams.get('period');
  const docType = url.searchParams.get('doc_type');

  let q = supabase
    .from('practiceiq_documents')
    .select('*')
    .eq('owner_user_id', user.id)
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: false });

  if (status) q = q.eq('status', status);
  if (clientId) q = q.eq('client_id', clientId);
  if (period) q = q.eq('filing_period', period);
  if (docType) q = q.eq('doc_type', docType);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const withUrls = await Promise.all((data ?? []).map(async d => {
    const { data: signed } = await supabase.storage
      .from('practiceiq-docs')
      .createSignedUrl(d.storage_path, SIGNED_URL_TTL_SECONDS);
    return { ...d, signed_url: signed?.signedUrl ?? null };
  }));

  return NextResponse.json({ data: withUrls });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const form = await req.formData();
  const file = form.get('file') as File | null;
  const clientId = (form.get('client_id') as string | null) || null;
  const docType = (form.get('doc_type') as string | null) || null;
  const filingPeriod = (form.get('filing_period') as string | null) || null;
  // Back-compat with old form fields
  const category = (form.get('category') as string | null) || null;
  const fy = (form.get('fy') as string | null) || null;

  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 });

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large. Max 50 MB; got ${(file.size / 1024 / 1024).toFixed(1)} MB.` },
      { status: 413 }
    );
  }
  if (file.type && !ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: `MIME type ${file.type} not allowed. Allowed: PDF, JPG, PNG, HEIC, XLSX, XLS, CSV, TXT, XML.` },
      { status: 415 }
    );
  }

  const safeName = file.name.replace(/[^\w.\-]/g, '_');
  const ts = Date.now();
  const periodSeg = filingPeriod || 'unfiled';
  const docTypeSeg = docType || 'unclassified';
  const clientSeg = clientId || 'unfiled';
  const path = `${user.id}/${clientSeg}/${periodSeg}/${docTypeSeg}/${ts}_${safeName}`;

  const { error: upErr } = await supabase.storage
    .from('practiceiq-docs')
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const retentionUntil = new Date();
  retentionUntil.setFullYear(retentionUntil.getFullYear() + 1);

  const { data, error } = await supabase
    .from('practiceiq_documents')
    .insert({
      owner_user_id: user.id,
      client_id: clientId,
      storage_path: path,
      filename: file.name,
      size_bytes: file.size,
      mime_type: file.type || null,
      doc_type: docType,
      filing_period: filingPeriod,
      category,
      fy,
      source: 'manual',
      uploaded_by: user.id,
      status: 'received',
      retention_until: retentionUntil.toISOString().slice(0, 10),
      is_sensitive: true,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
