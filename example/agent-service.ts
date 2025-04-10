import { Injectable } from '@nestjs/common';
import {
  InputMode,
  OutputMode,
  Skill,
  TaskYieldUpdate,
  Task,
  TaskState,
  PartType,
  MessageRole,
} from '../lib';

@Injectable()
export class AgentService {
  @Skill({
    id: 'hi',
    name: 'Hi',
    description: 'Say hi to the user',
    examples: [
      'Hi',
      'Hey',
      'Good morning',
      'Good afternoon',
      'Good evening',
      'Goodbye',
    ],
    inputModes: [InputMode.TEXT],
    outputModes: [OutputMode.TEXT],
    tags: ['greeting'],
  })
  async *sayHello(): AsyncGenerator<TaskYieldUpdate, Task | void, unknown> {
    yield {
      state: TaskState.WORKING,
      message: {
        role: MessageRole.AGENT,
        parts: [
          {
            type: PartType.TEXT,
            text: 'Hi, how can I help you today?',
          },
        ],
      },
    };
    await new Promise((resolve) => setTimeout(resolve, 1000));
    yield {
      state: TaskState.WORKING,
      message: {
        role: MessageRole.AGENT,
        parts: [
          {
            type: PartType.TEXT,
            text: 'I am a simple agent that says hi',
          },
        ],
      },
    };
    await new Promise((resolve) => setTimeout(resolve, 1000));
    yield {
      state: TaskState.COMPLETED,
    };
  }
}
