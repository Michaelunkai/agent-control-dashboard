import { createApp } from "./control-app.js";
import { D1TaskStore } from "./d1-store.js";

export interface Env {
  DB: D1Database;
  OWNER_TOKEN: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const app = createApp(new D1TaskStore(env.DB), env.OWNER_TOKEN);
    return await app.fetch(request, env);
  }
};
