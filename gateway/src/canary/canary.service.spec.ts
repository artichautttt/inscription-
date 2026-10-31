import { CanaryService } from './canary.service';

describe('CanaryService (securite par defaut)', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('sert v1 quand Unleash n est pas configure', () => {
    delete process.env.UNLEASH_URL;
    delete process.env.UNLEASH_CLIENT_TOKEN;
    const svc = new CanaryService();
    svc.onModuleInit();
    expect(svc.pick('u1')).toBe('v1');
  });

  it('sert v1 tant que le SDK n est pas pret', () => {
    const svc = new CanaryService();
    (svc as any).unleash = { isEnabled: () => true };
    (svc as any).ready = false;
    expect(svc.pick('u1')).toBe('v1');
  });

  it('suit le flag une fois le SDK pret', () => {
    const svc = new CanaryService();
    const isEnabled = jest.fn().mockReturnValue(true);
    (svc as any).unleash = { isEnabled };
    (svc as any).ready = true;
    expect(svc.pick('u1')).toBe('v2');
    expect(isEnabled).toHaveBeenCalledWith('courses-v2-canary', { userId: 'u1' });
    isEnabled.mockReturnValue(false);
    expect(svc.pick('u1')).toBe('v1');
  });

  it('sert v1 si l evaluation leve une exception', () => {
    const svc = new CanaryService();
    (svc as any).unleash = { isEnabled: () => { throw new Error('boom'); } };
    (svc as any).ready = true;
    expect(svc.pick('u1')).toBe('v1');
  });
});
