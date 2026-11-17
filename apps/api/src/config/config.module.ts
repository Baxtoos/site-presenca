import { Global, Module } from "@nestjs/common";
import { ENV, loadEnv } from "./env";

/** Disponibiliza o ambiente validado para toda a API pelo token ENV. */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
