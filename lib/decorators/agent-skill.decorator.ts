import { SetMetadata } from '@nestjs/common';
import { A2A_AGENT_SKILL_TOKEN } from '../constant';
import { AgentSkill } from '../interfaces/a2a.types';

export const Skill = (config: AgentSkill) => {
  return SetMetadata(A2A_AGENT_SKILL_TOKEN, config);
};
