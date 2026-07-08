import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// Receipt photos arrive base64-encoded in the JSON body; a single full-res
// phone photo (base64 inflates ~33%) can approach 10mb, and multi-photo
// uploads blow past it — which surfaced as a generic OCR failure. Raise the
// ceiling so real uploads go through.
app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true, limit: "30mb" }));

app.use("/api", router);

export default app;
