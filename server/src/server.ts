import dotenv from 'dotenv';
dotenv.config();

import { app } from './app';
import { connectDB } from './db';

const PORT = process.env['PORT'] ? parseInt(process.env['PORT'], 10) : 5000;

async function bootstrap() {
  try {
    await connectDB();

    app.listen(PORT, () => {
      console.log(`[Vault Server] Listening on http://localhost:${PORT}`);
      console.log(
        `[Vault Server] Health check available at http://localhost:${PORT}/health`
      );
    });
  } catch (error) {
    console.error('[Vault Server] Startup failure:', error);
    process.exit(1);
  }
}

bootstrap();
