import { CoursesService } from './courses.service';

describe('CoursesService', () => {
    let service: CoursesService;

    beforeEach(async () => {
        service = new CoursesService();
        service['prisma'] = {
            course: {
                findUnique: jest.fn().mockResolvedValue({ placesRestantes: 0 })
            }
        } as any;
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('should rejects if course completed', async () => {
        await expect(service.updateSeats("un-id", -4)).rejects.toThrow();
    });
});