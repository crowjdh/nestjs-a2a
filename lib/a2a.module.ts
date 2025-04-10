import { DynamicModule, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { createA2AController } from './a2a.controller';
import { A2A_OPTIONS_TOKEN } from './constant';
import {
  AgentToAgentAsyncModuleOptions,
  AgentToAgentModuleOptions,
} from './interfaces/a2a.options';
import { A2AExecutor } from './services/a2a.executor';
import { A2ARegistry } from './services/a2a.registry';

@Module({})
export class AgentToAgentModule {
  static register(options: AgentToAgentModuleOptions): DynamicModule {
    return {
      module: AgentToAgentModule,
      controllers: [createA2AController(options.basePath)],
      imports: [DiscoveryModule],
      providers: [
        {
          provide: A2A_OPTIONS_TOKEN,
          useValue: options,
        },
        A2ARegistry,
        A2AExecutor,
      ],
    };
  }

  static async registerAsync(
    options: AgentToAgentAsyncModuleOptions,
  ): Promise<DynamicModule> {
    return {
      module: AgentToAgentModule,
      imports: [...(options.imports ?? []), DiscoveryModule],
      controllers: [createA2AController(options.basePath)],
      providers: [
        {
          provide: A2A_OPTIONS_TOKEN,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
        A2ARegistry,
        A2AExecutor,
      ],
    };
  }
}
