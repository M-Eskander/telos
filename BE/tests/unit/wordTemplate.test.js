const fflate = require('fflate');
const {
  fillDocx,
  replaceInTextNodes,
  replaceAcrossRuns
} = require('../../src/services/wordTemplate.service');

const DATA = {
  Name: 'Salma Tamer',
  Department: 'Art',
  Role: '2D Animator',
  Hours: '40',
  Share: '7.78%'
};

const documentXml = (body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;

describe('Word template fill', () => {
  test('fills placeholders that sit inside one run', () => {
    const xml = documentXml('<w:p><w:r><w:t>Name: {{Name}}</w:t></w:r></w:p>');
    expect(replaceInTextNodes(xml, DATA)).toContain('Name: Salma Tamer');
  });

  test('fills a placeholder split over two runs exactly once', () => {
    const xml = '<w:p><w:r><w:t>Name: {{Na</w:t></w:r><w:r><w:t>me}}</w:t></w:r></w:p>';
    const filled = replaceAcrossRuns(xml, DATA);
    expect(filled).toContain('<w:t>Name: Salma Tamer</w:t>');
    expect(filled).toContain('<w:t></w:t>');
    expect(filled).not.toContain('Salma TamerSalma Tamer');
  });

  test('fills a placeholder split over three runs, keeping the text around it', () => {
    const xml = '<w:p><w:r><w:t>Hello {{Na</w:t></w:r><w:r><w:t>m</w:t></w:r><w:r><w:t>e}} — welcome</w:t></w:r></w:p>';
    const filled = replaceAcrossRuns(xml, DATA);
    expect(filled).toContain('<w:t>Hello Salma Tamer</w:t>');
    expect(filled).toContain('<w:t> — welcome</w:t>');
  });

  test('fills several placeholders in one paragraph', () => {
    const xml = '<w:p><w:r><w:t>{{Department}} / {{Role}} / {{Hours}}</w:t></w:r></w:p>';
    expect(replaceInTextNodes(xml, DATA)).toContain('<w:t>Art / 2D Animator / 40</w:t>');
  });

  test('fills a whole-run placeholder and a split one in the same paragraph', () => {
    const xml = '<w:p><w:r><w:t>{{Department}} {{Na</w:t></w:r><w:r><w:t>me}}</w:t></w:r></w:p>';
    let filled = replaceInTextNodes(xml, DATA);
    filled = replaceAcrossRuns(filled, DATA);
    expect(filled).toContain('<w:t>Art Salma Tamer</w:t>');
    expect(filled).toContain('<w:t></w:t>');
  });

  test('escapes XML in the values', () => {
    const xml = documentXml('<w:p><w:r><w:t>{{Name}}</w:t></w:r></w:p>');
    expect(replaceInTextNodes(xml, { Name: 'A & B <C>' })).toContain('A &amp; B &lt;C&gt;');
  });

  test('missing values become empty text', () => {
    const xml = documentXml('<w:p><w:r><w:t>[{{Missing}}]</w:t></w:r></w:p>');
    expect(replaceInTextNodes(xml, DATA)).toContain('<w:t>[]</w:t>');
  });

  test('fillDocx replaces placeholders in the document, headers and footers', () => {
    const zip = {
      '[Content_Types].xml': fflate.strToU8('<Types/>'),
      'word/document.xml': fflate.strToU8(documentXml('<w:p><w:r><w:t>{{Name}}</w:t></w:r></w:p>')),
      'word/header1.xml': fflate.strToU8('<w:hdr><w:p><w:r><w:t>{{Project}}</w:t></w:r></w:p></w:hdr>'),
      'word/footer1.xml': fflate.strToU8('<w:ftr><w:p><w:r><w:t>{{Studio}}</w:t></w:r></w:p></w:ftr>'),
      'word/media/logo.bin': fflate.strToU8('not xml at all {{Name}}')
    };
    const filled = fillDocx(Buffer.from(fflate.zipSync(zip)), {
      ...DATA,
      Project: '[Addiction]',
      Studio: 'Telos Studio'
    });
    const out = fflate.unzipSync(new Uint8Array(filled));
    const text = (name) => Buffer.from(out[name]).toString('utf8');

    expect(text('word/document.xml')).toContain('Salma Tamer');
    expect(text('word/header1.xml')).toContain('[Addiction]');
    expect(text('word/footer1.xml')).toContain('Telos Studio');
    // Files that are not Word text are untouched.
    expect(text('word/media/logo.bin')).toBe('not xml at all {{Name}}');
  });
});
