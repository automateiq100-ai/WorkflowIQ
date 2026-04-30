import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('practiceiq_documents')
    .select('*')
    .order('uploaded_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const withUrls = await Promise.all((data ?? []).map(async d => {
    const { data: signed } = await supabase.storage
      .from('practiceiq-docs')
      .createSignedUrl(d.storage_path, 60 * 60);
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
  const clientId = form.get('client_id') as string | null;
  const category = form.get('category') as string | null;
  const fy = form.get('fy') as string | null;

  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 });

  const safeName = file.name.replace(/[^\w.\-]/g, '_');
  const path = `${user.id}/${clientId ?? 'unfiled'}/${Date.now()}_${safeName}`;

  const { error: upErr } = await supabase.storage
    .from('practiceiq-docs')
    .upload(path, file, { contentType: file.type, upsert: false });

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { data, error } = await supabase
    .from('practiceiq_documents')
    .insert({ owner_user_id: user.id, client_id: clientId || null, storage_path: path, filename: file.name, category, fy, size_bytes: file.size })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
