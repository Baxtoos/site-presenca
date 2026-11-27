import { Controller, Get, Inject, NotFoundException } from "@nestjs/common";
import { buildOpenApiDocument, routes } from "@presenca/contracts";
import { Public } from "../auth/decorators";
import { ENV, type Env } from "../config/env";

@Public()
@Controller()
export class OpenApiController {
  private readonly document: ReturnType<typeof buildOpenApiDocument>;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.document = buildOpenApiDocument(routes, {
      title: "Monitor de Presenças · API",
      version: env.APP_VERSION,
      description: "API REST do Monitor de Presenças. Erros seguem RFC 9457 (problem+json).",
    });
  }

  @Get("openapi.json")
  openapi() {
    if (!this.env.OPENAPI_ENABLED) throw new NotFoundException();
    return this.document;
  }
}
