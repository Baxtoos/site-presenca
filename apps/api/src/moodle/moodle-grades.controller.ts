import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import {
  idParamsSchema,
  type MoodleGradeLinksBody,
  moodleGradeLinksBodySchema,
  type MoodleGrades,
} from "@presenca/contracts";
import { ZodPipe } from "../common/zod.pipe";
import { RateLimit } from "../rate-limit/rate-limit";
import { MoodleService } from "./moodle.service";

@Controller("v1/subjects")
export class MoodleGradesController {
  constructor(private readonly moodle: MoodleService) {}

  @Get(":id/moodle-grades")
  @RateLimit({ bucket: "moodle-grades", by: "user", limit: 60, windowSeconds: 3600 })
  get(@Param(new ZodPipe(idParamsSchema)) { id }: { id: string }): Promise<MoodleGrades> {
    return this.moodle.subjectGrades(id);
  }

  @Put(":id/moodle-grades")
  @RateLimit({ bucket: "moodle-grades", by: "user", limit: 60, windowSeconds: 3600 })
  link(
    @Param(new ZodPipe(idParamsSchema)) { id }: { id: string },
    @Body(new ZodPipe(moodleGradeLinksBodySchema)) body: MoodleGradeLinksBody,
  ): Promise<MoodleGrades> {
    return this.moodle.linkGrades(id, body);
  }
}
