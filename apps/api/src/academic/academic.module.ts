import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { SemestersController, SubjectsController } from "./academic.controllers";
import { ExcelExportService } from "./excel-export.service";
import { ExceptionsService } from "./exceptions.service";
import { SemestersService } from "./semesters.service";
import { SubjectsService } from "./subjects.service";

/** Semestres, matérias, grade semanal e calendário de exceções. Tudo exige sessão (guard global). */
@Module({
  imports: [NotificationsModule],
  controllers: [SemestersController, SubjectsController],
  providers: [SemestersService, SubjectsService, ExceptionsService, ExcelExportService],
  exports: [SemestersService, SubjectsService, ExcelExportService],
})
export class AcademicModule {}
