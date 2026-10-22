const tokenService = require('../../src/services/onlyofficeToken.service');
const onlyoffice = require('../../src/services/onlyoffice.service');

const originalSecret = process.env.ONLYOFFICE_JWT_SECRET;
const originalInternal = process.env.ONLYOFFICE_INTERNAL_URL;
const originalApp = process.env.APP_BASE_URL;

afterAll(() => {
  if (originalSecret === undefined) delete process.env.ONLYOFFICE_JWT_SECRET;
  else process.env.ONLYOFFICE_JWT_SECRET = originalSecret;
  if (originalInternal === undefined) delete process.env.ONLYOFFICE_INTERNAL_URL;
  else process.env.ONLYOFFICE_INTERNAL_URL = originalInternal;
  if (originalApp === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = originalApp;
});

describe('ONLYOFFICE signed links', () => {
  beforeEach(() => {
    process.env.ONLYOFFICE_JWT_SECRET = 'test_onlyoffice_secret_0123456789';
  });

  test('signs and reads a document token', () => {
    const token = tokenService.issueDocumentToken({ projectId: 7, key: 'k', fileName: 'book.xlsx' });
    const payload = tokenService.verify(token);
    expect(payload).toMatchObject({ purpose: 'document', projectId: 7, key: 'k', fileName: 'book.xlsx' });
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  test('rejects a tampered payload, a wrong secret and an expired token', () => {
    const token = tokenService.issueCallbackToken({ projectId: 7, key: 'k', fileName: 'book.xlsx' });
    const [header, body, signature] = token.split('.');
    const tampered = `${header}.${Buffer.from(JSON.stringify({ projectId: 8 })).toString('base64url')}.${signature}`;
    expect(() => tokenService.verify(tampered)).toThrow(tokenService.TokenError);

    process.env.ONLYOFFICE_JWT_SECRET = 'another_secret_0123456789';
    expect(() => tokenService.verify(token)).toThrow(tokenService.TokenError);

    process.env.ONLYOFFICE_JWT_SECRET = 'test_onlyoffice_secret_0123456789';
    const expired = tokenService.sign({
      purpose: 'document',
      projectId: 7,
      exp: Math.floor(Date.now() / 1000) - 120
    });
    expect(() => tokenService.verify(expired)).toThrow(tokenService.TokenError);
  });

  test('reports a missing secret as not configured, not as a bad login', () => {
    delete process.env.ONLYOFFICE_JWT_SECRET;
    try {
      expect(() => tokenService.sign({ a: 1 })).toThrow(/not configured/);
    } finally {
      process.env.ONLYOFFICE_JWT_SECRET = 'test_onlyoffice_secret_0123456789';
    }
  });
});

describe('ONLYOFFICE file handoff', () => {
  beforeEach(() => {
    process.env.ONLYOFFICE_INTERNAL_URL = 'http://onlyoffice';
    process.env.APP_BASE_URL = 'https://team.example.test';
  });

  test('moves a callback URL onto the internal Document Server host', () => {
    expect(onlyoffice.buildDownloadUrl('https://team.example.test/cache/files/a.xlsx?md5=1'))
      .toBe('http://onlyoffice/cache/files/a.xlsx?md5=1');
    expect(onlyoffice.buildDownloadUrl('http://onlyoffice/cache/files/a.xlsx'))
      .toBe('http://onlyoffice/cache/files/a.xlsx');
    expect(onlyoffice.buildDownloadUrl('/cache/files/a.xlsx'))
      .toBe('http://onlyoffice/cache/files/a.xlsx');
  });

  test('a private IP from the Document Server is fetched through our own public origin', () => {
    expect(onlyoffice.buildDownloadUrl('http://172.18.0.5/cache/files/a.xlsx'))
      .toBe('https://team.example.test/cache/files/a.xlsx');
    expect(onlyoffice.buildDownloadUrl('http://172.18.0.5/cache/files/a.xlsx?md5=2'))
      .toBe('https://team.example.test/cache/files/a.xlsx?md5=2');
  });

  test('refuses a file from anywhere else', () => {
    expect(() => onlyoffice.buildDownloadUrl('https://evil.example/cache/files/a.xlsx'))
      .toThrow(/unexpected address/);
    expect(() => onlyoffice.buildDownloadUrl('http://onlyoffice/api/secret'))
      .toThrow(/unexpected path/);
    expect(() => onlyoffice.buildDownloadUrl('file:///etc/passwd'))
      .toThrow(/invalid file address/);
  });

  test('makes a stable key from the workbook bytes', () => {
    const one = onlyoffice.editorKey(4, Buffer.from('one'));
    expect(one).toBe(onlyoffice.editorKey(4, Buffer.from('one')));
    expect(one).not.toBe(onlyoffice.editorKey(4, Buffer.from('two')));
    expect(one).toMatch(/^telos-4-[a-f0-9]{20}$/);
  });

  test('keeps the original .xlsx name and falls back for anything else', () => {
    expect(onlyoffice.safeXlsxName('Revenue Share.xlsx', 3)).toBe('Revenue Share.xlsx');
    expect(onlyoffice.safeXlsxName('Revenue Share.xls', 3)).toBe('project-3-sheet.xlsx');
    expect(onlyoffice.safeXlsxName('../../etc/passwd.xlsx', 3)).toBe('.._.._etc_passwd.xlsx');
  });
});
