import { Module } from "@nestjs/common";
import { SemestersController, SubjectsController } from "./academic.controllers";
import { ExceptionsService } from "./exceptions.service";
import { SemestersService } from "./semesters.service";
import { SubjectsService } from "./subjects.service";

/** Semestres, matérias, grade semanal e calendário de exceções. Tudo exige sessão (guard global). */
@Module({
  controllers: [SemestersController, SubjectsController],
  providers: [SemestersService, SubjectsService, ExceptionsService],
  exports: [SemestersService, SubjectsService],
})
export class AcademicModule {}
