import { startHttpServer } from "agentation-mcp";

const port = Number(process.env.PORT || 4747);
startHttpServer(port);
