import { Injectable, InjectionToken } from '@nestjs/common';
import { OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { A2A_AGENT_SKILL_TOKEN } from '../constant';
import { AgentSkill } from '../interfaces/a2a.types';

export interface DiscoveredSkill {
  providerClass: InjectionToken;
  methodName: string;
  skill: AgentSkill;
}

@Injectable()
export class A2ARegistry implements OnApplicationBootstrap {
  private readonly discoveredSkills: DiscoveredSkill[] = [];

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
  ) {}

  onApplicationBootstrap() {
    this.discoverSkills();
  }

  private discoverSkills() {
    const providers = this.discovery.getProviders();
    const controllers = this.discovery.getControllers();
    let isFallbackExists = false;

    [...providers, ...controllers]
      .filter(
        (wrapper) =>
          Boolean(wrapper.instance) && typeof wrapper.instance === 'object',
      )
      .forEach(({ instance, token }) => {
        this.metadataScanner
          .getAllMethodNames(instance)
          .forEach((methodName) => {
            const methodRef = instance[methodName] as object;
            const methodMetaKeys = Reflect.getOwnMetadataKeys(methodRef);
            if (methodMetaKeys.includes(A2A_AGENT_SKILL_TOKEN)) {
              const skill = Reflect.getMetadata(
                A2A_AGENT_SKILL_TOKEN,
                methodRef,
              );
              /**
               * Check if there are more than one fallback skill.
               * If there are, throw an error.
               */
              if (skill.fallback) {
                if (isFallbackExists) {
                  throw new Error('More than one fallback skill found');
                }
                isFallbackExists = true;
              }
              this.discoveredSkills.push({
                providerClass: token,
                methodName,
                skill: Reflect.getMetadata(A2A_AGENT_SKILL_TOKEN, methodRef),
              });
            }
          });
      });
  }

  getAvailableSkills(): DiscoveredSkill[] {
    return this.discoveredSkills;
  }

  getSkill(id: string): DiscoveredSkill | undefined {
    return this.discoveredSkills.find((skill) => skill.skill.id === id);
  }

  getFallbackSkill(): DiscoveredSkill | undefined {
    return (
      this.discoveredSkills.find((skill) => skill.skill.fallback) ??
      this.discoveredSkills[0]
    );
  }
}
