# nestjs-a2a

A NestJS library for implementing Google's Agent-to-Agent (A2A) protocol.

## Description

`nestjs-a2a` is a library designed to simplify the implementation of Google's Agent-to-Agent (A2A) protocol in NestJS applications. It provides a set of utilities, decorators, and interfaces to make building A2A-compatible agents seamless and type-safe.

## Installation

```bash
npm install nestjs-a2a
# or
yarn add nestjs-a2a
# or
pnpm add nestjs-a2a
```

## Quick Start

```typescript
import { Module } from '@nestjs/common';
import { AgentToAgentModule } from 'nestjs-a2a';

@Module({
  imports: [
    AgentToAgentModule.register({
      card: {
        name: 'My Agent',
        description: 'A sample A2A agent',
        version: '1.0.0',
        capabilities: {
          streaming: true,
        },
        provider: {
          organization: 'My Organization',
          url: 'https://myorganization.com',
        },
      },
    }),
  ],
})
export class AppModule {}
```

## Features

- Complete implementation of Google's Agent-to-Agent (A2A) protocol
- Type-safe communication between agents
- Easy-to-use decorators for defining agent skills
- Support for streaming responses
- Automatic skill discovery and registration
- JSON-RPC 2.0 compliant API
- Built-in task state management

## Creating Agent Skills

Use the `@Skill` decorator to define agent skills:

```typescript
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
} from 'nestjs-a2a';

@Injectable()
export class GreetingService {
  @Skill({
    id: 'greeting',
    name: 'Greeting',
    description: 'Greet the user',
    examples: ['Hello', 'Hi', 'Good morning'],
    inputModes: [InputMode.TEXT],
    outputModes: [OutputMode.TEXT],
    tags: ['greeting'],
  })
  async *greet(): AsyncGenerator<TaskYieldUpdate, Task | void, unknown> {
    yield {
      state: TaskState.WORKING,
      message: {
        role: MessageRole.AGENT,
        parts: [
          {
            type: PartType.TEXT,
            text: 'Hello! How can I help you today?',
          },
        ],
      },
    };

    yield {
      state: TaskState.COMPLETED,
    };
  }
}
```

## API Documentation

### AgentToAgentModule

The main module for integrating A2A functionality into your NestJS application.

#### Static Methods

- `register(options: AgentToAgentModuleOptions)`: Register the module with static options
- `registerAsync(options: AgentToAgentAsyncModuleOptions)`: Register the module with async options

### Configuration Options

```typescript
interface AgentToAgentModuleOptions {
  // Agent card information
  card: Omit<AgentCard, 'skills'>;

  // Optional custom task store implementation
  taskStore?: TaskStore;

  // Optional base path for the A2A endpoints (default: '/a2a')
  basePath?: string;

  // Optional guards for securing A2A endpoints
  guards?: CanActivate[];

  // Optional function to select a skill based on the task
  selectSkill?: (task: Task) => Promise<string> | string;
}
```

### Decorators

- `@Skill(config: AgentSkill)`: Marks a method as an agent skill handler

## Examples

Check the `example` directory for a complete working example of an A2A agent implementation.

```bash
# Run the example
pnpm start:example
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Continuous Integration

This project uses GitHub Actions for continuous integration:

- All pull requests and pushes to the main branch are automatically tested
- Code quality checks including linting and type checking are performed
- Test coverage is reported

### Deployment

Deployment to npm is automated using GitHub Actions and semantic-release:

1. Create and push a new tag following semantic versioning (e.g., `v1.0.0`)
2. GitHub Actions will automatically build, test, and publish the package to npm
3. A GitHub Release will be created with release notes

```bash
# Example: Creating and pushing a new tag
git tag v1.0.0
git push origin v1.0.0
```

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details.

## Contact

Thieu Quan Ngoc - [me@stupd.dev](mailto:me@stupd.dev) - [@thestupd](https://github.com/thestupd)

Website: [https://stupd.dev](https://stupd.dev)

## Resources

- [Google A2A Documentation](https://developers.google.com/agent-to-agent)
- [NestJS Documentation](https://docs.nestjs.com/)
- [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)
