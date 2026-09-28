import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS : le front (Vite, port 5173) doit pouvoir appeler la gateway.
  app.enableCors();

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`API Gateway démarrée sur le port ${port}`);
}
bootstrap();
