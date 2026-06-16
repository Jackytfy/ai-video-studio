const fs = require('fs');
const files = [
  'src/app/api/projects/route.ts',
  'src/app/api/projects/[id]/quick-generate/route.ts',
  'src/app/api/projects/[id]/storyboard/generate/route.ts',
  'src/app/api/projects/[id]/storyboard/confirm/route.ts',
  'src/lib/ai/prompts/analysis.ts',
  'src/lib/ai/types.ts',
  'src/lib/ai/router.ts',
  'src/lib/ai/claude.ts',
  'src/lib/ai/openai.ts',
  'src/components/landing/StyleSelector.tsx',
  'src/app/(platform)/create/page.tsx',
];
for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  const opens = (content.match(/{/g) || []).length;
  const closes = (content.match(/}/g) || []).length;
  const ok = opens === closes;
  console.log((ok ? 'OK' : 'BRACE_MISMATCH') + ' (' + opens + '/' + closes + '): ' + f.split('/').pop());
}
