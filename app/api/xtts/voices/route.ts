import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { getConnection } from '@/lib/services/connections';
import { addVoice, listVoices } from '@/lib/services/voices';
import { listVoiceFiles, saveVoiceFile } from '@/lib/services/xtts-voices';
import { langFromRequest, tServer } from '@/lib/i18n/server';

export async function GET() {
  return NextResponse.json({ voices: listVoiceFiles() });
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: tServer(req, 'error.invalidBody') }, { status: 400 });
  if (!/\.wav$/i.test(file.name)) return NextResponse.json({ error: tServer(req, 'xttsVoices.onlyWav') }, { status: 400 });
  try {
    const lang = langFromRequest(req);
    const name = saveVoiceFile(file.name, Buffer.from(await file.arrayBuffer()), undefined, lang);
    // xtts bağlantısı varsa havuza da ekle (yoksa sessiz geç; kullanıcı preset'le sonra eşitler)
    const db = getDb();
    if (getConnection(db, 'xtts') && !listVoices(db, 'xtts').some((v) => v.voice === name)) {
      addVoice(db, { provider: 'xtts', voice: name }, lang);
    }
    return NextResponse.json({ ok: true, name }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
