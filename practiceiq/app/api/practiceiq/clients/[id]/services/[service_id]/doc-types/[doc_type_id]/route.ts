import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; service_id: string; doc_type_id: string }> },
) {
  const { service_id, doc_type_id } = await params;
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { error } = await supabase
    .from('practiceiq_client_service_doc_types')
    .delete()
    .eq('id', doc_type_id)
    .eq('client_service_id', service_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
