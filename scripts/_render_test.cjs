require('dotenv/config');

async function main() {
  // Dynamically import the TS module via tsx
  const { renderProjectInline } = await import('../src/lib/render/pipeline.ts');

  console.log('[TEST] Starting render for cmqgd7m0o000920ulwo1lj0y0...');
  try {
    const r = await renderProjectInline('cmqgd7m0o000920ulwo1lj0y0', 'user_c5996fb4ca3f4483');
    console.log('[TEST] RESULT:', r);
  } catch(e) {
    console.error('[TEST] ERROR:', e.message || e);
  }
}

main();
