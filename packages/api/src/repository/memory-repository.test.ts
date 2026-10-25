import { MemoryRepository } from './memory-repository.js';
import { repositoryContract } from './repository.contract.js';

repositoryContract('in-memory', () => new MemoryRepository());
