import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: doc } = await supabase.from('practiceiq_documents').select('storage_path').eq('id', id).single();
  if (doc?.storage_path) {
    await supabase.storage.from('practiceiq-docs').remove([doc.storage_path]);
  }
  const { error } = await supabase.from('practiceiq_documents').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
