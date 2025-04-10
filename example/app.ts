import { NestFactory } from '@nestjs/core';
import { Logger, Module } from '@nestjs/common';
import { AgentToAgentModule, OutputMode, InputMode } from '../lib';
import { AgentService } from './agent-service';

@Module({
  imports: [
    AgentToAgentModule.register({
      card: {
        name: 'Hi Agent',
        description: 'A agent that says hi',
        version: '1.0.0',
        capabilities: {
          streaming: true,
        },
        defaultInputModes: [InputMode.TEXT],
        defaultOutputModes: [OutputMode.TEXT],
        provider: {
          organization: 'thestupd',
          url: 'https://stupd.dev',
        },
      },
    }),
  ],
  providers: [AgentService],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('A2A Example');

  await app.listen(3333);
  logger.log('A2A server started on port 3333');
}

void bootstrap();
