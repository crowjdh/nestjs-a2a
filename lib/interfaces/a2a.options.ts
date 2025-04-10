import { CanActivate, ModuleMetadata } from '@nestjs/common';
import { TaskStore } from './a2a.store';
import { AgentCard, Task } from './a2a.types';

export interface AgentToAgentOptions {
  taskStore?: TaskStore;
  card: Omit<AgentCard, 'skills'>;
  selectSkill?: (task: Task) => Promise<string> | string;
}

export interface AgentToAgentModuleOptions extends AgentToAgentOptions {
  basePath?: string;
  guards?: CanActivate[];
}

export interface AgentToAgentAsyncModuleOptions {
  imports?: ModuleMetadata['imports'];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inject?: any[];
  basePath?: string;
  guards?: CanActivate[];
  useFactory: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
  ) => Promise<AgentToAgentOptions> | AgentToAgentOptions;
}
