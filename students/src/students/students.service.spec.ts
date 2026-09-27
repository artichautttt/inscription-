import { StudentsService } from './students.service';

describe('StudentsService', () => {
  let service: StudentsService;

    beforeEach(async () => {
        service = new StudentsService();
        service['prisma'] = {
            student: {
                findUnique: jest.fn().mockResolvedValue(null)
            }
        } as any;
    });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

    it('should rejects if no student ', async () => {
        await expect(service.findOne("un-id")).rejects.toThrow();
    });
});
