import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController (gateway)', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('répond ok sur /health', () => {
    const result = controller.check();
    expect(result.service).toBe('gateway');
    expect(result.status).toBe('ok');
  });
});
