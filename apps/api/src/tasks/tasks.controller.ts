import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import {
  type CreateTaskBody,
  createTaskBodySchema,
  type Task,
  type TaskList,
  type TaskListQuery,
  taskListQuerySchema,
  taskParamsSchema,
  type UpdateTaskBody,
  updateTaskBodySchema,
} from "@presenca/contracts";
import type { FastifyReply } from "fastify";
import { IdempotencyKey } from "../common/idempotency";
import { IfMatchVersion, setEtag } from "../common/versioning";
import { ZodPipe } from "../common/zod.pipe";
import { RateLimit } from "../rate-limit/rate-limit";
import { TasksService } from "./tasks.service";

const idPipe = new ZodPipe(taskParamsSchema);

@Controller("v1/tasks")
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(@Query(new ZodPipe(taskListQuerySchema)) query: TaskListQuery): Promise<TaskList> {
    return this.tasks.list(query);
  }

  @Post()
  @RateLimit({ bucket: "task-create", by: "user", limit: 60, windowSeconds: 3600 })
  async create(
    @Body(new ZodPipe(createTaskBodySchema)) body: CreateTaskBody,
    @IdempotencyKey() key: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Task> {
    const result = await this.tasks.create(body, key);
    void reply.status(result.status);
    if (result.replayed) void reply.header("idempotent-replayed", "true");
    setEtag(reply, result.body.version);
    return result.body;
  }

  @Get(":id")
  async get(
    @Param(idPipe) { id }: { id: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Task> {
    const task = await this.tasks.get(id);
    setEtag(reply, task.version);
    return task;
  }

  @Patch(":id")
  async update(
    @Param(idPipe) { id }: { id: string },
    @IfMatchVersion() version: number,
    @Body(new ZodPipe(updateTaskBodySchema)) body: UpdateTaskBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Task> {
    const task = await this.tasks.update(id, version, body);
    setEtag(reply, task.version);
    return task;
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(
    @Param(idPipe) { id }: { id: string },
    @IfMatchVersion() version: number,
  ): Promise<void> {
    await this.tasks.remove(id, version);
  }
}
