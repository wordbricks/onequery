declare module "hono" {
  export class Hono {
    route(path: string, app: Hono): this;
    get<Context>(path: string, handler: (c: Context) => unknown): this;
    post<Context>(path: string, handler: (c: Context) => unknown): this;
    patch<Context>(path: string, handler: (c: Context) => unknown): this;
    delete<Context>(path: string, handler: (c: Context) => unknown): this;
    fetch(request: Request): Response | Promise<Response>;
  }
}

declare module "postgres" {
  type SqlTag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown[]>;

  export default function postgres(options: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
  }): SqlTag;
}
