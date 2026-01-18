/* scripts/generate-doc-index.js
   Auto-generates src/assets/documents/index.json from PDFs in src/assets/documents/

   Rules:
   - Includes ALL *.pdf files found in src/assets/documents
   - Title is derived from filename (underscores/dashes -> spaces, trimmed, Title Case-ish)
   - Tags are auto-derived from keywords in filename
*/

const fs = require('fs');
const path = require('path');

const DOC_DIR = path.join(process.cwd(), 'src', 'assets', 'documents');
const OUT_FILE = path.join(DOC_DIR, 'index.json');

function toTitle(filenameNoExt) {
  // Replace underscores/dashes with spaces, collapse whitespace, trim
  const cleaned = filenameNoExt
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Simple Title Case (keeps short words lowercase except first)
  const lowerWords = new Set(['a','an','and','as','at','by','for','from','in','of','on','or','the','to','with']);
  const parts = cleaned.split(' ');

  return parts
    .map((w, i) => {
      const lw = w.toLowerCase();
      if (i !== 0 && lowerWords.has(lw)) return lw;
      return lw.charAt(0).toUpperCase() + lw.slice(1);
    })
    .join(' ');
}

function tagsFromName(name) {
  const n = name.toLowerCase();
  const tags = new Set();

  // Generic
  tags.add('docs');

  // Keyword tags
  if (n.includes('mirage')) tags.add('mirage');
  if (n.includes('wind')) tags.add('wind');
  if (n.includes('effects')) tags.add('effects');
  if (n.includes('load')) tags.add('load dev');
  if (n.includes('prep')) tags.add('prep');
  if (n.includes('reloading') || n.includes('reload')) tags.add('reloading');
  if (n.includes('acronym')) tags.add('acronyms');
  if (n.includes('manual')) tags.add('manual');
  if (n.includes('target')) tags.add('targets');
  if (n.includes('preloading') || n.includes('pre-loading')) tags.add('preparation');
  if (n.includes('checklist')) tags.add('checklist');
  if (n.includes('range')) tags.add('range');
  if (n.includes('ballistic') || n.includes('ballistics')) tags.add('ballistics');

  return Array.from(tags);
}

function main() {
  if (!fs.existsSync(DOC_DIR)) {
    console.error(`ERROR: Documents folder not found: ${DOC_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(DOC_DIR)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  const docs = files.map(file => {
    const base = file.replace(/\.pdf$/i, '');
    return {
      title: toTitle(base),
      file,
      tags: tagsFromName(base),
    };
  });

  fs.writeFileSync(OUT_FILE, JSON.stringify(docs, null, 2) + '\n', 'utf8');

  console.log(`Generated ${path.relative(process.cwd(), OUT_FILE)} with ${docs.length} PDF(s).`);
  docs.forEach(d => console.log(` - ${d.file}  =>  ${d.title}`));
}

main();
