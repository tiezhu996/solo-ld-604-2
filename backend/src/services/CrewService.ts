import { crewRepository } from "../repositories/CrewRepository"; export const crewService = { list: () => crewRepository.findAll(), create: (row: unknown) => crewRepository.save(row) };
