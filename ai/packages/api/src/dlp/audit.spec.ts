import { createDlpAudit, hashValue } from './audit';

describe('hashValue', () => {
  it('даёт 12 шестнадцатеричных знаков', () => {
    expect(hashValue('4111111111111111')).toMatch(/^[0-9a-f]{12}$/);
  });
  it('стабилен для одного значения', () => {
    expect(hashValue('abc')).toBe(hashValue('abc'));
  });
  it('различает разные значения', () => {
    expect(hashValue('abc')).not.toBe(hashValue('abd'));
  });
});

describe('createDlpAudit', () => {
  it('пишет запись на каждую категорию', async () => {
    const recordAuditEntry = jest.fn().mockResolvedValue(undefined);
    const audit = createDlpAudit({ recordAuditEntry });
    await audit.recordFindings({
      userId: 'u1',
      userName: 'Иван Иванов',
      conversationId: 'c1',
      mode: 'mask',
      findings: [
        { category: 'payment_card', count: 2, valueHashes: ['aa', 'bb'] },
        { category: 'ru_inn', count: 1, valueHashes: ['cc'] },
      ],
    });
    expect(recordAuditEntry).toHaveBeenCalledTimes(2);
  });

  it('не помещает значение в запись', async () => {
    const recordAuditEntry = jest.fn().mockResolvedValue(undefined);
    const audit = createDlpAudit({ recordAuditEntry });
    await audit.recordFindings({
      userId: 'u1',
      userName: 'Иван Иванов',
      mode: 'mask',
      findings: [
        { category: 'payment_card', count: 1, valueHashes: [hashValue('4111111111111111')] },
      ],
    });
    expect(JSON.stringify(recordAuditEntry.mock.calls[0][0])).not.toContain('4111');
  });

  it('помечает секреты критичными', async () => {
    const recordAuditEntry = jest.fn().mockResolvedValue(undefined);
    const audit = createDlpAudit({ recordAuditEntry });
    await audit.recordFindings({
      userId: 'u1',
      userName: 'Иван Иванов',
      mode: 'mask',
      findings: [{ category: 'secrets', count: 1, valueHashes: ['aa'] }],
    });
    expect(recordAuditEntry.mock.calls[0][0].severity).toBe('critical');
  });

  it('ничего не пишет при пустом списке находок', async () => {
    const recordAuditEntry = jest.fn();
    const audit = createDlpAudit({ recordAuditEntry });
    await audit.recordFindings({
      userId: 'u1',
      userName: 'Иван Иванов',
      mode: 'mask',
      findings: [],
    });
    expect(recordAuditEntry).not.toHaveBeenCalled();
  });

  it('пишет аварию отдельным действием', async () => {
    const recordAuditEntry = jest.fn().mockResolvedValue(undefined);
    const audit = createDlpAudit({ recordAuditEntry });
    await audit.recordFailure({ userId: 'u1', userName: 'Иван Иванов', reason: 'detector threw' });
    expect(recordAuditEntry.mock.calls[0][0].action).toBe('dlp.failed');
    expect(recordAuditEntry.mock.calls[0][0].severity).toBe('critical');
  });
});
