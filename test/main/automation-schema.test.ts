import { applyAutomationInputs, assertAutomationDocument, createAutomationDocument, redactAutomationChat, resolveAutomationPosition, resolveAutomationVector, resolveAutomationYaw, type AutomationDocument } from '../../src/common/automation';

const validDocument = (): AutomationDocument => ({
  schemaVersion: 2, id: 'automation', name: 'Automation', revision: 0, createdAt: 0, updatedAt: 0, durationMs: 0,
  source: { kind: 'minecraft' }, origin: { x: 0, y: 64, z: 0, yaw: 0, pitch: 0 }, inputs: [], steps: [],
});
describe('automation v2 schema helpers', () => {
  test('rejects prior recordings with a re-record message', () => {
    const document = validDocument() as any; document.schemaVersion = 1;
    expect(() => assertAutomationDocument(document)).toThrow('Record this task again');
  });
  test('redacts every credential argument and substitutes it at replay', () => {
    const redacted = redactAutomationChat('/register hunter2 hunter2');
    expect(redacted.input).toMatchObject({ id: 'registerPassword', secret: true });
    expect(applyAutomationInputs(redacted.message, { registerPassword: 'hunter2' })).toBe('/register hunter2 hunter2');
  });
  test('resolves relative positions and camera values', () => {
    const reference = { absolute: { x: 10, y: 64, z: 10 }, relative: { x: 2, y: 0, z: 0 } };
    expect(resolveAutomationPosition(reference, 'absolute', { x: 0, y: 0, z: 0 })).toEqual(reference.absolute);
    expect(resolveAutomationPosition(reference, 'relative', { x: 20, y: 64, z: 20, yaw: 90 }, 0)).toEqual({ x: 20, y: 64, z: 22 });
    expect(resolveAutomationYaw(30, 'relative', { x: 0, y: 0, z: 0, yaw: 90 }, 0)).toBe(120);
    expect(resolveAutomationVector({ x: 1, y: 0, z: 0 }, 'relative', { x: 0, y: 0, z: 0, yaw: 90 }, 0).z).toBeCloseTo(1);
  });
  test('creates v2 documents', () => expect(createAutomationDocument({ id: 'new', name: 'New' }).schemaVersion).toBe(2));
});
