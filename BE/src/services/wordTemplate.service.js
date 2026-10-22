const { execFile } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const fflate = require('fflate');

const run = promisify(execFile);

// --- reading and writing Word files ---------------------------------------
// A .docx is a zip of XML. The placeholders live in the text of the runs, so
// they are replaced in the document body, the headers and the footers.
const PLACEHOLDER = /\{\{\s*([A-Za-z ]+?)\s*\}\}/g;

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Replace the placeholders that live inside a single text node.
function replaceInTextNodes(xml, data) {
  return xml.replace(/<w:t([^>]*)>([\s\S]*?)<\/w:t>/g, (match, attributes, text) => {
    if (!text.includes('{{')) return match;
    const filled = text.replace(PLACEHOLDER, (whole, name) => {
      const value = data[name.trim()];
      return value === undefined || value === null ? '' : escapeXml(value);
    });
    if (filled === text) return match;
    return `<w:t${attributes}>${filled}</w:t>`;
  });
}

// Some Word files split a placeholder over several runs. Join the text of
// every paragraph, work out where each value belongs, then put the paragraph
// back together with the value in the run where the placeholder starts.
function replaceAcrossRuns(xml, data) {
  return xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraph) => {
    if (!paragraph.includes('{{')) return paragraph;
    const nodePattern = /<w:t([^>]*)>([\s\S]*?)<\/w:t>/g;
    const nodes = [...paragraph.matchAll(nodePattern)];
    if (!nodes.length) return paragraph;
    const joined = nodes.map((node) => node[2]).join('');
    const matches = [...joined.matchAll(/\{\{\s*([A-Za-z ]+?)\s*\}\}/g)];
    if (!matches.length) return paragraph;

    // Where every run sits in the joined text.
    let position = 0;
    const spans = nodes.map((node) => {
      const span = { start: position, end: position + node[2].length, text: node[2] };
      position = span.end;
      return span;
    });

    // Rebuild the text of every run. A run that holds the start of a
    // placeholder gets the value; runs covered by the rest of it are emptied.
    const rebuilt = spans.map((span) => {
      let text = '';
      let cursor = span.start;
      for (const match of matches) {
        const start = match.index;
        const end = start + match[0].length;
        if (end <= span.start || start >= span.end) continue;
        if (start > cursor) text += joined.slice(cursor, Math.min(start, span.end));
        if (start >= span.start) {
          const value = data[match[1].trim()];
          text += value === undefined || value === null ? '' : escapeXml(value);
        }
        cursor = Math.max(cursor, Math.min(end, span.end));
      }
      if (cursor < span.end) text += joined.slice(cursor, span.end);
      return text;
    });

    let index = -1;
    return paragraph.replace(nodePattern, (whole, attributes, text) => {
      index += 1;
      if (rebuilt[index] === text) return whole;
      return `<w:t${attributes}>${rebuilt[index]}</w:t>`;
    });
  });
}

// Put the values of a person into a Word template.
function fillDocx(buffer, data) {
  const zip = fflate.unzipSync(new Uint8Array(buffer));
  const out = {};
  for (const [name, content] of Object.entries(zip)) {
    if (!name.endsWith('.xml')) {
      out[name] = content;
      continue;
    }
    if (!/^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(name)) {
      out[name] = content;
      continue;
    }
    let text = Buffer.from(content).toString('utf8');
    text = replaceInTextNodes(text, data);
    text = replaceAcrossRuns(text, data);
    out[name] = fflate.strToU8(text);
  }
  return Buffer.from(fflate.zipSync(out, { level: 6 }));
}

// --- turning a Word file into a PDF ---------------------------------------
// The container carries LibreOffice for this. It keeps the fonts the file
// embeds, so the contract looks the way it was designed.
async function docxToPdf(buffer, name = 'contract.docx') {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'telos-docx-'));
  const source = path.join(work, path.basename(name).replace(/[^\w.-]/g, '_') || 'contract.docx');
  try {
    await fs.writeFile(source, buffer);
    await run('soffice', [
      '--headless',
      '--norestore',
      '--invisible',
      `-env:UserInstallation=file://${path.join(work, 'profile')}`,
      '--convert-to',
      'pdf',
      '--outdir',
      work,
      source
    ], { timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
    const files = await fs.readdir(work);
    const pdfName = files.find((file) => file.toLowerCase().endsWith('.pdf'));
    if (!pdfName) throw new Error('The document could not be turned into a PDF');
    return await fs.readFile(path.join(work, pdfName));
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

// Several documents in one go: the office starts once, which matters when a
// whole team gets their contract at the same time.
async function docxFilesToPdf(files) {
  if (!files.length) return [];
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'telos-docx-'));
  const written = [];
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const name = `contract-${index}-${path.basename(file.name || 'contract.docx').replace(/[^\w.-]/g, '_')}`;
      const source = path.join(work, name);
      await fs.writeFile(source, file.buffer);
      written.push({ source, name });
    }
    await run('soffice', [
      '--headless',
      '--norestore',
      '--invisible',
      `-env:UserInstallation=file://${path.join(work, 'profile')}`,
      '--convert-to',
      'pdf',
      '--outdir',
      work,
      ...written.map((file) => file.source)
    ], { timeout: 600000, maxBuffer: 16 * 1024 * 1024 });
    const results = [];
    for (const file of written) {
      const pdfName = file.name.replace(/\.docx$/i, '.pdf');
      const target = path.join(work, pdfName);
      try {
        results.push(await fs.readFile(target));
      } catch {
        results.push(null);
      }
    }
    return results;
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

module.exports = {
  fillDocx,
  docxToPdf,
  docxFilesToPdf,
  replaceInTextNodes,
  replaceAcrossRuns
};
