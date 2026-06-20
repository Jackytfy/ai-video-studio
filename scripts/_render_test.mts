import 'dotenv/config';
import { renderProjectInline } from '../src/lib/render/pipeline';

console.log('[TEST] Starting render for cmqgd7m0o000920ulwo1lj0y0...');
try {
  const r = await renderProjectInline('cmqgd7m0o000920ulwo1lj0y0', 'user_c5996fb4ca3f4483');
  console.log('[TEST] RESULT:', r);
} catch(e: any) {
  console.error('[TEST] ERROR:', e?.message || e);
}
